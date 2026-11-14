// Mi cuenta: tema claro u oscuro, tamaño de texto y contraseña. Las preferencias son de cada uno.
import { useState } from "react";
import { useSesion } from "../datos/sesion";
import { useTema } from "../sistema/tema";
import { sb, falla, mensajeError } from "../datos/supabase";
import { Campo, Ventana, avisar } from "../comun/ui";
import { PanelPush } from "../comun/avisos";

export async function guardarPreferencias(usuarioId: string, p: Record<string, unknown>) {
  const { error } = await sb().from("preferencias_usuario").upsert({ usuario_id: usuarioId, ...p });
  if (error) throw falla(mensajeError(error));
}

export function MiCuenta() {
  const s = useSesion(), tema = useTema();
  const u = s.usuario!;
  const [modo, setModo] = useState(tema.preferencias.tema || "sistema");
  const [tam, setTam] = useState(tema.preferencias.tamano || tema.tokens.fuentes.tamano);
  return (
    <Ventana titulo="Mi cuenta" onSubmit={async (v) => {
      tema.setPreferencias({ tema: modo as "claro" | "oscuro" | "sistema", tamano: tam as "chico" | "normal" | "grande" });
      await guardarPreferencias(u.id, { tema: modo, tamano: tam });
      if (v.nueva || v.actual) {
        if (v.nueva.length < 8) throw falla("La contraseña nueva tiene que tener al menos 8 caracteres.");
        if (v.nueva !== v.repetir) throw falla("Las dos contraseñas nuevas no coinciden.");
        const { error } = await sb().rpc("cambiar_mi_clave", { p_actual: v.actual, p_nueva: v.nueva });
        if (error) throw falla(mensajeError(error));
      }
      avisar("Preferencias guardadas");
    }}>
      <p><b>{u.nombre}</b> · <span className="mono">{u.usuario}</span> · {tema.t(u.perfil)}</p>
      <div className="campo"><span>Tema</span>
        <div className="opciones" role="radiogroup">
          {([["sistema", "Según el celular o la PC"], ["claro", "Claro"], ["oscuro", "Oscuro"]] as const).map(([k, n]) => (
            <label key={k}><input type="radio" name="modo" checked={modo === k} onChange={() => { setModo(k); tema.setPreferencias({ tema: k }); }} /><span>{n}</span></label>
          ))}
        </div></div>
      <div className="campo"><span>Tamaño del texto</span>
        <div className="opciones" role="radiogroup">
          {([["chico", "Chico"], ["normal", "Normal"], ["grande", "Grande"]] as const).map(([k, n]) => (
            <label key={k}><input type="radio" name="tam" checked={tam === k} onChange={() => { setTam(k); tema.setPreferencias({ tamano: k }); }} /><span>{n}</span></label>
          ))}
        </div></div>
      {u.perfil !== "operario" && <div className="campo"><span>Avisos en este celular</span><PanelPush /></div>}
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 40 }}>Cambiar la contraseña</summary>
        <div className="form" style={{ marginTop: "var(--e2)" }}>
          <Campo label="Contraseña actual"><input type="password" name="actual" autoComplete="current-password" /></Campo>
          <div className="fila">
            <Campo label="Nueva (mín. 8)"><input type="password" name="nueva" autoComplete="new-password" /></Campo>
            <Campo label="Repetila"><input type="password" name="repetir" autoComplete="new-password" /></Campo>
          </div>
        </div>
      </details>
    </Ventana>
  );
}
