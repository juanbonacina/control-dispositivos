(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const normSN = s => String(s || "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9\-_.:/]/g, "");
  const normDNI = window.normDNI;
  const fmtT = ms => ms ? new Date(ms).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  const titleCase = s => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  const pref = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

  const S = {
    tab: "entregar", step: "sn", sn: "", dni: "", nombre: "", loan: null,
    msgSN: null, msgDNI: null, armForce: false,
    evento: pref.get("dc_evento", ""), filtro: "pend", q: "", armDel: null,
  };
  const prestamos = () => S.evento ? Store.prestamos(S.evento) : [];
  const activoPorSN = sn => prestamos().find(p => p.sn === sn && p.estado === "entregado");

  let toastT;
  function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2600); }

  /* ---------- Eventos ---------- */
  function renderEventos() {
    const evs = Store.eventos();
    if (!evs.some(e => e.id === S.evento)) { S.evento = evs[0] ? evs[0].id : ""; pref.set("dc_evento", S.evento); }
    $("#evSel").innerHTML = evs.length
      ? evs.map(e => `<option value="${esc(e.id)}"${e.id === S.evento ? " selected" : ""}>${esc(e.nombre)}</option>`).join("")
      : `<option value="">Sin eventos — creá uno</option>`;
    if (!evs.length) $("#evForm").classList.remove("hide");
  }
  $("#evSel").onchange = e => { S.evento = e.target.value; pref.set("dc_evento", S.evento); resetFlow(); renderAll(); };
  $("#evNew").onclick = () => { $("#evForm").classList.remove("hide"); $("#menu").classList.add("hide"); $("#evName").focus(); };
  $("#evCancel").onclick = () => { if (Store.eventos().length) $("#evForm").classList.add("hide"); };
  $("#evSave").onclick = () => {
    const n = $("#evName").value.trim(); if (!n) { $("#evName").focus(); return; }
    S.evento = Store.addEvento(n); pref.set("dc_evento", S.evento);
    $("#evName").value = ""; $("#evForm").classList.add("hide"); resetFlow(); renderAll(); toast("Evento creado");
  };
  $("#evName").onkeydown = e => { if (e.key === "Enter") $("#evSave").click(); };

  /* ---------- Menú de datos ---------- */
  $("#menuBtn").onclick = () => $("#menu").classList.toggle("hide");
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const slug = s => String(s || "evento").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const today = () => new Date().toISOString().slice(0, 10);
  $("#expCSV").onclick = () => {
    const ev = Store.eventos().find(e => e.id === S.evento); if (!ev) return toast("No hay evento seleccionado");
    const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = prestamos().sort((a, b) => (a.entregado || 0) - (b.entregado || 0));
    const lines = [["Evento", "SN", "DNI", "Nombre", "Estado", "Entregado", "Devuelto", "Forzado"].join(";")]
      .concat(rows.map(p => [ev.nombre, p.sn, p.dni, p.nombre, p.estado, fmtT(p.entregado), fmtT(p.devuelto), p.forzado ? "sí" : ""].map(cell).join(";")));
    download(`${slug(ev.nombre)}-${today()}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
  };
  $("#expJSON").onclick = () => download(`backup-dispositivos-${today()}.json`, JSON.stringify(Store.exportAll(), null, 1), "application/json");
  $("#impJSON").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { const n = Store.importAll(JSON.parse(await f.text())); renderAll(); toast(`Backup restaurado (${n} registros nuevos)`); }
    catch (err) { toast("Archivo inválido"); }
  };

  /* ---------- Flujo ---------- */
  function resetFlow() { Object.assign(S, { step: "sn", sn: "", dni: "", nombre: "", loan: null, msgSN: null, msgDNI: null, armForce: false }); }

  function scanSN() {
    Scanner.open({
      kind: "sn", title: "Serial del dispositivo",
      onResult: (v, via) => {
        S.sn = normSN(v);
        S.msgSN = { t: via === "texto" ? "warn" : "ok", m: via === "texto" ? "SN leído por OCR: verificá que coincida con el equipo." : "SN leído." };
        renderWizard();
        if (via !== "texto") nextFromSN(); // lectura de código = confiable, avanza solo
      },
    });
  }
  function scanDNI() {
    Scanner.open({
      kind: "dni", title: "DNI de la persona",
      onResult: raw => {
        const d = window.parseDNI(raw);
        if (!d) { S.msgDNI = { t: "err", m: "No reconocí el código del DNI." }; return renderWizard(); }
        S.dni = d.dni; S.nombre = titleCase([d.nombre, d.apellido].filter(Boolean).join(" ")); S.msgDNI = null;
        renderWizard();
      },
    });
  }

  function nextFromSN() {
    const inp = $("#inSN"); const sn = normSN(inp ? inp.value : S.sn);
    if (!sn) { S.msgSN = { t: "err", m: "Escaneá o escribí el SN." }; return renderWizard(); }
    if (!S.evento) { S.msgSN = { t: "err", m: "Primero creá o elegí un evento." }; return renderWizard(); }
    S.sn = sn;
    const act = activoPorSN(sn);
    if (S.tab === "entregar" && act) {
      S.msgSN = { t: "err", m: `Este SN ya está entregado a ${act.nombre || "—"} (DNI ${act.dni}) desde ${fmtT(act.entregado)}` };
      vibrate([80, 60, 80]); return renderWizard();
    }
    if (S.tab === "devolver") {
      if (!act) { S.msgSN = { t: "err", m: "Este SN no figura como entregado en este evento." }; vibrate([80, 60, 80]); return renderWizard(); }
      S.loan = act;
    }
    Object.assign(S, { step: "dni", msgSN: null, msgDNI: null, dni: "", nombre: "" });
    renderWizard();
  }

  function confirmar(force) {
    const dni = normDNI($("#inDNI") ? $("#inDNI").value : S.dni);
    const nombre = $("#inNom") ? $("#inNom").value.trim() : S.nombre;
    if (!force && !dni) { S.msgDNI = { t: "err", m: "Falta el DNI." }; return renderWizard(); }
    S.dni = dni; S.nombre = nombre;
    if (S.tab === "entregar") {
      if (activoPorSN(S.sn)) { S.msgDNI = { t: "err", m: "Este SN ya figura entregado." }; return renderWizard(); }
      Store.addPrestamo({ evento: S.evento, sn: S.sn, dni, nombre, estado: "entregado", entregado: Date.now(), devuelto: null });
      toast(`✓ ${S.sn} entregado a ${nombre || "DNI " + dni}`);
    } else {
      const loan = S.loan;
      if (!force && normDNI(loan.dni) !== dni) {
        S.msgDNI = { t: "err", m: `El DNI no coincide. Este dispositivo se entregó a ${loan.nombre || "otra persona"} (DNI terminado en ${String(loan.dni).slice(-3)}).` };
        vibrate([120, 80, 120]); return renderWizard();
      }
      Store.updPrestamo(loan.id, { estado: "devuelto", devuelto: Date.now(), ...(force ? { forzado: true, dniDevolucion: dni || null } : {}) });
      toast(`✓ ${S.sn} devuelto${force ? " (forzado)" : ""}`);
    }
    vibrate(60); resetFlow(); renderWizard();
  }

  /* ---------- Render: asistente ---------- */
  const msgHTML = m => m ? `<div class="msg ${m.t}">${esc(m.m)}</div>` : "";
  function renderWizard() {
    const w = $("#wizard");
    if (S.tab === "resumen") { w.classList.add("hide"); return; }
    w.classList.remove("hide");
    const dev = S.tab === "devolver";
    if (S.step === "sn") {
      w.innerHTML = `<div class="card stack">
        <h2>${dev ? "Devolución" : "Entrega"} · 1. Serial del dispositivo</h2>
        <button class="btn cam" id="camSN">📷 Escanear SN</button>
        <input id="inSN" placeholder="o escribí el SN" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(S.sn)}">
        ${msgHTML(S.msgSN)}
        <button class="btn2" id="btnSN">Siguiente →</button>
      </div>`;
      $("#camSN").onclick = scanSN;
      $("#btnSN").onclick = nextFromSN;
      $("#inSN").onkeydown = e => { if (e.key === "Enter") nextFromSN(); };
      return;
    }
    const loan = S.loan;
    const match = dev && S.dni && normDNI(loan.dni) === S.dni;
    const mismatch = dev && S.dni && !match;
    w.innerHTML = `<div class="card stack">
      <h2>${dev ? "Devolución" : "Entrega"} · 2. DNI de la persona</h2>
      <div><span class="muted">SN</span><div class="big">${esc(S.sn)}</div></div>
      ${dev ? `<div class="msg info" style="color:var(--tx)">Entregado a <b>${esc(loan.nombre || "—")}</b> · DNI ${esc(loan.dni)} · ${esc(fmtT(loan.entregado))}</div>` : ""}
      <button class="btn cam" id="camDNI">🪪 Escanear DNI</button>
      <input id="inDNI" inputmode="numeric" placeholder="o escribí el DNI" value="${esc(S.dni)}">
      ${dev ? (S.nombre ? `<p class="muted">Leído: ${esc(S.nombre)}</p>` : "") : `<input id="inNom" placeholder="Nombre (se completa al escanear)" value="${esc(S.nombre)}">`}
      ${match ? `<div class="msg ok">✓ El DNI coincide</div>` : ""}
      ${mismatch && !S.msgDNI ? `<div class="msg err">✗ El DNI no coincide con el de la entrega</div>` : ""}
      ${msgHTML(S.msgDNI)}
      <button class="btn ok" id="btnOK">${dev ? "Confirmar devolución" : "Confirmar entrega"}</button>
      <button class="btn2" id="btnBack">← Cambiar SN</button>
      ${dev ? (S.armForce
        ? `<div class="msg warn stack">Vas a marcarlo devuelto sin que coincida el DNI. Queda registrado como forzado.<div class="row"><button class="btn2 btn-sm" id="fNo">Cancelar</button><button class="btn btn-sm" id="fYes" style="background:var(--warn)">Forzar</button></div></div>`
        : `<button class="link" id="btnForce">Devolver sin DNI (forzar)</button>`) : ""}
    </div>`;
    $("#camDNI").onclick = scanDNI;
    $("#btnOK").onclick = () => confirmar(false);
    $("#btnBack").onclick = () => { S.step = "sn"; S.msgSN = null; S.armForce = false; renderWizard(); };
    $("#inDNI").oninput = e => { S.dni = normDNI(e.target.value); S.msgDNI = null; };
    $("#inDNI").onkeydown = e => { if (e.key === "Enter") confirmar(false); };
    if ($("#inNom")) $("#inNom").oninput = e => { S.nombre = e.target.value; };
    if ($("#btnForce")) $("#btnForce").onclick = () => { S.armForce = true; renderWizard(); };
    if ($("#fNo")) $("#fNo").onclick = () => { S.armForce = false; renderWizard(); };
    if ($("#fYes")) $("#fYes").onclick = () => { S.armForce = false; confirmar(true); };
  }

  /* ---------- Render: resumen ---------- */
  function renderSummary() {
    const el = $("#summary");
    if (S.tab !== "resumen") { el.classList.add("hide"); return; }
    el.classList.remove("hide");
    const all = prestamos();
    const pend = all.filter(p => p.estado === "entregado"), devs = all.filter(p => p.estado === "devuelto");
    const personas = new Set(pend.map(p => p.dni)).size;
    const q = S.q.trim().toLowerCase();
    let rows = S.filtro === "pend" ? pend : S.filtro === "dev" ? devs : all;
    if (q) rows = rows.filter(p => [p.sn, p.dni, p.nombre].some(v => String(v || "").toLowerCase().includes(q)));
    rows = rows.slice().sort((a, b) => Math.max(b.entregado || 0, b.devuelto || 0) - Math.max(a.entregado || 0, a.devuelto || 0));
    const focused = document.activeElement && document.activeElement.id === "q";
    el.innerHTML = `
      <div class="stats">
        <div class="stat"><b>${pend.length}</b><span>Entregados sin devolver</span></div>
        <div class="stat"><b>${devs.length}</b><span>Devueltos</span></div>
        <div class="stat"><b>${all.length}</b><span>Entregas totales</span></div>
        <div class="stat"><b>${personas}</b><span>Personas con equipo</span></div>
      </div>
      <div class="card">
        <div class="filters">
          <button data-f="pend" class="${S.filtro === "pend" ? "on" : ""}">Pendientes (${pend.length})</button>
          <button data-f="dev" class="${S.filtro === "dev" ? "on" : ""}">Devueltos (${devs.length})</button>
          <button data-f="all" class="${S.filtro === "all" ? "on" : ""}">Todos (${all.length})</button>
        </div>
        <input id="q" type="search" placeholder="Buscar SN, DNI o nombre" value="${esc(S.q)}" style="margin-bottom:8px">
        ${rows.length ? `<ul class="list">${rows.map(p => `
          <li>
            <div class="li-main">
              <div class="li-sn">${esc(p.sn)}</div>
              <div>${esc(p.nombre || "Sin nombre")} · DNI ${esc(p.dni || "—")}</div>
              <div class="li-sub">Entregado ${esc(fmtT(p.entregado))}${p.devuelto ? " · Devuelto " + esc(fmtT(p.devuelto)) : ""}${p.forzado ? " · forzado" : ""}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <span class="badge ${p.estado === "entregado" ? "pend" : "dev"}">${p.estado === "entregado" ? "Entregado" : "Devuelto"}</span>
              <button class="x ${S.armDel === p.id ? "arm" : ""}" data-del="${esc(p.id)}">${S.armDel === p.id ? "¿Borrar?" : "✕"}</button>
            </div>
          </li>`).join("")}</ul>` : `<div class="empty">${S.evento ? "Nada para mostrar" : "Creá un evento para empezar"}</div>`}
      </div>`;
    el.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { S.filtro = b.dataset.f; renderSummary(); });
    const qi = $("#q"); qi.oninput = e => { S.q = e.target.value; renderSummary(); };
    if (focused) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      const id = b.dataset.del;
      if (S.armDel !== id) { S.armDel = id; renderSummary(); setTimeout(() => { if (S.armDel === id) { S.armDel = null; renderSummary(); } }, 3000); return; }
      S.armDel = null; Store.delPrestamo(id); toast("Registro borrado");
    });
  }

  /* ---------- Tabs ---------- */
  $("#tabs").onclick = e => {
    const b = e.target.closest("[data-tab]"); if (!b) return;
    if (b.dataset.tab !== S.tab) {
      const wasFlow = S.tab !== "resumen", toFlow = b.dataset.tab !== "resumen";
      S.tab = b.dataset.tab; if (wasFlow && toFlow) resetFlow();
    }
    document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x === b));
    renderWizard(); renderSummary();
  };

  function renderAll() { renderEventos(); renderWizard(); renderSummary(); }
  Store.subscribe(renderSummary);
  window.addEventListener("storage", renderAll); // otra pestaña
  renderAll();

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
