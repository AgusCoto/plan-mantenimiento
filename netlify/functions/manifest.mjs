// Manifiesto de la app armado con la marca del tema activo (nombre, íconos y colores que elige el jefe
// en Apariencia). Si la base no responde, devuelve el de fábrica.
const FABRICA = {
  name: "Mantenimiento", short_name: "Mantenimiento", lang: "es", id: "/", start_url: "/", scope: "/", display: "standalone",
  description: "Mantenimiento del grupo: equipos, órdenes de trabajo y reportes de falla",
  background_color: "#0B2A4A", theme_color: "#0B2A4A",
  icons: [
    { src: "/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
};
export default async () => {
  const url = (process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, ""), key = process.env.VITE_SUPABASE_ANON_KEY || "";
  let m = FABRICA;
  try {
    const r = await fetch(`${url}/rest/v1/temas?select=tokens&activo=eq.true&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const t = (await r.json())?.[0]?.tokens;
    if (t?.marca) {
      const nombre = String(t.marca.nombre || FABRICA.name).slice(0, 45);
      m = {
        ...FABRICA, name: nombre, short_name: nombre.slice(0, 12),
        background_color: t.marca.fondo_carga || FABRICA.background_color,
        theme_color: t.areas?.mant?.barra || FABRICA.theme_color,
        icons: t.marca.icono_192 && t.marca.icono_512 ? [
          { src: t.marca.icono_192, sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: t.marca.icono_512, sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ] : FABRICA.icons,
      };
    }
  } catch { /* se usa el de fábrica */ }
  return new Response(JSON.stringify(m), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=300" } });
};
