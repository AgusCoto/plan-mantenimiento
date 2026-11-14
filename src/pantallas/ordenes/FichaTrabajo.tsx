// Ficha de trabajo y ficha de cierre. La de cierre lleva causa, fotos de antes y después y, en
// equipos críticos, la firma del supervisor de producción en el celular del técnico (sin cuenta propia).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useSesion } from "../../datos/sesion";
import { useTema } from "../../sistema/tema";
import { insertar } from "../../datos/cola";
import { Captura, subir, subirAdjuntos, type Medio } from "../../comun/archivos";
import { Campo, Codigo, avisar } from "../../comun/ui";
import { num4, TERMINADAS } from "./comun";

/** Lienzo para firmar con el dedo. Devuelve la firma como PNG (o null si está vacío). */
export function Firma({ alCambiar }: { alCambiar: (png: (() => Promise<Blob | null>) | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const trazos = useRef(0);
  const aviso = useRef(alCambiar); aviso.current = alCambiar;
  useEffect(() => {
    const c = ref.current!, r = c.getBoundingClientRect(), k = window.devicePixelRatio || 1;
    c.width = r.width * k; c.height = r.height * k;
    const g = c.getContext("2d")!; g.scale(k, k); g.lineWidth = 2.4; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0b1d33";
    let dibujando = false;
    const pos = (e: PointerEvent) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top] as const; };
    const abajo = (e: PointerEvent) => { dibujando = true; c.setPointerCapture(e.pointerId); const [x, y] = pos(e); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.1, y + 0.1); g.stroke(); };
    const mueve = (e: PointerEvent) => { if (!dibujando) return; const [x, y] = pos(e); g.lineTo(x, y); g.stroke(); };
    const arriba = () => {
      if (!dibujando) return; dibujando = false; trazos.current++;
      aviso.current(() => new Promise((res) => c.toBlob(res, "image/png")));
    };
    c.addEventListener("pointerdown", abajo); c.addEventListener("pointermove", mueve); c.addEventListener("pointerup", arriba); c.addEventListener("pointercancel", arriba);
    return () => { c.removeEventListener("pointerdown", abajo); c.removeEventListener("pointermove", mueve); c.removeEventListener("pointerup", arriba); c.removeEventListener("pointercancel", arriba); };
  }, []);
  return (
    <div className="form" style={{ gap: "var(--e1)" }}>
      <canvas ref={ref} className="firma" aria-label="Firma del supervisor de producción" />
      <div className="botones"><button type="button" className="boton chico" onClick={() => {
        const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); trazos.current = 0; alCambiar(null);
      }}>Borrar la firma</button><span className="chico suave" style={{ alignSelf: "center" }}>Firmá con el dedo dentro del recuadro</span></div>
    </div>
  );
}

