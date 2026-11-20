// Plan de preventivos: tareas por equipo con su frecuencia. Tarjetas Vencidas / Próximas / Al día / Sin datos
// y la lista con lo más urgente primero. El jefe arma el plan; el jefe y el encargado generan las órdenes.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";
import { actualizar, insertar, llamar } from "../../datos/cola";
import { Campo, Codigo, Emp, Pastilla, Ventana, abrir, avisar, confirmar } from "../../comun/ui";
import { fd, hoy, nf } from "../../comun/formato";
import { Ico } from "../../sistema/iconos";
import { tecnicosPara, num4 } from "../ordenes/comun";
import { ESTADOS_PREV, ORDEN_ESTADO, UNIDADES, cadaCuanto, estadoPrev, ordenAbierta, proxima, type EstadoPrev } from "./comun";
import type { Equipo, Preventivo } from "../../datos/tipos";

const num = (s: string | undefined) => (s ? Number(String(s).replace(/\./g, "").replace(",", ".")) : NaN);

export function FormPreventivo({ p, equipoId }: { p?: Preventivo; equipoId?: string }) {
  const d = useDatos(), tema = useTema();
  const [eq, setEq] = useState(p?.equipo_id || equipoId || "");
  const [unidad, setUnidad] = useState(p?.unidad || "meses");
  const e = d.equipo(eq);
  return (
    <Ventana titulo={p ? "Editar tarea preventiva" : "Nueva tarea preventiva"} ancho={620} onSubmit={async (v) => {
      const frecuencia = Math.round(num(v.frecuencia));
      if (!(frecuencia > 0)) throw { msg: "Indicá cada cuánto se hace (un número mayor que 0)." };
      if (!eq) throw { msg: "Elegí el equipo." };
      const fila: Record<string, unknown> = {
        titulo: v.titulo, descripcion: v.descripcion || null, frecuencia, unidad, asignado_a: v.asignado || null,
        aviso_dias: unidad === "horas" ? 7 : Math.max(0, Math.round(num(v.aviso) || 0)), aviso_horas: unidad === "horas" ? Math.max(0, num(v.aviso) || 0) : 50,
        ultima_fecha: v.ultima_fecha || null, ultima_horas: v.ultima_horas ? num(v.ultima_horas) : null,
      };
      if (p) await actualizar("preventivos", p.id, fila); else await insertar("preventivos", { ...fila, equipo_id: eq });
      await d.recargar("preventivos"); avisar(p ? "Tarea guardada" : "Tarea agregada al plan");
    }}>
      <Campo label={tema.t("equipo") + " *"}>
        <select required value={eq} disabled={!!p || !!equipoId} onChange={(x) => setEq(x.target.value)} aria-label="Equipo">
          <option value="">Elegí…</option>{d.equipos.filter((x) => x.estado !== "baja").map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
        </select></Campo>
      <Campo label="Tarea *"><input type="text" name="titulo" required minLength={2} maxLength={200} defaultValue={p?.titulo} placeholder="Ej.: Cambio de aceite hidráulico" /></Campo>
      <Campo label="Qué hay que hacer" ayuda="Pasos, puntos a revisar, repuestos: aparece en la orden"><textarea name="descripcion" defaultValue={p?.descripcion || ""} style={{ minHeight: 80 }} /></Campo>
      <div className="fila">
        <Campo label="Cada *"><input type="text" name="frecuencia" required inputMode="numeric" defaultValue={p?.frecuencia ?? 3} /></Campo>
        <Campo label="Unidad"><select value={unidad} onChange={(x) => setUnidad(x.target.value as Preventivo["unidad"])} aria-label="Unidad">
          {Object.entries(UNIDADES).map(([k, [, pl]]) => <option key={k} value={k}>{pl}</option>)}</select></Campo>
        <Campo label={unidad === "horas" ? "Avisar (horas antes)" : "Avisar (días antes)"}><input type="text" name="aviso" inputMode="decimal" defaultValue={unidad === "horas" ? (p?.aviso_horas ?? 50) : (p?.aviso_dias ?? 7)} key={unidad} /></Campo>
      </div>
      {unidad === "horas" && e && <p className="chico suave" style={{ margin: 0 }}>Se compara con el {tema.t("horometro").toLowerCase()} del equipo{e.horometro != null ? ` (hoy: ${nf.format(e.horometro)} h)` : ": todavía no tiene lecturas, cargalas en su ficha"}.</p>}
      <div className="fila">
        {unidad === "horas"
          ? <Campo label="Horómetro de la última vez" ayuda="Si no se sabe, dejalo vacío: queda «sin datos»"><input type="text" name="ultima_horas" inputMode="decimal" defaultValue={p?.ultima_horas ?? ""} /></Campo>
          : <Campo label="Última vez que se hizo" ayuda="Si no se sabe, dejalo vacío: queda «sin datos»"><input type="date" name="ultima_fecha" max={hoy()} defaultValue={p?.ultima_fecha || ""} /></Campo>}
        <Campo label="A cargo de"><select name="asignado" defaultValue={p?.asignado_a || ""}><option value="">Sin asignar</option>{tecnicosPara(d, e).map((u) => <option key={u.id} value={u.id}>{u.nombre} · {tema.t(u.perfil)}</option>)}</select></Campo>
      </div>
    </Ventana>
  );
}

function Hecho({ p }: { p: Preventivo }) {
  const d = useDatos();
  const e = d.equipo(p.equipo_id);
  return (
    <Ventana titulo="Registrar que se hizo" ok="Registrar" onSubmit={async (v) => {
      await llamar("preventivo_hecho", { p_id: p.id, p_fecha: v.fecha || null, p_horas: v.horas ? num(v.horas) : null });
      await d.recargar("preventivos"); avisar("Tarea al día");
    }}>
      <p><b>{p.titulo}</b> · {e?.codigo}</p>
      <p className="chico suave">Para cuando se hizo sin una orden (por ejemplo, al cargar el plan). Lo normal es generar la orden: al terminarla, la tarea queda al día sola.</p>
      <div className="fila">
        <Campo label="Fecha"><input type="date" name="fecha" max={hoy()} defaultValue={hoy()} /></Campo>
        {p.unidad === "horas" && <Campo label="Horómetro"><input type="text" name="horas" inputMode="decimal" defaultValue={e?.horometro ?? ""} /></Campo>}
      </div>
    </Ventana>
  );
}

/** Crea la orden de una tarea (con su descripción, a cargo y vencimiento) y devuelve su id. */
export async function generarOrden(p: Preventivo) {
  const px = proxima(p);
  const id = crypto.randomUUID();
  await insertar("ordenes", {
    id, equipo_id: p.equipo_id, preventivo_id: p.id, tipo: "preventiva", titulo: "Preventivo: " + p.titulo, descripcion: [p.descripcion, cadaCuanto(p)].filter(Boolean).join("\n\n"),
    asignado_a: p.asignado_a, vence: px.fecha && px.fecha > hoy() ? px.fecha : hoy(),
  });
  return id;
}

export function useResumenPrev(empresa = "") {
  const d = useDatos();
  return useMemo(() => {
    const l = d.preventivos.filter((p) => p.activo).map((p) => ({ p, e: d.equipo(p.equipo_id) }))
      .filter(({ e }) => e && e.estado !== "baja" && (!empresa || e.empresa_duena_id === empresa || e.empresa_ubicacion_id === empresa))
      .map(({ p, e }) => ({ p, e: e!, estado: estadoPrev(p, e) }));
    const cuenta = { vencida: 0, proxima: 0, al_dia: 0, sin_datos: 0 } as Record<EstadoPrev, number>;
    l.forEach((x) => cuenta[x.estado]++);
    return { l, cuenta };
  }, [d, empresa]);
}

export function TarjetasPrev({ cuenta, filtro, setFiltro }: { cuenta: Record<EstadoPrev, number>; filtro?: string; setFiltro?: (f: string) => void }) {
  const nav = useNavigate();
  return (
    <div className="kpis kpis-prev">
      {(["vencida", "proxima", "al_dia", "sin_datos"] as EstadoPrev[]).map((k) => (
        <button key={k} type="button" className={"kpi kpi-" + k + (filtro === k ? " activo" : "")} aria-pressed={filtro === k}
          onClick={() => (setFiltro ? setFiltro(filtro === k ? "" : k) : nav("/preventivos?estado=" + k))}>
          <span className="v">{cuenta[k]}</span><span className="k">{{ vencida: "Vencidas", proxima: "Próximas", al_dia: "Al día", sin_datos: "Sin datos" }[k]}</span>
        </button>))}
    </div>
  );
}

export function ListaPrev({ items, mostrarEquipo = true }: { items: { p: Preventivo; e: Equipo; estado: EstadoPrev }[]; mostrarEquipo?: boolean }) {
  const d = useDatos(), s = useSesion(), tema = useTema(), nav = useNavigate();
  const perfil = s.usuario!.perfil, jefe = perfil === "jefe", gestiona = jefe || perfil === "encargado";
  const ordenados = [...items].sort((a, b) => ORDEN_ESTADO.indexOf(a.estado) - ORDEN_ESTADO.indexOf(b.estado)
    || (proxima(a.p).fecha || "9999").localeCompare(proxima(b.p).fecha || "9999") || a.e.codigo.localeCompare(b.e.codigo));
  if (!ordenados.length) return <p className="vacio">No hay tareas para mostrar con este filtro.</p>;
  return (
    <div className="lista">{ordenados.map(({ p, e, estado }) => {
      const [t, c] = ESTADOS_PREV[estado], px = proxima(p), ot = ordenAbierta(d.ordenes, p), ubi = d.empresa(e.empresa_ubicacion_id);
      return (
        <div key={p.id} className="item tarea-prev">
          <div className="cuerpo-item">
            <div className="t">{p.titulo}</div>
            <div className="meta">
              {mostrarEquipo && <><Link to={"/equipos/" + e.id}><Codigo>{e.codigo}</Codigo></Link><span>{e.nombre}</span>{ubi && <Emp sigla={ubi.sigla} nombre={ubi.sigla} />}</>}
              <span>{cadaCuanto(p)}</span>
              <span>Última: {p.unidad === "horas" ? (p.ultima_horas != null ? nf.format(Number(p.ultima_horas)) + " h" : "—") : fd(p.ultima_fecha)}</span>
              <span>Próxima: {p.unidad === "horas" ? (px.horas != null ? `${nf.format(px.horas)} h (hoy ${e.horometro != null ? nf.format(e.horometro) : "?"} h)` : "—") : fd(px.fecha)}</span>
              {p.asignado_a && <span>{d.usuarioDe(p.asignado_a)?.nombre}</span>}
            </div>
          </div>
          <div className="botones" style={{ alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Pastilla c={c}>{t}</Pastilla>
            {ot ? <Link className="boton chico" to={"/ordenes/" + ot.id}>{tema.t("orden_abrev")}-{num4(ot.numero)} en curso</Link>
              : gestiona && <button className={"boton chico" + (estado === "vencida" || estado === "proxima" ? " pri" : "")} onClick={async () => {
                try { const id = await generarOrden(p); await d.recargar("ordenes"); avisar("Orden generada"); nav("/ordenes/" + id); } catch (x) { avisar((x as { msg?: string }).msg || "No se pudo generar la orden"); }
              }}>Generar orden</button>}
            {gestiona && !ot && <button className="boton chico" onClick={() => abrir(<Hecho p={p} />)}>Ya se hizo</button>}
            {jefe && <button className="boton chico" onClick={() => abrir(<FormPreventivo p={p} />)}>Editar</button>}
            {jefe && <button className="boton chico" onClick={() => confirmar("Quitar la tarea del plan", <>«{p.titulo}» deja de aparecer en el plan. Su historial (las órdenes) se conserva.</>, "Quitar",
              async () => { await actualizar("preventivos", p.id, { activo: false }); await d.recargar("preventivos"); avisar("Tarea quitada del plan"); })}>Quitar</button>}
          </div>
        </div>);
    })}</div>
  );
}

export function Preventivos() {
  const d = useDatos(), s = useSesion(), tema = useTema(), nav = useNavigate();
  const jefe = s.usuario!.perfil === "jefe", gestiona = jefe || s.usuario!.perfil === "encargado";
  const [emp, setEmp] = useState(""); const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState(() => new URLSearchParams(location.search).get("estado") || "");
  const { l, cuenta } = useResumenPrev(emp);
  const ql = q.trim().toLowerCase();
  const items = l.filter((x) => (!filtro || x.estado === filtro) && (!ql || [x.p.titulo, x.e.codigo, x.e.nombre].join(" ").toLowerCase().includes(ql)));
  const vencidasSinOrden = l.filter((x) => x.estado === "vencida" && !ordenAbierta(d.ordenes, x.p));
  return (
    <>
      <div className="encabezado"><div><h1>Preventivos</h1><p>Todas las tareas, lo más urgente primero. Al terminar la orden de una tarea, la tarea queda al día sola.</p></div><span className="sp" />
        <div className="botones">
          {gestiona && vencidasSinOrden.length > 1 && <button className="boton" onClick={() => confirmar("Generar las órdenes vencidas", <>Se crea una orden por cada una de las {vencidasSinOrden.length} tareas vencidas que no tienen orden.</>, "Generar",
            async () => { for (const x of vencidasSinOrden) await generarOrden(x.p); await d.recargar("ordenes"); avisar(`${vencidasSinOrden.length} órdenes generadas`); nav("/ordenes"); })}>Generar las {vencidasSinOrden.length} vencidas</button>}
          {jefe && <button className="boton pri" onClick={() => abrir(<FormPreventivo />)}><Ico n="mas" />Tarea</button>}
        </div></div>
      <TarjetasPrev cuenta={cuenta} filtro={filtro} setFiltro={setFiltro} />
      <div className="filtros">
        <select value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Empresa"><option value="">Todas las empresas</option>{d.empresas.map((e) => <option key={e.id} value={e.id}>{e.sigla} · {e.nombre}</option>)}</select>
        <input type="search" placeholder={"Buscar " + tema.t("equipo").toLowerCase() + ", código o tarea"} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Buscar" />
      </div>
      <p className="chico suave" style={{ margin: 0 }}>{items.length} {items.length === 1 ? "tarea" : "tareas"} · hoy {fd(hoy())}</p>
      <section className="panel">{d.preventivos.length ? <ListaPrev items={items} /> : <p className="vacio">Todavía no hay tareas en el plan. {jefe ? "Tocá «+ Tarea» para cargar la primera (también desde la ficha de cada equipo)." : "Las carga el jefe de mantenimiento."}</p>}</section>
    </>
  );
}
