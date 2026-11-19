// Movimientos desde la ficha del equipo: reubicar, préstamo a otra empresa,
// reparación externa, baja (motivo y destino) y marcar detenido u operativo.
// La empresa dueña nunca cambia; cambia «dónde está» y queda el movimiento en el historial.
import { useState } from "react";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";
import { llamar } from "../../datos/cola";
import { sb } from "../../datos/supabase";
import { Campo, Ventana, abrir, avisar, cerrar } from "../../comun/ui";
import { Captura, subirAdjuntos, type Medio } from "../../comun/archivos";
import { hoy } from "../../comun/formato";
import { Ico } from "../../sistema/iconos";
import type { Equipo } from "../../datos/tipos";

export const numero = (s: string | undefined) => (s ? Number(s.replace(/\./g, "").replace(",", ".")) : null);
const ocupado = (d: ReturnType<typeof useDatos>, e: Equipo) =>
  d.movimientos_equipo.find((m) => m.equipo_id === e.id && ["prestamo", "reparacion_externa"].includes(m.tipo) && ["solicitado", "aprobado", "en_curso"].includes(m.estado));

/** Fotos opcionales (remito, estado del equipo) que se adjuntan al movimiento recién creado. */
function useFotos() {
  const s = useSesion();
  const [medios, setMedios] = useState<Medio[]>([]);
  const ui = <Captura medios={medios} setMedios={setMedios} video={false} compacto titulo="Fotos (remito, estado del equipo) — opcional" />;
  const subirA = async (movId: string | null | undefined) => {
    if (!movId || !medios.length) return;
    try { await subirAdjuntos(s.usuario!.id, "movimientos_equipo", movId, medios); } catch { avisar("El movimiento se guardó, pero no se pudieron subir las fotos."); }
  };
  return { ui, subirA };
}
/** Id del último movimiento del equipo (las funciones de reubicar y baja no lo devuelven). */
async function ultimo(d: ReturnType<typeof useDatos>, e: Equipo, tipo: string) {
  await d.recargar("movimientos_equipo");
  const { data } = await sb().from("movimientos_equipo").select("id").eq("equipo_id", e.id).eq("tipo", tipo).order("creado_en", { ascending: false }).limit(1);
  return data?.[0]?.id as string | undefined;
}

