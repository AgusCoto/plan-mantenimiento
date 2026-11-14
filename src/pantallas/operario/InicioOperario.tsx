// Inicio del operario: un botón grande para reportar y sus últimos reportes.
// Lo normal es escanear la etiqueta con la cámara del celular, que abre el reporte de esa máquina.
import { Link } from "react-router-dom";
import { useTema } from "../../sistema/tema";
import { useSesion } from "../../datos/sesion";
import { useDatos } from "../../datos/store";
import { Ico } from "../../sistema/iconos";
import { MisReportes } from "./Reportar";

export function InicioOperario() {
  const tema = useTema(), s = useSesion(), d = useDatos();
  const tel = d.conf<string>("telefono_mantenimiento", "");
  return (
    <>
      <div><h1>Hola, {s.usuario!.nombre.split(" ")[0]}</h1><p className="suave">Para reportar, escaneá la etiqueta de la máquina con la cámara del celular.</p></div>
      <div className="mosaicos">
        <Link className="mosaico grande" to="/reportar"><span className="ic"><Ico n="reportes" /></span><span><b>{tema.t("reportar")}</b><br /><small>Escanear la etiqueta o buscar la máquina</small></span></Link>
        {tel && <a className="mosaico" href={"tel:" + tel.replace(/[^\d+]/g, "")}><span className="ic"><Ico n="aviso" /></span><b>Llamar</b><small>Mantenimiento · {tel}</small></a>}
      </div>
      <section className="panel"><h2 style={{ marginTop: 0 }}>Mis reportes</h2><MisReportes limite={15} /></section>
    </>
  );
}
