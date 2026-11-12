/* Configuración. Completar con los datos del proyecto de Supabase:
   Supabase → Project Settings → API Keys.
   - supabaseUrl: "Project URL" (https://xxxx.supabase.co)
   - supabaseKey: la clave PÚBLICA ("publishable" sb_publishable_... o la "anon").
     Es pública por diseño: lo que protege los datos son las políticas RLS de supabase/schema.sql.
     NUNCA poner acá la clave secreta / service_role. */
window.APP_CONFIG = {
  supabaseUrl: "https://bdqbnydxxeypyotlxnwk.supabase.co",
  supabaseKey: "sb_publishable_JxGT-7W1z0iLndlvkqmusA_Xq7IxdbA",

  // Dominio ficticio para armar el email interno de cada usuario (javier@<dominio>).
  // Tiene que coincidir con el usado en supabase/crear-usuarios.mjs.
  emailDomain: "control-dispositivos.app",

  operadores: ["Javier", "Gastón", "Matías", "Julieta", "Julián", "Juan"],
};

// "Gastón" -> "gaston"
window.APP_CONFIG.emailDe = nombre =>
  nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".") + "@" + window.APP_CONFIG.emailDomain;
