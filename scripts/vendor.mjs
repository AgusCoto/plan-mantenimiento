// Copia las librerías del navegador a src/vendor para que la app funcione sin CDN.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("src/vendor", { recursive: true });
copyFileSync("node_modules/@supabase/supabase-js/dist/umd/supabase.js", "src/vendor/supabase.js");
copyFileSync("node_modules/qrcode-generator/qrcode.js", "src/vendor/qrcode.js");
copyFileSync("node_modules/jsqr/dist/jsQR.js", "src/vendor/jsqr.js");
console.log("Librerías copiadas a src/vendor");
