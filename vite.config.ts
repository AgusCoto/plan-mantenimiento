import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En GitHub Pages la app vive en /plan-mantenimiento/ (la publicación la arma .github/workflows/publicar.yml).
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  build: { chunkSizeWarningLimit: 900 },
});
