/* Parser del código PDF417 del DNI argentino.
   Formato nuevo:  trámite@APELLIDO@NOMBRE@sexo@DNI@ejemplar@nacimiento@emisión@...
   Formato viejo:  @DNI   @ejemplar@...@APELLIDO@NOMBRE@nacionalidad@... */
(function (root) {
  "use strict";
  const normDNI = s => String(s || "").replace(/\D/g, "").replace(/^0+/, "");

  function parseDNI(raw) {
    const p = String(raw).split("@").map(s => s.trim());
    if (p.length >= 8) {
      if (p[0] === "" && /\d{6,9}/.test(p[1])) return { dni: normDNI(p[1]), apellido: p[4] || "", nombre: p[5] || "" };
      if (/^[A-Z]?\d{6,9}[A-Z]?$/i.test(p[4])) return { dni: normDNI(p[4]), apellido: p[1] || "", nombre: p[2] || "" };
    }
    const m = String(raw).match(/\b\d{7,8}\b/);
    return m ? { dni: normDNI(m[0]), apellido: "", nombre: "" } : null;
  }

  const api = { parseDNI, normDNI };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);
