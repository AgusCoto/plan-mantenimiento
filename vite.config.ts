import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Dos apps instalables con la misma base de código:
//   /            → Gestión (mantenimiento, producción, administración, dirección)
//   /operarios/  → Operarios
// La base relativa ("./") permite publicar en cualquier carpeta (GitHub Pages, Vercel, Netlify).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        gestion: resolve(__dirname, "index.html"),
        operarios: resolve(__dirname, "operarios/index.html"),
      },
    },
  },
});
