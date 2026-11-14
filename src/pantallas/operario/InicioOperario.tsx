// Inicio del operario: reportar una falla en tres toques (se completa en el paso 4).
import { useTema } from "../../sistema/tema";
import { useSesion } from "../../datos/sesion";

export function InicioOperario() {
  const tema = useTema(), s = useSesion();
  return (
    <>
      <div><h1>Hola, {s.usuario!.nombre.split(" ")[0]}</h1><p className="suave">{tema.t("reportar")}: escaneá la etiqueta de la máquina.</p></div>
    </>
  );
}
