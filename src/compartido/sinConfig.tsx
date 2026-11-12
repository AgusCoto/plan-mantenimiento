import { Mark } from "./logos";

/** Se muestra si la app se publicó sin los datos de Supabase (VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY). */
export function SinConfiguracion() {
  return (
    <div className="start" style={{ maxWidth: 560 }}>
      <div className="brand"><Mark area="mant" size={44} />Gestión de Planta</div>
      <h1>Falta conectar la base de datos</h1>
      <p className="muted">Esta publicación no tiene los datos de Supabase. En GitHub, cargá los secretos <span className="code">SUPABASE_URL</span> y{" "}
        <span className="code">SUPABASE_ANON_KEY</span> (Settings → Secrets and variables → Actions) y volvé a publicar. Los pasos están en el README.</p>
    </div>
  );
}
