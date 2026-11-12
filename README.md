# Control de dispositivos

Web app mobile para controlar la entrega y devolución de dispositivos en eventos, compartida entre varios operadores.

- **Entregar:** escaneás el SN del dispositivo → escaneás el DNI de la persona → queda registrado como entregado, con quién lo entregó.
- **Devolver:** escaneás el SN → escaneás el DNI → si coincide con el de la entrega, se marca como devuelto, con quién lo recibió. Si no coincide, lo rechaza (hay una opción "forzar" que queda registrada).
- **Resumen:** entregados sin devolver, devueltos, totales, personas con equipo, conteo por operador, búsqueda por SN / DNI / nombre, CSV.

Frontend estático (HTML + CSS + JS, sin build) en GitHub Pages + base de datos en **Supabase**.

## Usuarios

Javier, Gastón, Matías, Julieta, Julián y Juan. Cada uno entra eligiendo su nombre y su contraseña; la sesión queda guardada en el celular. Quién entregó y quién recibió lo registra la base (trigger), no el celular, así que no se puede falsear.

Para cambiar la lista: `js/config.js` (`operadores`) y `supabase/crear-usuarios.mjs` (`OPERADORES`).

## Sin señal

Las entregas y devoluciones se guardan al instante en el celular y se envían solas cuando vuelve la conexión (indicador arriba a la derecha: ✓ Sincronizado / ⚠ Sin conexión · N sin enviar). Los cambios de los otros celulares llegan en tiempo real.

Si dos celulares entregan el mismo SN estando sin señal, la base acepta el primero que llega y el otro recibe un aviso: *"No se guardó la entrega de SN…: otro operador ya lo había entregado"*.

El primer ingreso de cada usuario necesita conexión.

## Puesta en marcha (una sola vez)

1. **Crear el proyecto** en [supabase.com](https://supabase.com) (plan Free alcanza).
2. **Base de datos:** SQL Editor → pegar `supabase/schema.sql` completo → Run.
3. **Usuarios:** desde tu compu, con Node 18+:
   ```bash
   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SECRET_KEY=sb_secret_xxx node supabase/crear-usuarios.mjs
   ```
   Imprime la contraseña de cada uno. Para resetear una sola: `node supabase/crear-usuarios.mjs Julieta`.
   La clave **secret** es la llave maestra: se usa solo en este comando, nunca va al código.
4. **Conectar la app:** en `js/config.js` completar `supabaseUrl` y `supabaseKey` con la clave **publishable** (o la `anon`). Esa clave es pública por diseño: los datos los protegen las políticas RLS del schema (sin usuario no se puede leer ni escribir nada).
5. Commit + push. GitHub Pages publica solo.

Opcional, en Supabase → Authentication → Sign In / Providers: desactivar **Allow new users to sign up**, así nadie más puede crearse una cuenta.

## Lectura de códigos

| Qué | Cómo |
|---|---|
| DNI argentino | Código PDF417 (formato nuevo y viejo). Completa DNI y nombre. |
| SN con código | QR, Code 128, Code 39, DataMatrix, EAN-13 |
| SN escrito | Botón **🔤 Leer texto** (OCR con Tesseract.js). Siempre verificar. |
| Sin cámara en vivo | Botón **📷 Foto** dentro del escáner |

Usa `BarcodeDetector` nativo donde existe (Chrome Android) y [ZXing](https://github.com/zxing-js/library) como respaldo (iOS). La cámara requiere HTTPS (GitHub Pages ya lo da).

## Estructura

```
index.html
css/styles.css
js/config.js          URL y clave pública de Supabase, lista de operadores
js/app.js             login, flujo entregar / devolver / resumen
js/storage.js         Supabase + caché local + cola offline + tiempo real
js/scanner.js         cámara en vivo, códigos, OCR, foto
js/dni.js             parser del PDF417 del DNI
supabase/schema.sql   tablas, seguridad (RLS), auditoría de operador, tiempo real
supabase/crear-usuarios.mjs
sw.js                 cache offline (subir CACHE al cambiar archivos)
manifest.webmanifest  instalable como app
```

## Datos personales

La base guarda DNI y nombre de los asistentes. No subas al repo CSV ni exportaciones (el `.gitignore` ya los excluye) y borrá los eventos viejos cuando no se necesiten más (Supabase → Table Editor → `eventos`; borra sus préstamos en cascada).
