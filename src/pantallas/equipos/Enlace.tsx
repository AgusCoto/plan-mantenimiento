// /e/<código>: el enlace de las etiquetas QR y NFC. Lleva a una pantalla distinta según el perfil:
// operario → reporte de falla con el equipo elegido · técnico → historial y órdenes · resto → ficha completa.
// Sin sesión, la app pide ingresar y después vuelve acá.
import { Navigate, useParams, Link } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";

export function Enlace() {
  const { codigo = "" } = useParams();
  const d = useDatos(), s = useSesion(), tema = useTema();
  const e = d.buscarEquipo(decodeURIComponent(codigo));
  if (!e) return (
    <><h1>{tema.t("equipo")} {codigo}</h1>
      <p className="suave">No encontramos ese equipo, o es de una empresa a la que no tenés acceso. Si creés que es un error, hablá con el jefe de mantenimiento.</p>
      <Link className="boton" to="/">Ir al inicio</Link></>
  );
  const p = s.usuario!.perfil;
  if (p === "operario") return <Navigate to={"/reportar/" + e.id} replace />;
  if (p === "tecnico") return <Navigate to={"/equipos/" + e.id + "?vista=tecnico"} replace />;
  return <Navigate to={"/equipos/" + e.id} replace />;
}
