/* Persistencia en Supabase con soporte offline.
   - Las lecturas salen de un caché local (sirve sin señal y abre al instante).
   - Las escrituras se aplican al toque en pantalla y van a una cola (outbox) que se
     envía a Supabase en orden; si no hay señal, se reintenta sola al volver.
   - Los cambios de otros celulares llegan en tiempo real (y por sondeo cada 30 s como respaldo). */
(function () {
  "use strict";
  const cfg = window.APP_CONFIG;
  const K_SERVER = "dc_server_v2", K_OUT = "dc_outbox_v2";
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const configured = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "dc_auth" },
  }) : null;

  // server: último estado confirmado por Supabase. outbox: cambios locales sin confirmar.
  let server = load(K_SERVER, { eventos: [], prestamos: {} });
  let outbox = load(K_OUT, []);
  let operador = null, current = null, channel = null;
  let online = navigator.onLine, lastSync = null, flushing = false, pollT = null;
  const listeners = new Set(), errListeners = new Set();
  let emitT = null;
  const emit = () => { clearTimeout(emitT); emitT = setTimeout(() => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }), 30); };
  const fail = msg => errListeners.forEach(f => f(msg));
  const persist = () => { save(K_SERVER, server); save(K_OUT, outbox); };

  /* ---------- mapeo fila <-> app ---------- */
  const iso = ms => ms ? new Date(ms).toISOString() : null;
  const ms = s => s ? Date.parse(s) : null;
  const fromEvento = r => ({ id: r.id, nombre: r.nombre, creado: ms(r.creado_at) });
  const fromPrestamo = r => ({
    id: r.id, evento: r.evento_id, sn: r.sn, dni: r.dni, nombre: r.nombre, estado: r.estado,
    entregado: ms(r.entregado_at), devuelto: ms(r.devuelto_at), forzado: !!r.forzado, dniDevolucion: r.dni_devolucion || null,
    entregadoPor: r.entregado_por_nombre || "", devueltoPor: r.devuelto_por_nombre || "",
  });
  const toPrestamoRow = p => ({
    id: p.id, evento_id: p.evento, sn: p.sn, dni: p.dni || "", nombre: p.nombre || "", estado: p.estado,
    entregado_at: iso(p.entregado), devuelto_at: iso(p.devuelto), forzado: !!p.forzado, dni_devolucion: p.dniDevolucion || null,
  });
  const PATCH_MAP = { estado: "estado", devuelto: "devuelto_at", forzado: "forzado", dniDevolucion: "dni_devolucion", nombre: "nombre", dni: "dni" };
  const toPatchRow = patch => {
    const r = {};
    for (const k in patch) if (PATCH_MAP[k]) r[PATCH_MAP[k]] = k === "devuelto" ? iso(patch[k]) : patch[k];
    return r;
  };

  /* ---------- vista = servidor + cola local ---------- */
  function view() {
    const ev = server.eventos.slice();
    const pr = {};
    for (const k in server.prestamos) pr[k] = server.prestamos[k].slice();
    for (const op of outbox) {
      if (op.t === "eventos" && op.k === "ins" && !ev.some(e => e.id === op.data.id)) ev.push({ ...op.data, pendiente: true });
      if (op.t !== "prestamos") continue;
      if (op.k === "ins") {
        const arr = pr[op.data.evento] || (pr[op.data.evento] = []);
        if (!arr.some(p => p.id === op.data.id)) arr.push({ ...op.data, pendiente: true });
      } else {
        for (const k in pr) {
          const i = pr[k].findIndex(p => p.id === op.id);
          if (i < 0) continue;
          if (op.k === "upd") pr[k][i] = { ...pr[k][i], ...op.data, pendiente: true };
          else pr[k].splice(i, 1);
        }
      }
    }
    return { ev, pr };
  }

  /* ---------- cola de envío ---------- */
  const isTransient = e => !e || !e.code || /^PGRST3/.test(e.code) || e.code === "57014" || /fetch|network|timeout|load failed/i.test(e.message || "");
  function describeError(op, e) {
    if (e.code === "23505" && op.t === "prestamos") return `No se guardó la entrega de ${op.data.sn}: otro operador ya lo había entregado.`;
    if (e.code === "23503") return "No se guardó un cambio: el evento ya no existe.";
    if (e.code === "42501") return "No se guardó un cambio: sin permiso (¿sesión vencida?). Volvé a iniciar sesión.";
    return "No se guardó un cambio: " + (e.message || e.code);
  }
  async function runOp(op) {
    if (op.t === "eventos") return sb.from("eventos").upsert({ id: op.data.id, nombre: op.data.nombre }, { onConflict: "id", ignoreDuplicates: true });
    if (op.k === "ins") return sb.from("prestamos").upsert(toPrestamoRow(op.data), { onConflict: "id", ignoreDuplicates: true });
    if (op.k === "upd") return sb.from("prestamos").update(toPatchRow(op.data)).eq("id", op.id);
    return sb.from("prestamos").delete().eq("id", op.id);
  }
  async function flush() {
    if (!sb || flushing || !operador || !outbox.length) return;
    flushing = true;
    let sent = 0;
    try {
      while (outbox.length) {
        const op = outbox[0];
        let res;
        try { res = await runOp(op); } catch (e) { res = { error: { message: String(e) } }; }
        if (res.error && isTransient(res.error)) { setOnline(false); break; }
        setOnline(true);
        if (res.error) fail(describeError(op, res.error));
        outbox.shift(); sent++; persist(); emit();
      }
    } finally { flushing = false; }
    if (sent) await pull();
  }
  function enqueue(op) {
    // Compacta: un cambio sobre algo que todavía no se envió se fusiona con el alta.
    if (op.t === "prestamos" && op.k !== "ins") {
      const i = outbox.findIndex(o => o.t === "prestamos" && o.k === "ins" && o.data.id === op.id);
      if (i > 0 || (i === 0 && !flushing)) {
        if (op.k === "upd") outbox[i] = { ...outbox[i], data: { ...outbox[i].data, ...op.data } };
        else outbox = outbox.filter(o => !(o.t === "prestamos" && (o.data && o.data.id === op.id || o.id === op.id)));
        persist(); emit(); return;
      }
    }
    outbox.push(op); persist(); emit();
    flush();
  }

  /* ---------- lectura ---------- */
  function setOnline(v) { if (online !== v) { online = v; emit(); } if (v) lastSync = Date.now(); }
  async function pull() {
    if (!sb || !operador) return;
    const { data: evs, error } = await sb.from("eventos").select("*").order("creado_at", { ascending: false });
    if (error) { if (isTransient(error)) setOnline(false); return; }
    server.eventos = evs.map(fromEvento);
    if (current) {
      const { data, error: e2 } = await sb.from("prestamos").select("*").eq("evento_id", current).limit(10000);
      if (!e2) server.prestamos[current] = data.map(fromPrestamo);
    }
    // Para el caché local alcanza con el evento actual
    for (const k in server.prestamos) if (k !== current) delete server.prestamos[k];
    setOnline(true); persist(); emit();
  }
  function subscribeRealtime() {
    if (!sb) return;
    if (channel) { sb.removeChannel(channel); channel = null; }
    channel = sb.channel("dc-" + (current || "none"))
      .on("postgres_changes", { event: "*", schema: "public", table: "eventos" }, p => {
        if (p.eventType === "DELETE") server.eventos = server.eventos.filter(e => e.id !== p.old.id);
        else { const e = fromEvento(p.new); server.eventos = server.eventos.filter(x => x.id !== e.id).concat(e); }
        persist(); emit();
      });
    if (current) channel.on("postgres_changes", { event: "*", schema: "public", table: "prestamos", filter: "evento_id=eq." + current }, p => {
      const arr = server.prestamos[current] || (server.prestamos[current] = []);
      if (p.eventType === "DELETE") server.prestamos[current] = arr.filter(x => x.id !== p.old.id);
      else { const r = fromPrestamo(p.new); const i = arr.findIndex(x => x.id === r.id); if (i >= 0) arr[i] = r; else arr.push(r); }
      setOnline(true); persist(); emit();
    });
    channel.subscribe();
  }
  const sync = () => flush().then(pull).catch(() => {});
  function startPolling() {
    clearInterval(pollT);
    pollT = setInterval(() => { if (document.visibilityState === "visible") sync(); }, 30000);
  }
  window.addEventListener("online", sync);
  window.addEventListener("offline", () => setOnline(false));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  const opFromUser = u => ({ id: u.id, nombre: (u.user_metadata && u.user_metadata.nombre) || cfg.operadores.find(n => cfg.emailDe(n) === u.email) || u.email });

  window.Store = {
    configured,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onError(fn) { errListeners.add(fn); },
    get operador() { return operador; },
    status() { return { online, pending: outbox.length, lastSync }; },

    async restoreSession() {
      if (!sb) return null;
      const { data } = await sb.auth.getSession();
      if (data && data.session) operador = opFromUser(data.session.user);
      return operador;
    },
    async login(nombre, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email: cfg.emailDe(nombre), password });
      if (error) throw new Error(/invalid/i.test(error.message) ? "Contraseña incorrecta" : /fetch|network/i.test(error.message) ? "Sin conexión: el primer ingreso necesita señal" : error.message);
      operador = opFromUser(data.user);
      return operador;
    },
    async logout() {
      if (channel) { sb.removeChannel(channel); channel = null; }
      clearInterval(pollT);
      await sb.auth.signOut().catch(() => {});
      operador = null; server = { eventos: [], prestamos: {} }; outbox = []; persist();
    },
    start(eventoId) {
      current = eventoId || null;
      subscribeRealtime(); startPolling(); emit(); sync();
    },
    selectEvento(id) {
      if (id === current) return;
      current = id || null; subscribeRealtime(); emit(); pull().catch(() => {});
    },
    sync,

    eventos() { return view().ev.sort((a, b) => (b.creado || 0) - (a.creado || 0)); },
    prestamos(eventoId) { return view().pr[eventoId] || []; },

    addEvento(nombre) {
      const id = uuid();
      enqueue({ t: "eventos", k: "ins", data: { id, nombre, creado: Date.now() } });
      return id;
    },
    addPrestamo(p) {
      const row = { id: uuid(), ...p, entregadoPor: operador ? operador.nombre : "", devueltoPor: "" };
      enqueue({ t: "prestamos", k: "ins", data: row });
      return row;
    },
    updPrestamo(id, patch) {
      const data = { ...patch };
      if (patch.estado === "devuelto" && operador) data.devueltoPor = operador.nombre;
      enqueue({ t: "prestamos", k: "upd", id, data });
    },
    delPrestamo(id) { enqueue({ t: "prestamos", k: "del", id }); },
  };
})();
