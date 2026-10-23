// Completa src/config.js con los datos de la base al publicar la web o generar los instaladores.
// Los toma de los secretos del repositorio (SUPABASE_URL y SUPABASE_ANON_KEY), así el código
// guardado en GitHub no los lleva y cada dispositivo nuevo solo pide usuario y contraseña.
import { writeFileSync } from "node:fs";
const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const key = (process.env.SUPABASE_ANON_KEY || "").trim();
const repo = process.env.GITHUB_REPOSITORY || "";
const [owner, name] = repo.split("/");
const publicUrl = (process.env.PUBLIC_URL || (owner && name ? `https://${owner.toLowerCase()}.github.io/${name}/` : "")).trim();
if (!url || !key) {
  console.log("Sin secretos SUPABASE_URL / SUPABASE_ANON_KEY: la app va a pedir la conexión la primera vez.");
  process.exit(0);
}
writeFileSync("src/config.js", `// Generado automáticamente al publicar (scripts/config-ci.mjs).
window.APP_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key, publicUrl }, null, 2)};
`);
console.log("config.js listo · base:", url, "· web:", publicUrl);