export function FichaTrabajo() {
  const { id } = useParams();
  const [qs] = useSearchParams();
  const cierre = qs.get("cierre") === "1";
  const d = useDatos(), s = useSesion(), tema = useTema(), nav = useNavigate();
  const [antes, setAntes] = useState<Medio[]>([]);
  const [despues, setDespues] = useState<Medio[]>([]);
  const [firma, setFirma] = useState<(() => Promise<Blob | null>) | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const o = d.ordenes.find((x) => x.id === id);
  if (!o) return <p className="vacio">No existe la orden o no tenés acceso.</p>;
  const e = d.equipo(o.equipo_id);
  const ot = `${tema.t("orden_abrev")}-${num4(o.numero)}`;
  const jefe = s.usuario!.perfil === "jefe";
  if ([...TERMINADAS, "cerrada", "anulada"].includes(o.estado)) return <><h1>{ot}</h1><p className="nota">La orden ya está {d.item("estado_orden", o.estado)?.nombre.toLowerCase()}: no se cargan más fichas.</p><Link to={"/ordenes/" + o.id}>Volver a la orden</Link></>;

  async function guardar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget), v = (k: string) => String(f.get(k) || "").trim();
    const num = (k: string) => { const x = v(k).replace(",", "."); return x === "" ? 0 : Number(x); };
    setOcupado(true); setError(null);
    try {
      let firma_ruta: string | null = null;
      if (cierre && o!.requiere_verificacion) {
        if (!v("supervisor")) throw { msg: "Escribí el nombre del supervisor de producción." };
        const png = firma ? await firma() : null;
        if (!png) throw { msg: "Falta la firma del supervisor de producción." };
        firma_ruta = await subir("adjuntos", `${s.usuario!.id}/firma-${crypto.randomUUID()}.png`, png, "image/png");
      }
      const fid = crypto.randomUUID();
      const fila = await insertar("fichas", { tecnico_id: v("contratista") ? null : s.usuario!.id,
        id: fid, orden_id: o!.id, contratista_id: v("contratista") || null, es_cierre: cierre, trabajo: v("trabajo"), horas: num("horas"), horas_parada: num("horas_parada"),
        causa: cierre ? v("causa") || null : null, supervisor_nombre: v("supervisor") || null, firma_ruta, remito: v("remito") || null, hecho_en: new Date().toISOString(),
      });
      try {
        await subirAdjuntos(s.usuario!.id, "fichas", fid, antes, "antes");
        await subirAdjuntos(s.usuario!.id, "fichas", fid, despues, "despues");
      } catch { avisar("La ficha se guardó, pero no se pudieron subir todas las fotos."); }
      await d.recargar("fichas", "ordenes", "equipos", "adjuntos");
      avisar(fila?._pendiente ? "Sin señal: la ficha quedó guardada en el celular y se envía al volver la señal" : cierre ? "Orden terminada" : "Ficha guardada"); nav("/ordenes/" + o!.id, { replace: true });
    } catch (x) { setError((x as { msg?: string }).msg || "No se pudo guardar."); setOcupado(false); }
  }

  return (
    <>
      <div className="encabezado"><div><Link to={"/ordenes/" + o.id} className="chico">← {ot}</Link>
        <h1>{cierre ? tema.t("ficha_cierre") : tema.t("ficha")}</h1>
        <p><Codigo>{e?.codigo}</Codigo> {e?.nombre} · {o.titulo}</p></div></div>
      <form className="form panel" onSubmit={guardar}>
        {jefe && <Campo label={"Trabajo hecho por"} ayuda={"Si lo hizo un " + tema.t("contratista").toLowerCase() + ", elegilo: la ficha queda a su nombre"}>
          <select name="contratista" defaultValue={o.contratista_id || ""}><option value="">Yo ({s.usuario!.nombre})</option>{d.proveedores.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>}
        <Campo label="Trabajo realizado *"><textarea name="trabajo" required minLength={2} placeholder="Qué se hizo, qué se cambió, qué falta" /></Campo>
        <div className="fila">
          <Campo label="Horas de trabajo"><input type="text" name="horas" inputMode="decimal" pattern="[0-9]+([,.][0-9]+)?" title="Un número, por ejemplo 1,5" placeholder="Ej.: 1,5" /></Campo>
          <Campo label="Horas de máquina parada"><input type="text" name="horas_parada" inputMode="decimal" pattern="[0-9]+([,.][0-9]+)?" title="Un número, por ejemplo 2,5" /></Campo>
          <Campo label="Remito"><input type="text" name="remito" /></Campo>
        </div>
        {cierre && <Campo label="Causa de la falla *"><select name="causa" required defaultValue=""><option value="">Elegí…</option>{d.listas.filter((x) => x.lista === "causa" && x.activo).map((x) => <option key={x.clave} value={x.clave}>{x.nombre}</option>)}</select></Campo>}
        <div className="g2 grilla">
          <Captura medios={antes} setMedios={setAntes} titulo="Fotos de antes" compacto video={false} />
          <Captura medios={despues} setMedios={setDespues} titulo="Fotos de después" compacto video={false} />
        </div>
        {cierre && o.requiere_verificacion && <section className="form" style={{ borderTop: "var(--borde) solid var(--linea)", paddingTop: "var(--e3)" }}>
          <h2 style={{ margin: 0 }}>Verificación de producción</h2>
          <p className="chico suave" style={{ margin: 0 }}>Equipo crítico: el {tema.t("supervisor").toLowerCase()} revisa la máquina y firma acá, en este celular.</p>
          <Campo label="Nombre del supervisor *"><input type="text" name="supervisor" required autoComplete="off" /></Campo>
          <Firma alCambiar={(f) => setFirma(() => f)} />
        </section>}
        {error && <p className="nota critico" role="alert">{error}</p>}
        <div className="botones"><button className="boton pri grande" type="submit" disabled={ocupado}>{ocupado ? "Guardando…" : cierre ? "Terminar la orden" : "Guardar ficha"}</button></div>
      </form>
    </>
  );
}
