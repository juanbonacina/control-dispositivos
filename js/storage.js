/* Almacenamiento local (localStorage). Toda la persistencia pasa por acá,
   así se puede reemplazar por un backend (Supabase, Firebase, API propia)
   sin tocar el resto de la app. */
(function () {
  "use strict";
  const KEY = "dc_data_v1";
  const listeners = new Set();

  function read() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || "null");
      if (d && Array.isArray(d.eventos) && Array.isArray(d.prestamos)) return d;
    } catch (e) {}
    return { eventos: [], prestamos: [] };
  }
  function write(d) {
    localStorage.setItem(KEY, JSON.stringify(d));
    listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  window.Store = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    eventos() { return read().eventos.slice().sort((a, b) => (b.creado || 0) - (a.creado || 0)); },
    prestamos(eventoId) { return read().prestamos.filter(p => p.evento === eventoId); },
    addEvento(nombre) {
      const d = read(); const ev = { id: uid("e"), nombre, creado: Date.now() };
      d.eventos.push(ev); write(d); return ev.id;
    },
    addPrestamo(p) {
      const d = read(); const row = { id: uid("p"), ...p };
      d.prestamos.push(row); write(d); return row;
    },
    updPrestamo(id, patch) {
      const d = read(); const x = d.prestamos.find(p => p.id === id);
      if (x) { Object.assign(x, patch); write(d); }
    },
    delPrestamo(id) {
      const d = read(); d.prestamos = d.prestamos.filter(p => p.id !== id); write(d);
    },
    exportAll() { return read(); },
    importAll(data, { merge = true } = {}) {
      if (!data || !Array.isArray(data.eventos) || !Array.isArray(data.prestamos)) throw new Error("Archivo inválido");
      const d = merge ? read() : { eventos: [], prestamos: [] };
      const evIds = new Set(d.eventos.map(e => e.id)), pIds = new Set(d.prestamos.map(p => p.id));
      let n = 0;
      data.eventos.forEach(e => { if (!evIds.has(e.id)) { d.eventos.push(e); evIds.add(e.id); } });
      data.prestamos.forEach(p => { if (!pIds.has(p.id)) { d.prestamos.push(p); pIds.add(p.id); n++; } });
      write(d); return n;
    },
  };
})();
