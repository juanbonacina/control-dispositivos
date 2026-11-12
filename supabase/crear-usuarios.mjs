#!/usr/bin/env node
/* Crea (o resetea) los usuarios operadores en Supabase Auth y muestra sus contraseñas.
   Se corre UNA vez desde tu compu (Node 18+), nunca desde el celular:

     SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SECRET_KEY=sb_secret_xxx node supabase/crear-usuarios.mjs

   - SUPABASE_SECRET_KEY: Project Settings → API Keys → "secret" (o la "service_role" legacy).
     Es la llave maestra: no la pegues en el código ni la subas a GitHub.
   - Si un usuario ya existe, le genera una contraseña nueva.
   - Para un solo usuario:  node supabase/crear-usuarios.mjs Julieta
   - Para elegir la contraseña: OPERADOR_PASSWORD=xxxx node supabase/crear-usuarios.mjs Julieta */
import { randomInt } from "node:crypto";

const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DOMINIO = process.env.EMAIL_DOMAIN || "control-dispositivos.app"; // igual que js/config.js
const OPERADORES = ["Javier", "Gastón", "Matías", "Julieta", "Julián", "Juan"];

if (!URL_ || !KEY) { console.error("Faltan SUPABASE_URL y SUPABASE_SECRET_KEY"); process.exit(1); }

const emailDe = n => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".") + "@" + DOMINIO;
const ALF = "abcdefghjkmnpqrstuvwxyz23456789"; // sin caracteres que se confunden (l/1, o/0)
const genPass = () => Array.from({ length: 10 }, () => ALF[randomInt(ALF.length)]).join("");
const headers = { apikey: KEY, "Content-Type": "application/json", ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}) };

async function api(path, init = {}) {
  const r = await fetch(`${URL_}/auth/v1${path}`, { ...init, headers });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${body.msg || body.message || body.error_description || JSON.stringify(body)}`);
  return body;
}
async function listarUsuarios() {
  const out = [];
  for (let page = 1; ; page++) {
    const b = await api(`/admin/users?page=${page}&per_page=200`);
    out.push(...(b.users || []));
    if (!b.users || b.users.length < 200) return out;
  }
}

const pedidos = process.argv.slice(2);
const lista = pedidos.length ? OPERADORES.filter(n => pedidos.some(p => emailDe(p) === emailDe(n))) : OPERADORES;
if (!lista.length) { console.error("Nombre no reconocido. Opciones:", OPERADORES.join(", ")); process.exit(1); }

const existentes = await listarUsuarios();
const filas = [];
for (const nombre of lista) {
  const email = emailDe(nombre);
  const password = process.env.OPERADOR_PASSWORD || genPass();
  const u = existentes.find(x => x.email === email);
  try {
    if (u) await api(`/admin/users/${u.id}`, { method: "PUT", body: JSON.stringify({ password, user_metadata: { nombre } }) });
    else await api(`/admin/users`, { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { nombre } }) });
    filas.push({ Usuario: nombre, Contraseña: password, Estado: u ? "contraseña nueva" : "creado" });
  } catch (e) {
    filas.push({ Usuario: nombre, Contraseña: "-", Estado: "ERROR " + e.message });
  }
}
console.table(filas);
console.log("Pasale a cada uno su contraseña por privado. En la app eligen su nombre y la escriben.");
