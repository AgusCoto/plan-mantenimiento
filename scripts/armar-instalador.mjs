// Arma supabase/instalar.sql juntando las migraciones en orden, para pegarlo de una sola vez
// en Supabase → SQL Editor. Se ejecuta con: npm run sql
import fs from "node:fs";
import path from "node:path";
const dir = "supabase/migrations";
const partes = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const cab = `-- =====================================================================
-- Gestión de Planta · INSTALACIÓN / ACTUALIZACIÓN COMPLETA
-- Pegá todo este archivo en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin perder datos. Si el proyecto tenía W-Main, al final
-- migra sus datos (una sola vez) y muestra el resumen.
-- Generado con "npm run sql" a partir de supabase/migrations (no editar a mano).
-- =====================================================================
`;
const cuerpo = partes.map((f) => `\n-- >>>>>>>>>> ${f}\n` + fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
fs.writeFileSync("supabase/instalar.sql", cab + cuerpo);
console.log("supabase/instalar.sql:", partes.length, "migraciones");
