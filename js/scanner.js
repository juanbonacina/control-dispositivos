/* Escáner con cámara en vivo.
   - Códigos: BarcodeDetector nativo (Android/Chrome) o ZXing como respaldo (iOS).
   - DNI: PDF417.  SN: QR / Code128 / Code39 / DataMatrix / EAN, o texto vía OCR (Tesseract.js).
   Scanner.open({ kind: "sn" | "dni", title, onResult(valor, via) }) */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const el = {
    root: $("#scanner"), title: $("#scTitle"), video: $("#scVideo"), frame: $("#scFrame"),
    msg: $("#scMsg"), close: $("#scClose"), torch: $("#scTorch"), ocr: $("#scOCR"), file: $("#scFile"),
  };
  const FORMATS = {
    dni: { native: ["pdf417"], zx: () => [ZXing.BarcodeFormat.PDF_417] },
    sn: {
      native: ["qr_code", "code_128", "code_39", "data_matrix", "ean_13"],
      zx: () => [ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.DATA_MATRIX, ZXing.BarcodeFormat.EAN_13],
    },
  };

  let cur = null;          // { kind, onResult, stream, track, running, torchOn, detector }
  let ocrWorkerP = null;

  /* ---------- utilidades de imagen ---------- */
  function drawTo(src, sw, sh, crop, maxSide, rot = 0) {
    const cx = crop ? crop.x : 0, cy = crop ? crop.y : 0, cw = crop ? crop.w : sw, ch = crop ? crop.h : sh;
    const k = Math.min(1, maxSide / Math.max(cw, ch));
    const w = Math.round(cw * k), h = Math.round(ch * k);
    const c = document.createElement("canvas");
    const W = rot % 180 ? h : w, H = rot % 180 ? w : h;
    c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2); g.rotate(rot * Math.PI / 180);
    g.drawImage(src, cx, cy, cw, ch, -w / 2, -h / 2, w, h);
    return c;
  }
  function luminance(canvas) {
    const { width: w, height: h } = canvas;
    const px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const lum = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
    return { lum, w, h };
  }
  function zxingDecode(canvas, kind) {
    if (!window.ZXing) return null;
    const { lum, w, h } = luminance(canvas);
    const bm = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(lum, w, h)));
    const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
    try {
      if (kind === "dni") return new ZXing.PDF417Reader().decode(bm, hints).getText();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, FORMATS.sn.zx());
      return new ZXing.MultiFormatReader().decode(bm, hints).getText();
    } catch (e) { return null; }
  }
  async function nativeDetector(kind) {
    if (!("BarcodeDetector" in window)) return null;
    try {
      const sup = await BarcodeDetector.getSupportedFormats();
      const f = FORMATS[kind].native.filter(x => sup.includes(x));
      return f.length ? new BarcodeDetector({ formats: f }) : null;
    } catch (e) { return null; }
  }
  // Valida que lo leído sirva para el tipo pedido
  function accept(kind, text) {
    if (!text) return null;
    if (kind === "dni") return window.parseDNI(text) ? text : null;
    return text.trim() || null;
  }

  /* ---------- OCR ---------- */
  function getOCR() {
    if (!ocrWorkerP) ocrWorkerP = (async () => {
      if (!window.Tesseract) throw new Error("OCR no disponible (sin conexión la primera vez)");
      const w = await Tesseract.createWorker("eng");
      await w.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/:", tessedit_pageseg_mode: "6" });
      return w;
    })().catch(e => { ocrWorkerP = null; throw e; });
    return ocrWorkerP;
  }
  function preprocessForOCR(canvas) {
    const g = canvas.getContext("2d");
    const im = g.getImageData(0, 0, canvas.width, canvas.height), d = im.data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; d[i] = v; if (v < min) min = v; if (v > max) max = v; }
    const r = Math.max(1, max - min);
    for (let i = 0; i < d.length; i += 4) { const v = ((d[i] - min) * 255 / r) | 0; d[i] = d[i + 1] = d[i + 2] = v; }
    g.putImageData(im, 0, 0);
    return canvas;
  }
  function pickSerial(text) {
    const up = String(text).toUpperCase();
    const lab = up.match(/(?:S\/?N|SERIAL(?:\s*NO)?|N[º°O]?\s*SERIE)\s*[:#.\-]?\s*([A-Z0-9\-]{4,})/);
    if (lab) return lab[1];
    const toks = up.split(/[\s:/]+/).map(t => t.replace(/[^A-Z0-9\-]/g, "")).filter(t => t.length >= 4 && /\d/.test(t));
    toks.sort((a, b) => b.length - a.length);
    return toks[0] || null;
  }
  async function ocrCanvas(canvas) {
    const w = await getOCR();
    const { data } = await w.recognize(preprocessForOCR(canvas));
    return pickSerial(data.text);
  }

  /* ---------- ciclo de vida ---------- */
  function setMsg(t) { el.msg.textContent = t; }
  function cropFromVideo() {
    // Recorta el área visible dentro del marco guía (video con object-fit: cover)
    const v = el.video, vw = v.videoWidth, vh = v.videoHeight;
    const box = el.video.getBoundingClientRect(), fr = el.frame.getBoundingClientRect();
    const scale = Math.max(box.width / vw, box.height / vh);
    const offX = (vw * scale - box.width) / 2, offY = (vh * scale - box.height) / 2;
    const pad = 0.15; // margen extra para no cortar el código
    let x = (fr.left - box.left + offX) / scale, y = (fr.top - box.top + offY) / scale;
    let w = fr.width / scale, h = fr.height / scale;
    x -= w * pad; y -= h * pad; w *= 1 + 2 * pad; h *= 1 + 2 * pad;
    x = Math.max(0, x); y = Math.max(0, y); w = Math.min(vw - x, w); h = Math.min(vh - y, h);
    return { x, y, w, h };
  }
  async function loop(session) {
    let frame = 0;
    while (cur === session && session.running) {
      const v = el.video;
      if (v.readyState >= 2 && v.videoWidth) {
        let text = null;
        try {
          if (session.detector) {
            const r = await session.detector.detect(v);
            text = r.length ? r[0].rawValue : null;
          } else {
            const crop = cropFromVideo();
            const side = session.kind === "dni" ? 1600 : 1000;
            text = zxingDecode(drawTo(v, v.videoWidth, v.videoHeight, crop, side, frame % 4 === 3 ? 90 : 0), session.kind);
          }
        } catch (e) {}
        const ok = accept(session.kind, text);
        if (ok && cur === session) return done(ok, "código");
        frame++;
      }
      await new Promise(r => setTimeout(r, session.detector ? 120 : 60));
    }
  }
  function done(value, via) {
    const s = cur; if (!s) return;
    el.frame.classList.add("hit");
    try { navigator.vibrate && navigator.vibrate(50); } catch (e) {}
    setTimeout(() => { close(); s.onResult(value, via); }, 150);
    s.running = false;
  }
  async function open({ kind, title, onResult }) {
    if (cur) close();
    const session = { kind, onResult, running: true, torchOn: false };
    cur = session;
    el.title.textContent = title || "Escanear";
    el.frame.className = "sc-frame" + (kind === "dni" ? " dni" : "");
    el.ocr.classList.toggle("hide", kind !== "sn");
    el.torch.classList.add("hide"); el.torch.classList.remove("on");
    setMsg(kind === "dni" ? "Encuadrá el código de barras del DNI" : "Apuntá al código o al número de serie");
    el.root.classList.remove("hide");
    document.body.style.overflow = "hidden";
    if (kind === "sn") getOCR().catch(() => {}); // precarga

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMsg("La cámara en vivo necesita HTTPS. Usá 📷 Foto."); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (cur !== session) { stream.getTracks().forEach(t => t.stop()); return; }
      session.stream = stream;
      session.track = stream.getVideoTracks()[0];
      el.video.srcObject = stream;
      await el.video.play().catch(() => {});
      try {
        const caps = session.track.getCapabilities ? session.track.getCapabilities() : {};
        if (caps.torch) el.torch.classList.remove("hide");
        if (caps.focusMode && caps.focusMode.includes("continuous")) await session.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      } catch (e) {}
      session.detector = await nativeDetector(kind);
      loop(session);
    } catch (e) {
      setMsg(e && e.name === "NotAllowedError" ? "Permiso de cámara denegado. Habilitalo o usá 📷 Foto." : "No se pudo abrir la cámara. Usá 📷 Foto.");
    }
  }
  function close() {
    const s = cur; cur = null;
    if (s) { s.running = false; if (s.stream) s.stream.getTracks().forEach(t => t.stop()); }
    el.video.srcObject = null;
    el.root.classList.add("hide");
    el.frame.classList.remove("hit");
    document.body.style.overflow = "";
  }

  /* ---------- botones ---------- */
  el.close.onclick = close;
  el.torch.onclick = async () => {
    const s = cur; if (!s || !s.track) return;
    try { s.torchOn = !s.torchOn; await s.track.applyConstraints({ advanced: [{ torch: s.torchOn }] }); el.torch.classList.toggle("on", s.torchOn); }
    catch (e) { s.torchOn = false; }
  };
  el.ocr.onclick = async () => {
    const s = cur; if (!s) return;
    const v = el.video;
    if (!v.videoWidth) { setMsg("La cámara no está lista. Usá 📷 Foto."); return; }
    el.ocr.disabled = true; setMsg("Leyendo texto…");
    try {
      const c = drawTo(v, v.videoWidth, v.videoHeight, cropFromVideo(), 1600);
      const sn = await ocrCanvas(c);
      if (sn && cur === s) done(sn, "texto");
      else setMsg("No encontré un número de serie. Acercate, con buena luz, y probá de nuevo.");
    } catch (e) { setMsg(e.message || "No se pudo leer el texto."); }
    el.ocr.disabled = false;
  };
  el.file.onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; const s = cur; if (!f || !s) return;
    setMsg("Procesando foto…");
    try {
      let img;
      try { img = await createImageBitmap(f, { imageOrientation: "from-image" }); }
      catch (err) { const u = URL.createObjectURL(f); img = new Image(); img.src = u; await img.decode(); }
      let text = null;
      const det = s.detector || await nativeDetector(s.kind);
      if (det) { try { const r = await det.detect(img); text = r.length ? r[0].rawValue : null; } catch (err) {} }
      for (const side of [1800, 1200, 2600]) {
        for (const rot of [0, 90]) {
          if (accept(s.kind, text)) break;
          text = zxingDecode(drawTo(img, img.width, img.height, null, side, rot), s.kind);
          await new Promise(r => setTimeout(r, 0));
        }
        if (accept(s.kind, text)) break;
      }
      if (accept(s.kind, text) && cur === s) return done(accept(s.kind, text), "código");
      if (s.kind === "sn") {
        setMsg("Leyendo texto…");
        const sn = await ocrCanvas(drawTo(img, img.width, img.height, null, 2000));
        if (sn && cur === s) return done(sn, "texto");
      }
      setMsg(s.kind === "dni" ? "No encontré el código del DNI en la foto." : "No pude leer el SN en la foto.");
    } catch (err) { setMsg("No pude procesar la foto."); }
  };

  window.Scanner = { open, close };
})();
