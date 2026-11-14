// Ingreso con usuario y contraseña. Después vuelve a donde quería ir (por ejemplo, el equipo escaneado).
import { useState, type FormEvent } from "react";
import { useSesion } from "../datos/sesion";
import { useTema } from "../sistema/tema";
import { Logo } from "../sistema/logos";

export function Ingreso({ volverA }: { volverA: string }) {
  const s = useSesion(), tema = useTema();
  const [err, setErr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const equipo = /^\/e\/([^/]+)/.exec(volverA)?.[1];
  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setOcupado(true); setErr(null);
    const e = await s.entrar(String(f.get("u") || ""), String(f.get("p") || ""));
    setOcupado(false);
    if (e) setErr(e);
  }
  const tk = tema.tokens;
  return (
    <div className="inicio" style={{ maxWidth: 440 }}>
      <div className="marca-app" style={{ color: "var(--tinta)" }}>
        {tk.marca.logo_url ? <img src={tk.marca.logo_url} alt="" /> : <Logo tema={tk} area="mant" tam={44} />}{tk.marca.nombre}
      </div>
      <div>
        <h1>Ingresar</h1>
        <p className="suave">Equipos, {tema.t("ordenes").toLowerCase()} y {tema.t("reportes").toLowerCase()} del grupo.
          {equipo && <> Después de ingresar se abre el equipo <span className="codigo">{decodeURIComponent(equipo)}</span>.</>}</p>
      </div>
      <form className="form panel" onSubmit={enviar}>
        <label className="campo"><span>Usuario</span><input type="text" id="l-u" name="u" required autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
        <label className="campo"><span>Contraseña</span><input type="password" id="l-p" name="p" required autoComplete="current-password" /></label>
        {(err || s.aviso) && <p className="chico" id="l-err" role="alert" style={{ color: "var(--critico)" }}>{err || s.aviso}</p>}
        <button className="boton pri grande" type="submit" disabled={ocupado}>{ocupado ? "Ingresando…" : "Ingresar"}</button>
      </form>
      <p className="suave chico">Si no tenés usuario o te olvidaste la contraseña, pedíselo al jefe de mantenimiento.</p>
    </div>
  );
}