function Reubicar({ e }: { e: Equipo }) {
  const d = useDatos();
  return (
    <Ventana titulo={"Reubicar " + e.codigo} ok="Reubicar" onSubmit={async (v) => {
      await llamar("reubicar_equipo", { p_equipo: e.id, p_area: v.area || null, p_ubicacion: v.ubicacion, p_motivo: v.motivo || null });
      await d.recargar("equipos", "movimientos_equipo"); avisar("Equipo reubicado");
    }}>
      <p className="chico suave">Dentro de {d.empresa(e.empresa_ubicacion_id)?.nombre}. Para llevarlo a otra empresa, usá «Préstamo».</p>
      <Campo label="Área"><select name="area" defaultValue={e.area_id || ""}><option value="">Sin indicar</option>{d.areas.filter((a) => a.activa).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
      <Campo label="Lugar"><input type="text" name="ubicacion" defaultValue={e.ubicacion || ""} /></Campo>
      <Campo label="Motivo"><input type="text" name="motivo" /></Campo>
    </Ventana>
  );
}
function Prestamo({ e }: { e: Equipo }) {
  const d = useDatos(), tema = useTema();
  return (
    <Ventana titulo={tema.t("prestamo") + " de " + e.codigo} ok="Aprobar el préstamo" onSubmit={async (v) => {
      await llamar("pedir_prestamo", { p_equipo: e.id, p_empresa_destino: v.destino, p_area: v.area || null, p_ubicacion: v.ubicacion || null, p_vuelta: v.vuelta || null, p_motivo: v.motivo });
      await d.recargar("movimientos_equipo"); avisar("Préstamo aprobado: registrá la salida en Movimientos cuando el equipo salga");
    }}>
      <p className="chico suave">Queda aprobado por vos. Cuando el equipo salga, registrás la salida en Movimientos. Sigue siendo de {d.empresa(e.empresa_duena_id)?.nombre} y conserva su código.</p>
      <Campo label="Empresa a la que va *"><select name="destino" required defaultValue="">{<option value="">Elegí…</option>}{d.empresas.filter((x) => x.activa && x.id !== e.empresa_ubicacion_id).map((x) => <option key={x.id} value={x.id}>{x.sigla} · {x.nombre}</option>)}</select></Campo>
      <div className="fila">
        <Campo label="Área"><select name="area" defaultValue=""><option value="">Sin indicar</option>{d.areas.filter((a) => a.activa).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
        <Campo label="Lugar"><input type="text" name="ubicacion" /></Campo>
      </div>
      <Campo label="Vuelta prevista"><input type="date" name="vuelta" min={hoy()} /></Campo>
      <Campo label="Motivo *"><input type="text" name="motivo" required placeholder="Ej.: pico de producción en LIM" /></Campo>
    </Ventana>
  );
}
function ReparacionExterna({ e }: { e: Equipo }) {
  const d = useDatos(), tema = useTema(), f = useFotos();
  return (
    <Ventana titulo={tema.t("reparacion_externa") + ": " + e.codigo} ok="Registrar salida" onSubmit={async (v) => {
      const id = await llamar<string>("reparacion_externa", { p_equipo: e.id, p_proveedor: v.proveedor || null, p_salida: v.salida || null, p_vuelta: v.vuelta || null,
        p_presupuesto: numero(v.presupuesto), p_remito: v.remito || null, p_motivo: v.motivo });
      await f.subirA(id);
      await d.recargar("equipos", "movimientos_equipo", "adjuntos"); avisar("Salida a reparación registrada");
    }}>
      <Campo label={tema.t("proveedor") + " / taller *"}><select name="proveedor" required defaultValue="">{<option value="">Elegí…</option>}{d.proveedores.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
      <div className="fila">
        <Campo label="Salida"><input type="date" name="salida" defaultValue={hoy()} /></Campo>
        <Campo label="Vuelta prevista"><input type="date" name="vuelta" /></Campo>
      </div>
      <div className="fila">
        <Campo label="Presupuesto ($)"><input type="text" name="presupuesto" inputMode="decimal" /></Campo>
        <Campo label="Remito de salida"><input type="text" name="remito" /></Campo>
      </div>
      <Campo label="Motivo *"><input type="text" name="motivo" required placeholder="Ej.: rebobinado del motor" /></Campo>
      {f.ui}
    </Ventana>
  );
}
function Baja({ e }: { e: Equipo }) {
  const d = useDatos(), f = useFotos();
  const abiertas = d.ordenes.filter((o) => o.equipo_id === e.id && !["cerrada", "anulada"].includes(o.estado)).length;
  return (
    <Ventana titulo={"Dar de baja " + e.codigo} ok="Dar de baja" peligro onSubmit={async (v) => {
      await llamar("baja_equipo", { p_equipo: e.id, p_motivo: v.motivo, p_destino: v.destino });
      await f.subirA(await ultimo(d, e, "baja"));
      await d.recargar("equipos", "movimientos_equipo", "adjuntos"); avisar("Equipo dado de baja");
    }}>
      <p>El equipo queda con su código y todo su historial, pero ya no se le cargan órdenes ni reportes.</p>
      {abiertas > 0 && <p className="nota">Tiene {abiertas} {abiertas === 1 ? "orden abierta" : "órdenes abiertas"}: hay que cerrarlas o anularlas antes.</p>}
      <Campo label="Destino *"><select name="destino" required defaultValue="">{<option value="">Elegí…</option>}{d.listas.filter((x) => x.lista === "destino_baja" && x.activo).map((x) => <option key={x.clave} value={x.clave}>{x.nombre}</option>)}</select></Campo>
      <Campo label="Motivo *"><input type="text" name="motivo" required placeholder="Ej.: reparación más cara que uno nuevo" /></Campo>
      {f.ui}
    </Ventana>
  );
}
function Estado({ e, a }: { e: Equipo; a: "operativo" | "detenido" }) {
  const d = useDatos();
  return (
    <Ventana titulo={a === "detenido" ? "Marcar detenido" : "Marcar operativo"} ok="Confirmar" onSubmit={async (v) => {
      await llamar("estado_equipo", { p_equipo: e.id, p_estado: a, p_motivo: v.motivo || null });
      await d.recargar("equipos"); avisar(a === "detenido" ? "Equipo detenido" : "Equipo operativo");
    }}>
      <Campo label="Motivo"><input type="text" name="motivo" placeholder={a === "detenido" ? "Ej.: falta de seguridad en la guarda" : "Ej.: revisado, sin falla"} /></Campo>
    </Ventana>
  );
}

export function AccionesEquipo({ e }: { e: Equipo }) {
  const d = useDatos(), s = useSesion(), tema = useTema();
  const p = s.usuario!.perfil;
  if (e.estado === "baja" || !["jefe", "encargado"].includes(p)) return null;
  const tramite = ocupado(d, e);
  const opciones: [string, string, () => void, boolean?][] = [
    ...(p === "jefe" ? [
      ["Reubicar", "Cambiar de área o de lugar dentro de la misma empresa", () => abrir(<Reubicar e={e} />)],
      [tema.t("prestamo"), "Llevarlo a otra empresa del grupo", () => abrir(<Prestamo e={e} />), !!tramite],
      [tema.t("reparacion_externa"), "Mandarlo a reparar a un taller o proveedor", () => abrir(<ReparacionExterna e={e} />), !!tramite],
    ] as [string, string, () => void, boolean?][] : []),
    ...(e.estado === "operativo" ? [["Marcar detenido", "Por ejemplo, por seguridad", () => abrir(<Estado e={e} a="detenido" />)]] as [string, string, () => void][] : []),
    ...(["detenido", "en_reparacion"].includes(e.estado) ? [["Marcar operativo", "Revisado y funcionando", () => abrir(<Estado e={e} a="operativo" />)]] as [string, string, () => void][] : []),
    ...(p === "jefe" ? [["Dar de baja", "Venta, desguace o chatarra", () => abrir(<Baja e={e} />)]] as [string, string, () => void][] : []),
  ];
  return (<>
    {p === "jefe" && <button className="boton" onClick={() => abrir(<Reubicar e={e} />)}>Reubicar</button>}
    {p === "jefe" && <button className="boton peligro" onClick={() => abrir(<Baja e={e} />)}>Dar de baja</button>}
    <button className="boton" onClick={() => abrir(
      <Ventana titulo={"Movimientos de " + e.codigo}>
        {tramite && <p className="nota">Tiene un {tramite.tipo === "prestamo" ? "préstamo" : "envío a reparación"} en trámite: se sigue en Movimientos.</p>}
        <div className="lista">{opciones.map(([t, ayuda, fn, deshab]) => (
          <button key={t} className="item" style={{ textAlign: "left", cursor: deshab ? "not-allowed" : "pointer", opacity: deshab ? 0.5 : 1, background: "none", font: "inherit", color: "inherit", width: "100%" }}
            disabled={deshab} onClick={() => { cerrar(); setTimeout(fn, 0); }}>
            <div className="cuerpo-item"><div className="t">{t}</div><div className="meta">{ayuda}</div></div></button>))}</div>
      </Ventana>)}><Ico n="movimientos" />{p === "jefe" ? "Préstamo, reparación externa…" : tema.t("movimientos")}</button>
  </>);
}
