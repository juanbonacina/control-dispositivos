# Control de dispositivos

Web app mobile para controlar la entrega y devolución de dispositivos en eventos.

- **Entregar:** escaneás el SN del dispositivo → escaneás el DNI de la persona → queda registrado como entregado.
- **Devolver:** escaneás el SN → escaneás el DNI → si coincide con el de la entrega, se marca como devuelto. Si no coincide, lo rechaza (hay una opción "forzar" que queda registrada).
- **Resumen:** entregados sin devolver, devueltos, totales, personas con equipo, búsqueda por SN / DNI / nombre.

Sin build, sin dependencias para instalar: HTML + CSS + JS plano.

## Lectura

| Qué | Cómo |
|---|---|
| DNI argentino | Código PDF417 (formato nuevo y viejo). Completa DNI y nombre. |
| SN con código | QR, Code 128, Code 39, DataMatrix, EAN-13 |
| SN escrito | Botón **🔤 Leer texto** (OCR con Tesseract.js). Siempre verificar. |
| Sin cámara en vivo | Botón **📷 Foto** dentro del escáner |

Usa `BarcodeDetector` nativo donde existe (Chrome Android) y [ZXing](https://github.com/zxing-js/library) como respaldo (iOS). Linterna disponible en los equipos que la exponen.

## Datos

- Se guardan en el **localStorage del celular** (no hay servidor). Cada evento tiene su propio registro.
- Menú **⋯** → descargar CSV del evento (abre directo en Excel), backup completo en JSON y restaurar backup.
- Funciona **offline** después de la primera carga (service worker). El OCR descarga su modelo la primera vez que se usa: usalo una vez con conexión antes del evento.
- ⚠️ Si se borran los datos del navegador se pierde el registro: descargá el backup al cierre de cada evento.

## Publicar en GitHub Pages

1. Subí el repo a GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, carpeta `/ (root)`.
3. Abrí `https://<usuario>.github.io/<repo>/` en el celular. En Chrome/Safari: "Agregar a pantalla de inicio" para usarla como app.

La cámara **requiere HTTPS** (GitHub Pages ya lo da). En local:

```bash
python3 -m http.server 8080
# http://localhost:8080 funciona con cámara en la compu;
# para probar en el celular por la red local hace falta HTTPS (ej: ngrok, cloudflared).
```

## Estructura

```
index.html            UI
css/styles.css
js/app.js             flujo entregar / devolver / resumen
js/scanner.js         cámara en vivo, códigos, OCR, foto
js/dni.js             parser del PDF417 del DNI
js/storage.js         persistencia (localStorage) — único punto a cambiar para usar un backend
sw.js                 cache offline (subir CACHE al cambiar archivos)
manifest.webmanifest  instalable como app
```

## Próximos pasos posibles

- Sincronizar varios celulares en el mismo evento: reemplazar `js/storage.js` por Supabase / Firebase manteniendo la misma interfaz.
