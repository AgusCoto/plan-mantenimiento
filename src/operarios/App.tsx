// App de operarios: una columna, botones grandes. Solo cuentas de operario.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { cliente, configurado, haySesion, sb, ok, mensajeError } from "../compartido/supabase";
import { useSesion, Ingreso, MiCuenta } from "../compartido/sesion";
import { DatosProvider, TABLAS_OPERARIOS, useDatos } from "../compartido/datos";
import { ESTADOS_MOV, ESTADOS_REP, ROLES, TIPOS_MOV, TIPOS_REP } from "../compartido/catalogos";
import { Mark } from "../compartido/logos";
import { ModalHost, Toasts, abrirModal, toast, Pill } from "../compartido/ui";
import { achicar, tipoVideo } from "../compartido/archivos";
import { OpcionesEquipo } from "../compartido/opcionesEquipo";
import { SinConfiguracion } from "../compartido/sinConfig";
import { fdt, hoy, nf } from "../compartido/formato";
import type { Cuenta } from "../compartido/tipos";

cliente("operarios");

const leerEquipo = () => new URLSearchParams(location.search).get("equipo") || (/^#(?!\/|reporte|prod|venta|compra|mis)(.+)$/.exec(location.hash)?.[1] ?? null);
const vistaHash = () => (location.hash || "").replace(/^#\/?/, "");
const ir = (h: string) => { location.hash = h; };

export function App() {
  if (!configurado) return <SinConfiguracion />;
  return <Sesion />;
}

function Sesion() {
  const s = useSesion("operarios");
  const [equipo] = useState(() => leerEquipo());
  useEffect(() => { document.documentElement.dataset.area = "op"; }, []);
  if (!s.listo) return <div className="op"><div className="loading">Cargando…</div></div>;
  if (!s.cuenta) {
    // Si quien escanea el QR está logueado en Gestión, se abre la ficha del equipo
    if (equipo && haySesion("gestion")) { location.replace("../#eq-" + encodeURIComponent(equipo)); return null; }
    return <><Ingreso app="operarios" aviso={s.aviso} equipo={equipo} otraApp={"../" + (equipo ? "#g-eq-" + encodeURIComponent(equipo) : "")} /><Toasts /></>;
  }
  return (
    <DatosProvider tablas={TABLAS_OPERARIOS}>
      <Operario cuenta={s.cuenta} salir={s.salir} equipoInicial={equipo} />
      <ModalHost />
      <Toasts />
    </DatosProvider>
  );
}

function useVista() {
  const [v, setV] = useState(vistaHash());
  useEffect(() => {
    const f = () => { window.scrollTo(0, 0); setV(vistaHash()); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return v;
}

function Operario({ cuenta, salir, equipoInicial }: { cuenta: Cuenta; salir: () => void; equipoInicial: string | null }) {
  const d = useDatos();
  const v = useVista();
  const [pendiente, setPendiente] = useState<string | null>(equipoInicial);
  // Equipo escaneado: se resuelve el código (también los de W-Main) y se abre el reporte
  useEffect(() => {
    if (!pendiente || !d.cargado) return;
    const t = pendiente.toUpperCase();
    const e = d.eq(pendiente) || d.eq(t) || d.eq(d.equipo_alias.find((a) => a.alias === pendiente || a.alias === t)?.equipo);
    history.replaceState(null, "", location.pathname + "#reporte");
    setPendiente(e ? e.codigo : null);
    if (!e) toast("No se encontró el equipo " + pendiente + ". Elegilo de la lista.");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, [pendiente, d.cargado]); // eslint-disable-line react-hooks/exhaustive-deps

  const emp = cuenta.empresa || "INY";
  const back = <a href="#" className="small" onClick={(e) => { e.preventDefault(); ir(""); }}>← Volver</a>;
  let body: JSX.Element;
  if (!d.cargado) body = <div className="loading">Cargando…</div>;
  else if (v === "reporte") body = <>{back}<Reporte emp={emp} equipo={pendiente && d.eq(pendiente) ? pendiente : null} listo={() => { setPendiente(null); ir(""); }} /></>;
  else if (v === "prod" || v === "venta" || v === "compra") body = <>{back}<Movimiento tipo={v === "prod" ? "produccion" : v} emp={emp} /></>;
  else if (v === "mis") body = <>{back}<MisCargas cuenta={cuenta} /></>;
  else body = <Inicio cuenta={cuenta} />;
  return (
    <>
      <header className="top">
        <div className="brand"><Mark area="op" size={36} /><span className="brand-t">Operarios<small>{d.empN(emp)}</small></span></div>
        <span className="sp" />
        <div className="role-chip">
          <span><b>{cuenta.nombre}</b> <span className="muted">· {ROLES.op.n}</span></span>
          <button className="btn sm" onClick={() => abrirModal(<MiCuenta cuenta={cuenta} />)}>Mi cuenta</button>
          <button className="btn sm" onClick={() => { location.hash = ""; salir(); }}>Salir</button>
        </div>
      </header>
      <div className="op">
        {d.error && <div className="note">No se pudieron leer los datos ({d.error}). Recargá la página.</div>}
        {body}
      </div>
    </>
  );
}

function misEntradas(d: ReturnType<typeof useDatos>, cuenta: Cuenta) {
  return [
    ...d.reportes.filter((r) => r.operario_id === cuenta.id).map((r) => ({ id: r.id, ts: r.ts, k: "Reporte", t: `${r.tipo} · ${d.eq(r.equipo)?.nombre || r.equipo}`, st: <Pill map={ESTADOS_REP} k={r.estado} />, nota: r.nota })),
    ...d.movimientos.filter((m) => m.operario_id === cuenta.id).map((m) => ({ id: m.id, ts: m.ts, k: TIPOS_MOV[m.tipo], t: `${m.producto} · ${nf.format(m.cantidad)}`, st: <Pill map={ESTADOS_MOV} k={m.estado} />, nota: m.nota })),
  ].sort((x, y) => y.ts.localeCompare(x.ts));
}

function Inicio({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos();
  const mias = misEntradas(d, cuenta);
  return (
    <>
      <div><h1>Hola, {cuenta.nombre.split(" ")[0]}</h1><p className="muted">{d.empN(cuenta.empresa)}</p></div>
      <div className="tiles">
        <a className="tile big" href="#reporte"><span className="ti">!</span><div><b>Reportar un problema en una máquina</b><br /><small>Ruidos, vibraciones, pérdidas, fallas. Con fotos y videos.</small></div></a>
        <a className="tile" href="#prod"><span className="ti">▦</span><b>Producción</b><small>Unidades producidas en el turno</small></a>
        <a className="tile" href="#venta"><span className="ti">$</span><b>Venta</b><small>Registrar una venta</small></a>
        <a className="tile" href="#compra"><span className="ti">⇣</span><b>Compra</b><small>Registrar una compra</small></a>
        <a className="tile" href="#mis"><span className="ti">☰</span><b>Mis cargas</b><small>{mias.length} registros</small></a>
      </div>
      <p className="muted small">¿Hay un QR en la máquina? Escanealo con la cámara del celular y se abre el reporte de ese equipo.</p>
    </>
  );
}

function MisCargas({ cuenta }: { cuenta: Cuenta }) {
  const d = useDatos();
  const l = misEntradas(d, cuenta);
  return (
    <>
      <h1>Mis cargas</h1>
      {l.length ? <div className="panel"><div className="list">{l.slice(0, 60).map((x) => (
        <div className="item" key={x.id}><div className="body"><div className="t">{x.k}: {x.t}</div><div className="meta">{fdt(x.ts)}</div>
          {x.nota && <div className="small"><b>{x.k === "Reporte" ? "Nota de mantenimiento" : "Nota de producción"}:</b> {x.nota}</div>}</div>{x.st}</div>))}</div></div>
        : <p className="empty">Todavía no cargaste nada.</p>}
    </>
  );
}

/* ---------- Reportar un problema ---------- */
interface Subida { clave: string; tipo: "foto" | "video"; estado: "subiendo" | "listo" | "error"; ruta?: string; mime?: string; bytes?: number; vista?: string; error?: string }

function Reporte({ emp, equipo, listo }: { emp: string; equipo: string | null; listo: () => void }) {
  const d = useDatos();
  const [subidas, setSubidas] = useState<Subida[]>([]);
  const [enviando, setEnviando] = useState(false);
  const uid = useRef<string>("");
  useEffect(() => { sb().auth.getUser().then(({ data }) => { uid.current = data.user?.id || ""; }); }, []);
  const limVideo = Number(d.conf("limite_video_mb", 50));
  const limFoto = Number(d.conf("limite_foto_mb", 15));
  const subiendo = subidas.filter((s) => s.estado === "subiendo").length;

  async function archivos(files: FileList | null) {
    for (const file of [...(files || [])]) {
      const clave = crypto.randomUUID();
      const esVideo = file.type.startsWith("video") || /\.(mov|mp4|m4v|webm)$/i.test(file.name);
      const s: Subida = { clave, tipo: esVideo ? "video" : "foto", estado: "subiendo" };
      setSubidas((x) => [...x, s]);
      const cambiar = (c: Partial<Subida>) => setSubidas((x) => x.map((y) => (y.clave === clave ? { ...y, ...c } : y)));
      try {
        let blob: Blob = file, tipo = file.type, ext = "jpg";
        if (esVideo) {
          const t = tipoVideo(file);
          if (!t) throw new Error("Formato de video no admitido: usá MP4 o MOV.");
          if (file.size > limVideo * 1048576) throw new Error(`El video supera los ${limVideo} MB: grabá uno más corto.`);
          tipo = t; ext = t === "video/quicktime" ? "mov" : t === "video/webm" ? "webm" : "mp4";
        } else {
          if (!file.type.startsWith("image/")) throw new Error("Ese archivo no es una foto ni un video.");
          blob = await achicar(file); tipo = blob.type || "image/jpeg";
          if (blob.size > limFoto * 1048576) throw new Error(`La foto supera los ${limFoto} MB.`);
        }
        if (!uid.current) uid.current = (await sb().auth.getUser()).data.user?.id || "";
        const ruta = `${uid.current}/${clave}.${ext}`;
        const r = await sb().storage.from("reportes").upload(ruta, blob, { contentType: tipo });
        if (r.error) throw new Error(mensajeError(r.error));
        cambiar({ estado: "listo", ruta, mime: tipo, bytes: blob.size, vista: URL.createObjectURL(blob) });
      } catch (e) {
        cambiar({ estado: "error", error: e instanceof Error ? e.message : "No se pudo subir" });
      }
    }
  }
  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (subiendo) { toast("Esperá a que terminen de subir los archivos."); return; }
    const f = new FormData(ev.currentTarget);
    setEnviando(true);
    try {
      ok(await sb().rpc("crear_reporte", {
        p_equipo: f.get("equipo"), p_tipo: f.get("tipo"), p_detenida: f.get("det") === "si", p_descripcion: f.get("desc"),
        p_adjuntos: subidas.filter((s) => s.estado === "listo").map((s) => ({ ruta: s.ruta, tipo: s.tipo, mime: s.mime, bytes: s.bytes })),
      }));
      await d.recargar("reportes");
      toast("Reporte enviado a mantenimiento");
      listo();
    } catch (e) { setEnviando(false); toast((e as { msg?: string }).msg || "No se pudo enviar."); }
  }
  return (
    <>
      <h1>Reportar un problema</h1>
      <p className="muted">Contá qué notaste. Mantenimiento lo revisa con las fotos y videos y decide cómo resolverlo.</p>
      <form className="form" onSubmit={enviar}>
        <label className="field"><span>Máquina</span><select id="r-eq" name="equipo" required defaultValue={equipo || ""}><OpcionesEquipo d={d} emp={emp} /></select></label>
        <div className="field"><span>¿Qué pasa?</span><div className="seg">{TIPOS_REP.map((t, i) => <label key={t}><input type="radio" name="tipo" value={t} defaultChecked={i === 0} /><span>{t}</span></label>)}</div></div>
        <div className="field"><span>¿La máquina sigue funcionando?</span><div className="seg">
          <label><input type="radio" name="det" value="no" defaultChecked /><span>Sí, sigue funcionando</span></label>
          <label><input type="radio" name="det" value="si" /><span>No, está detenida</span></label></div></div>
        <label className="field"><span>Descripción</span><textarea id="r-desc" name="desc" required placeholder="Ej.: desde el arranque del turno hace un golpeteo del lado del motor, más fuerte cuando carga" /></label>
        <label className="upl" htmlFor="r-files">
          <input type="file" id="r-files" accept="image/*,video/mp4,video/quicktime,video/webm,.mov,.mp4" multiple onChange={(e) => { archivos(e.target.files); e.target.value = ""; }} />
          <b>Agregar fotos o videos</b><br /><span className="small muted">Fotos (se achican solas) y videos MP4 o MOV del iPhone, hasta {limVideo} MB</span>
        </label>
        {subidas.length > 0 && <div className="media" id="r-media">{subidas.map((s) =>
          s.estado === "listo" ? (s.tipo === "video" ? <video key={s.clave} src={s.vista} controls preload="metadata" playsInline /> : <img key={s.clave} src={s.vista} alt="Foto adjunta" />)
            : <div key={s.clave} className="ph" style={s.estado === "error" ? { color: "var(--crit)" } : undefined}>{s.estado === "error" ? s.error : "Subiendo…"}</div>)}</div>}
        <button className="btn pri" type="submit" id="r-send" disabled={!!subiendo || enviando}>{subiendo ? `Subiendo ${subiendo} archivo${subiendo > 1 ? "s" : ""}…` : enviando ? "Enviando…" : "Enviar reporte"}</button>
      </form>
    </>
  );
}

/* ---------- Producción, venta, compra ---------- */
function Movimiento({ tipo, emp }: { tipo: "produccion" | "venta" | "compra"; emp: string }) {
  const d = useDatos();
  const [empresa, setEmpresa] = useState(emp);
  const [enviando, setEnviando] = useState(false);
  const productos = d.productos.filter((p) => p.empresa === empresa && p.activo);
  const T = { produccion: "Cargar producción", venta: "Cargar venta", compra: "Cargar compra" }[tipo];
  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>;
    setEnviando(true);
    try {
      ok(await sb().from("movimientos").insert({
        tipo, empresa: f.empresa, fecha: f.fecha, producto: f.producto, cantidad: +f.cantidad || 0, monto: f.monto ? +f.monto : null,
        contraparte: f.contraparte || null, turno: f.turno || null, equipo: f.equipo || null, destino: f.destino || null, obs: f.obs || null,
      }).select());
      await d.recargar("movimientos");
      toast("Guardado"); ir("");
    } catch (e) { setEnviando(false); toast((e as { msg?: string }).msg || "No se pudo guardar."); }
  }
  const prodSel = <select id="m-prod" name="producto" key={empresa}>{productos.map((p) => <option key={p.id}>{p.nombre}</option>)}</select>;
  return (
    <>
      <h1>{T}</h1>
      <form className="form" onSubmit={enviar}>
        <div className="row">
          <label className="field"><span>Empresa</span><select id="m-emp" name="empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)}>{d.empresas.map((k) => <option key={k.sigla} value={k.sigla}>{k.nombre}</option>)}</select></label>
          <label className="field"><span>Fecha</span><input type="date" id="m-fecha" name="fecha" defaultValue={hoy()} max={hoy()} required /></label>
        </div>
        {tipo === "produccion" ? <>
          <label className="field"><span>Producto</span>{prodSel}</label>
          <div className="row">
            <label className="field"><span>Unidades producidas</span><input type="number" id="m-cant" name="cantidad" min={1} step={1} inputMode="numeric" required /></label>
            <label className="field"><span>Turno</span><select id="m-turno" name="turno"><option>Mañana</option><option>Tarde</option><option>Noche</option></select></label>
          </div>
          <label className="field"><span>Máquina (opcional)</span><select id="m-eq" name="equipo" key={"eq" + empresa}><OpcionesEquipo d={d} emp={empresa} vacio="Sin especificar" /></select></label>
        </> : <>
          <label className="field"><span>{tipo === "venta" ? "Cliente" : "Proveedor"}</span><input type="text" id="m-cp" name="contraparte" required /></label>
          <label className="field"><span>{tipo === "venta" ? "Producto" : "Qué se compró"}</span>{tipo === "venta" ? prodSel : <input type="text" id="m-prod" name="producto" required placeholder="Ej.: polietileno de alta densidad, rodamientos 6205" />}</label>
          <div className="row">
            <label className="field"><span>Cantidad</span><input type="number" id="m-cant" name="cantidad" min={0} step="any" inputMode="decimal" required /></label>
            <label className="field"><span>Monto total ($)</span><input type="number" id="m-monto" name="monto" min={0} step="any" inputMode="decimal" required /></label>
          </div>
          {tipo === "compra" && <label className="field"><span>Destino</span><select id="m-dest" name="destino"><option>Producción</option><option>Mantenimiento</option><option>Administración</option></select></label>}
        </>}
        <label className="field"><span>Observaciones (opcional)</span><textarea id="m-obs" name="obs" style={{ minHeight: 70 }} /></label>
        <button className="btn pri" type="submit" disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</button>
      </form>
    </>
  );
}
