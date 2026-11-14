// Campanita de avisos (en la barra) y activación de las notificaciones push en este celular.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDatos } from "../datos/store";
import { useSesion } from "../datos/sesion";
import { sb } from "../datos/supabase";
import { activarPush, desactivarPush, estadoPush, esIPhone, type EstadoPush } from "../datos/push";
import { Ventana, abrir, avisar, cerrar } from "./ui";
import { hace, fdt } from "./formato";
import { Ico } from "../sistema/iconos";

/** Activar o desactivar las notificaciones en este celular (con la guía para iPhone). */
export function PanelPush() {
  const [e, setE] = useState<EstadoPush | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const revisar = () => estadoPush().then(setE).catch(() => setE("no_soportado"));
  useEffect(() => { revisar(); }, []);
  if (!e) return null;
  const accion = async (fn: () => Promise<void>, ok: string) => {
    setOcupado(true);
    try { await fn(); avisar(ok); } catch (x) { avisar((x as { msg?: string }).msg || "No se pudo."); }
    setOcupado(false); revisar();
  };
  return (
    <div className="form" style={{ gap: "var(--e2)" }}>
      {e === "activo" && <><p className="chico" style={{ margin: 0 }}>✓ Este celular recibe los avisos aunque la app esté cerrada.</p>
        <div className="botones"><button type="button" className="boton chico" disabled={ocupado} onClick={() => accion(desactivarPush, "Avisos desactivados en este celular")}>Desactivar en este celular</button></div></>}
      {e === "inactivo" && <><p className="chico" style={{ margin: 0 }}>Activá los avisos para enterarte al momento de una máquina parada o de una orden asignada, aunque la app esté cerrada.</p>
        <button type="button" className="boton pri" disabled={ocupado} onClick={() => accion(activarPush, "Listo: este celular recibe los avisos")}><Ico n="aviso" />{ocupado ? "Activando…" : "Activar avisos en este celular"}</button></>}
      {e === "bloqueado" && <p className="nota chico" style={{ margin: 0 }}>Las notificaciones están bloqueadas para esta app. Habilitalas en la configuración del navegador (candado al lado de la dirección → Notificaciones → Permitir) y volvé a esta pantalla.</p>}
      {e === "instalar_iphone" && <div className="nota chico" style={{ margin: 0 }}>
        <b>En iPhone, los avisos llegan solo con la app instalada:</b>
        <ol style={{ margin: "var(--e1) 0 0", paddingLeft: 20 }}>
          <li>Abrí esta página en <b>Safari</b>.</li>
          <li>Tocá el botón <b>Compartir</b> (el cuadrado con la flecha hacia arriba).</li>
          <li>Elegí <b>«Agregar a inicio»</b> y confirmá.</li>
          <li>Abrí la app desde el ícono nuevo, ingresá y volvé acá para activar los avisos.</li>
        </ol>Hace falta iOS 16.4 o más nuevo.</div>}
      {e === "no_soportado" && <p className="chico suave" style={{ margin: 0 }}>{esIPhone() ? "Este iPhone necesita iOS 16.4 o más nuevo para recibir avisos." : "Este navegador no recibe notificaciones. Usá Chrome en Android o en la computadora."} Los avisos igual se ven en la campanita.</p>}
      {e === "sin_configurar" && <p className="chico suave" style={{ margin: 0 }}>Las notificaciones push todavía no están configuradas en el servidor (ver README → Avisos). Los avisos se ven en la campanita.</p>}
    </div>
  );
}

function ListaAvisos() {
  const d = useDatos(), nav = useNavigate();
  const l = d.avisos.slice(0, 60);
  const ir = (url: string | null) => { cerrar(); if (url) nav(url); };
  return (
    <Ventana titulo="Avisos">
      <PanelPush />
      {l.length ? <div className="lista" style={{ marginTop: "var(--e3)" }}>{l.map((a) => (
        <button key={a.id} className="item" onClick={() => ir(a.url)} style={{ textAlign: "left", width: "100%", font: "inherit", color: "inherit", background: a.leido_en ? "none" : "var(--acento-suave)", cursor: "pointer" }}>
          <div className="cuerpo-item"><div className="t">{a.titulo}</div><div className="meta"><span title={fdt(a.creado_en)}>{hace(a.creado_en)}</span>{a.cuerpo && <span>{a.cuerpo}</span>}</div></div>
        </button>))}</div> : <p className="vacio">Todavía no hay avisos.</p>}
    </Ventana>
  );
}

export function Campanita() {
  const d = useDatos(), s = useSesion();
  const sinLeer = d.avisos.filter((a) => !a.leido_en).length;
  if (s.usuario!.perfil === "operario") return null;
  return (
    <button type="button" className="boton chico campanita" aria-label={sinLeer ? `Avisos: ${sinLeer} sin leer` : "Avisos"} onClick={async () => {
      abrir(<ListaAvisos />);
      if (sinLeer) { await sb().rpc("marcar_avisos_leidos", { p_hasta: d.avisos[0]?.id ?? null }); setTimeout(() => d.recargar("avisos"), 1500); }
    }}><Ico n="aviso" />{sinLeer > 0 && <span className="insignia">{sinLeer > 99 ? "99+" : sinLeer}</span>}</button>
  );
}
