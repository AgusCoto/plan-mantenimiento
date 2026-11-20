// Editores de cada sección del panel Apariencia.
import { useEffect, useState, type ReactNode } from "react";
import { useDatos } from "../../datos/store";
import { sb, falla, mensajeError } from "../../datos/supabase";
import { actualizar, insertar } from "../../datos/cola";
import { AREAS, FUENTES, completar, type AreaId, type Modo, type Perfil, type Tokens } from "../../sistema/tokens";
import { AA, contraste, corregir, esHex, mezclar, paraOscuro, textoSobre } from "../../sistema/color";
import { LOGOS, logoSvg } from "../../sistema/logos";
import { Ico, ICONOS } from "../../sistema/iconos";
import { VOCABULARIO, type Termino } from "../../sistema/vocabulario";
import { Campo, avisar } from "../../comun/ui";
import { EditorOrden, combinarOrden, type Orden } from "../Inicio";
import type { CampoTipo, ItemLista } from "../../datos/tipos";

export type Poner = (ruta: string, valor: unknown) => void;
export const leer = (o: unknown, ruta: string): unknown => ruta.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);

/* ---------- Color: selector + campo hexadecimal + contraste ---------- */
export function ColorCampo({ label, valor, onChange, sobre, ayuda }: { label: string; valor: string; onChange: (v: string) => void; sobre?: { fondo: string; nombre: string }; ayuda?: string }) {
  const [txt, setTxt] = useState(valor);
  useEffect(() => setTxt(valor), [valor]);
  const k = sobre && esHex(valor) && esHex(sobre.fondo) ? contraste(valor, sobre.fondo) : null;
  const sug = k !== null && k < AA ? corregir(valor, sobre!.fondo) : null;
  return (
    <div className="campo">
      <span>{label}</span>
      <div className="color-campo">
        <input type="color" value={esHex(valor) ? valor : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={label + " (selector)"} />
        <input type="text" value={txt} maxLength={7} aria-label={label + " (hexadecimal)"} onChange={(e) => { setTxt(e.target.value); if (esHex(e.target.value)) onChange(e.target.value.toUpperCase()); }} />
        {k !== null && <span className={"pastilla " + (k >= AA ? "ok" : "critico")} title={`Contraste sobre ${sobre!.nombre}`}>{String(k).replace(".", ",")}:1</span>}
      </div>
      {sug && <small className="chico" style={{ color: "var(--critico)" }}>No se lee bien sobre {sobre!.nombre}. <button type="button" className="boton chico" onClick={() => onChange(sug)}>Usar {sug}</button></small>}
      {ayuda && <small className="suave chico">{ayuda}</small>}
    </div>
  );
}
const Grupo = ({ titulo, children, ayuda }: { titulo: string; children: ReactNode; ayuda?: string }) => (
  <section className="panel form"><h3 style={{ margin: 0 }}>{titulo}</h3>{ayuda && <p className="suave chico">{ayuda}</p>}{children}</section>
);

/* ---------- 1. Marca ---------- */
async function subirMarca(file: File, nombre: string) {
  const ext = (file.name.match(/\.(svg|png|jpe?g|webp)$/i)?.[1] || "png").toLowerCase();
  if (file.size > 2 * 1048576) throw falla("El archivo supera los 2 MB.");
  const ruta = `${nombre}-${crypto.randomUUID()}.${ext}`;
  const { error } = await sb().storage.from("marca").upload(ruta, file, { contentType: file.type || (ext === "svg" ? "image/svg+xml" : "image/png") });
  if (error) throw falla("No se pudo subir: " + mensajeError(error));
  return sb().storage.from("marca").getPublicUrl(ruta).data.publicUrl;
}
export function Marca({ tk, poner }: { tk: Tokens; poner: Poner }) {
  const [subiendo, setSubiendo] = useState(false);
  return (
    <Grupo titulo="Marca" ayuda="El ícono de la app (192 y 512 px) se genera solo a partir del logo cuando guardás.">
      <Campo label="Nombre de la app"><input type="text" value={tk.marca.nombre} maxLength={40} onChange={(e) => poner("marca.nombre", e.target.value)} /></Campo>
      <div className="campo"><span>Logo del grupo (SVG o PNG)</span>
        <div className="botones" style={{ alignItems: "center" }}>
          {tk.marca.logo_url ? <img src={tk.marca.logo_url} alt="Logo actual" style={{ maxHeight: 48, maxWidth: 160, background: "var(--barra)", padding: 6, borderRadius: "var(--r-m)" }} /> : <span className="suave chico">Sin logo propio: se usa el logo del área.</span>}
          <label className="boton chico" style={{ cursor: "pointer" }}>{subiendo ? "Subiendo…" : "Subir logo"}
            <input type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
              setSubiendo(true);
              try { poner("marca.logo_url", await subirMarca(f, "logo")); } catch (x) { avisar((x as { msg?: string }).msg || "No se pudo subir"); }
              setSubiendo(false);
            }} /></label>
          {tk.marca.logo_url && <button type="button" className="boton chico" onClick={() => poner("marca.logo_url", null)}>Quitar logo</button>}
        </div></div>
      <ColorCampo label="Color de fondo de la pantalla de carga" valor={tk.marca.fondo_carga} onChange={(v) => poner("marca.fondo_carga", v)} />
      {(tk.marca.icono_192 || tk.marca.icono_512) && <div className="botones" style={{ alignItems: "end" }}>
        {tk.marca.icono_192 && <img src={tk.marca.icono_192} alt="Ícono 192" width={64} height={64} style={{ borderRadius: 14 }} />}
        {tk.marca.icono_512 && <img src={tk.marca.icono_512} alt="Ícono 512" width={96} height={96} style={{ borderRadius: 20 }} />}
        <span className="suave chico">Íconos actuales. En el iPhone, para ver uno nuevo hay que quitar la app de la pantalla de inicio y volver a agregarla.</span></div>}
    </Grupo>
  );
}

/* ---------- 2. Colores por área ---------- */
export function ColoresArea({ tk, poner }: { tk: Tokens; poner: Poner }) {
  return (
    <Grupo titulo="Colores por área" ayuda="Cada perfil ve la barra, los botones, el menú y los acentos en el color de su área. La app calcula sola el tono suave, el texto sobre el color y la versión para modo oscuro.">
      {AREAS.map((a) => { const ar = tk.areas[a]; const c = tk.colores; return (
        <div key={a} className="panel" style={{ padding: "var(--e3)" }}>
          <div className="panel-c"><b>{ar.nombre}</b><span className="sp" />
            <span className="chico suave">suave <i className="muestra" style={{ background: mezclar(ar.principal, c.claro.superficie, 0.86) }} /> · texto <i className="muestra" style={{ background: textoSobre(ar.principal) }} /> · oscuro <i className="muestra" style={{ background: paraOscuro(ar.principal, c.oscuro.superficie) }} /></span></div>
          <div className="fila">
            <ColorCampo label="Principal" valor={ar.principal} onChange={(v) => poner(`areas.${a}.principal`, v)} sobre={{ fondo: c.claro.superficie, nombre: "las tarjetas claras" }} />
            <ColorCampo label={a === "dir" ? "Detalle (dorado)" : "Detalle"} valor={ar.detalle} onChange={(v) => poner(`areas.${a}.detalle`, v)} />
            <ColorCampo label="Barra superior" valor={ar.barra} onChange={(v) => poner(`areas.${a}.barra`, v)} />
          </div>
        </div>); })}
      <div className="campo"><span>Área de cada perfil</span>
        <div className="fila">{(["jefe", "encargado", "tecnico", "operario", "direccion"] as Perfil[]).map((p) => (
          <label key={p} className="campo"><span className="chico">{p === "tecnico" ? "Técnico" : p === "direccion" ? "Dirección" : p[0].toUpperCase() + p.slice(1)}</span>
            <select value={tk.perfil_area[p]} onChange={(e) => poner(`perfil_area.${p}`, e.target.value)}>{AREAS.map((a) => <option key={a} value={a}>{tk.areas[a].nombre}</option>)}</select></label>))}</div></div>
    </Grupo>
  );
}

/* ---------- 3. Logos por área ---------- */
export function LogosArea({ tk, poner }: { tk: Tokens; poner: Poner }) {
  return (
    <Grupo titulo="Logos por área" ayuda="Elegí un logo de la biblioteca o subí uno propio. «Integrar la W» dibuja la W del grupo dentro del logo.">
      {AREAS.map((a) => { const ar = tk.areas[a]; return (
        <div key={a} className="form" style={{ gap: "var(--e2)" }}>
          <div className="panel-c" style={{ margin: 0 }}><b>{ar.nombre}</b><span className="sp" />
            <label className="chico" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={ar.integrar_w} onChange={(e) => poner(`areas.${a}.integrar_w`, e.target.checked)} disabled={!!ar.logo_url} /> Integrar la W</label>
            <label className="boton chico" style={{ cursor: "pointer" }}>Subir SVG o PNG<input type="file" accept="image/svg+xml,image/png" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
              try { poner(`areas.${a}.logo_url`, await subirMarca(f, "area-" + a)); } catch (x) { avisar((x as { msg?: string }).msg || "No se pudo subir"); }
            }} /></label>
            {ar.logo_url && <button type="button" className="boton chico" onClick={() => poner(`areas.${a}.logo_url`, null)}>Usar la biblioteca</button>}
          </div>
          <div className="botones" role="radiogroup" aria-label={"Logo de " + ar.nombre}>
            {ar.logo_url ? <img src={ar.logo_url} alt="Logo subido" style={{ width: 48, height: 48, background: ar.principal, borderRadius: "var(--r-m)", padding: 4 }} /> :
              Object.entries(LOGOS).map(([id, l]) => (
                <button key={id} type="button" role="radio" aria-checked={ar.logo === id} title={l.nombre} onClick={() => poner(`areas.${a}.logo`, id)}
                  style={{ width: 52, height: 52, padding: 6, borderRadius: "var(--r-m)", cursor: "pointer", background: ar.principal, border: ar.logo === id ? "3px solid var(--tinta)" : "3px solid transparent",
                    ["--marca" as string]: ar.principal, ["--marca-tinta" as string]: textoSobre(ar.principal) }}>
                  <span style={{ display: "block", width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: logoSvg(id, ar.integrar_w) }} />
                </button>))}
          </div>
        </div>); })}
    </Grupo>
  );
}

/* ---------- 4. Colores de estado y de empresa ---------- */
export function Estados({ tk, poner }: { tk: Tokens; poner: Poner }) {
  const nombres: Record<string, string> = { ok: "Operativo / al día", alerta: "Alerta", critico: "Crítico", sin_datos: "Sin datos" };
  return (
    <Grupo titulo="Colores de estado" ayuda="No cambian con el área. Se controlan contra las tarjetas de cada modo.">
      {(["claro", "oscuro"] as Modo[]).map((m) => (
        <div key={m} className="fila">{Object.keys(nombres).map((k) => (
          <ColorCampo key={k} label={`${nombres[k]} · ${m}`} valor={(tk.estados[m] as unknown as Record<string, string>)[k]} onChange={(v) => poner(`estados.${m}.${k}`, v)}
            sobre={{ fondo: tk.colores[m].superficie, nombre: `las tarjetas en modo ${m}` }} />))}</div>))}
    </Grupo>
  );
}
export function Empresas() {
  const d = useDatos();
  const [nueva, setNueva] = useState({ sigla: "", nombre: "", color: "#566472" });
  // La sigla se puede cambiar mientras la empresa no tenga equipos activos (los dados de baja conservan su código)
  const conEquipos = new Set(d.equipos.filter((e) => e.estado !== "baja").map((e) => e.empresa_duena_id));
  return (
    <Grupo titulo="Empresas" ayuda="Nombre, sigla y color propios. La sigla se puede cambiar mientras la empresa no tenga equipos activos (es parte de sus códigos; los equipos dados de baja conservan el código viejo). Se guarda al tocar «Guardar».">
      {d.empresas.map((e) => <FilaEmpresa key={e.id} e={e} bloqueada={conEquipos.has(e.id)} />)}
      <div className="fila" style={{ alignItems: "end" }}>
        <Campo label="Sigla nueva"><input type="text" value={nueva.sigla} maxLength={4} onChange={(x) => setNueva({ ...nueva, sigla: x.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} /></Campo>
        <Campo label="Nombre"><input type="text" value={nueva.nombre} onChange={(x) => setNueva({ ...nueva, nombre: x.target.value })} /></Campo>
        <ColorCampo label="Color" valor={nueva.color} onChange={(c) => setNueva({ ...nueva, color: c })} />
        <button type="button" className="boton" onClick={async () => {
          try { await insertar("empresas", { ...nueva, orden: d.empresas.length + 1 }); await d.recargar("empresas"); setNueva({ sigla: "", nombre: "", color: "#566472" }); avisar("Empresa agregada"); }
          catch (x) { avisar((x as { msg?: string }).msg || "No se pudo agregar"); }
        }} disabled={!/^[A-Z]{2,4}$/.test(nueva.sigla) || nueva.nombre.length < 2}>Sumar empresa</button>
      </div>
    </Grupo>
  );
}
function FilaEmpresa({ e, bloqueada }: { e: { id: string; sigla: string; nombre: string; color: string; activa: boolean }; bloqueada: boolean }) {
  const d = useDatos();
  const [x, setX] = useState(e);
  useEffect(() => setX(e), [e]);
  const cambio = x.sigla !== e.sigla || x.nombre !== e.nombre || x.color !== e.color || x.activa !== e.activa;
  return (
    <div className="fila" style={{ alignItems: "end" }}>
      <Campo label="Sigla" ayuda={bloqueada ? "Tiene equipos activos: no se cambia" : "2 a 4 letras"}><input type="text" value={x.sigla} maxLength={4} disabled={bloqueada} onChange={(v) => setX({ ...x, sigla: v.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} /></Campo>
      <Campo label="Nombre"><input type="text" value={x.nombre} onChange={(v) => setX({ ...x, nombre: v.target.value })} /></Campo>
      <ColorCampo label="Color" valor={x.color} onChange={(c) => setX({ ...x, color: c })} />
      <label className="chico" style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={x.activa} onChange={(v) => setX({ ...x, activa: v.target.checked })} /> Activa</label>
      <button type="button" className="boton chico" disabled={!cambio} onClick={async () => {
        try { await actualizar("empresas", e.id, { sigla: x.sigla, nombre: x.nombre, color: x.color, activa: x.activa }); await d.recargar("empresas"); avisar("Empresa guardada"); }
        catch (err) { avisar((err as { msg?: string }).msg || "No se pudo guardar"); }
      }}>Guardar</button>
    </div>
  );
}

/* ---------- 5. Tipografía ---------- */
export function Tipografia({ tk, poner }: { tk: Tokens; poner: Poner }) {
  useEffect(() => {
    const href = "https://fonts.googleapis.com/css2?" + FUENTES.map((f) => "family=" + encodeURIComponent(f.nombre).replace(/%20/g, "+") + ":wght@" + f.pesos.split(";").slice(-1)[0]).join("&") + "&display=swap";
    if (!document.querySelector(`link[data-todas-fuentes]`)) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; l.dataset.todasFuentes = "1"; document.head.appendChild(l); }
  }, []);
  const sel = (por: "titulos" | "texto" | "codigos", label: string, ejemplo: string) => (
    <div className="campo"><span>{label}</span>
      <select value={tk.fuentes[por]} onChange={(e) => poner(`fuentes.${por}`, e.target.value)}>{FUENTES.filter((f) => f.uso.includes(por)).map((f) => <option key={f.nombre}>{f.nombre}</option>)}</select>
      <span style={{ fontFamily: `"${tk.fuentes[por]}"`, fontSize: por === "titulos" ? "var(--t-xl)" : "var(--t-base)", fontWeight: por === "titulos" ? 800 : 400 }}>{ejemplo}</span></div>
  );
  return (
    <Grupo titulo="Tipografía" ayuda="Se cargan desde Google Fonts, con fuentes de respaldo por si no hay señal.">
      {sel("titulos", "Títulos", "Tablero de mantenimiento")}
      {sel("texto", "Texto", "Cambio de sello del cilindro de cierre, 2,5 h.")}
      {sel("codigos", "Códigos de equipo", "PIN-APL-001")}
      <div className="campo"><span>Tamaño base del texto</span><div className="opciones">
        {(["chico", "normal", "grande"] as const).map((k) => <label key={k}><input type="radio" checked={tk.fuentes.tamano === k} onChange={() => poner("fuentes.tamano", k)} /><span>{k[0].toUpperCase() + k.slice(1)}</span></label>)}
      </div></div>
    </Grupo>
  );
}

/* ---------- 6. Forma ---------- */
export function Forma({ tk, poner }: { tk: Tokens; poner: Poner }) {
  const op = <K extends keyof Tokens["forma"]>(k: K, label: string, l: [Tokens["forma"][K], string][]) => (
    <div className="campo"><span>{label}</span><div className="opciones">{l.map(([v, n]) => <label key={String(v)}><input type="radio" checked={tk.forma[k] === v} onChange={() => poner(`forma.${k}`, v)} /><span>{n}</span></label>)}</div></div>
  );
  return (
    <Grupo titulo="Forma">
      {op("radio", "Esquinas", [["recto", "Rectas"], ["suave", "Suaves"], ["redondeado", "Redondeadas"]])}
      {op("densidad", "Densidad", [["compacta", "Compacta (PC)"], ["comoda", "Cómoda (celular)"], ["auto", "Automática"]])}
      {op("borde", "Grosor de los bordes", [[0, "Sin borde"], [1, "Fino"], [2, "Medio"], [3, "Grueso"]])}
      {op("franja", "Franja industrial", [["rayada", "Rayada"], ["lisa", "Lisa"], ["oculta", "Oculta"]])}
    </Grupo>
  );
}

/* ---------- 7. Tema (claro u oscuro por defecto) y colores de base ---------- */
export function Tema({ tk, poner }: { tk: Tokens; poner: Poner }) {
  const nombres: Record<string, string> = { fondo: "Fondo", superficie: "Tarjetas", superficie_2: "Tarjetas (segundo plano)", tinta: "Texto", tinta_suave: "Texto secundario", linea: "Líneas", placa: "Placa de código", placa_borde: "Borde de la placa" };
  return (
    <Grupo titulo="Tema" ayuda="Valor por defecto del grupo. Cada usuario lo puede cambiar para sí mismo en «Mi cuenta».">
      <div className="opciones">{([["sistema", "Según el sistema"], ["claro", "Claro"], ["oscuro", "Oscuro"]] as const).map(([k, n]) =>
        <label key={k}><input type="radio" checked={tk.modo === k} onChange={() => poner("modo", k)} /><span>{n}</span></label>)}</div>
      {(["claro", "oscuro"] as Modo[]).map((m) => (
        <details key={m}><summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 40 }}>Colores de base · modo {m}</summary>
          <div className="fila" style={{ marginTop: "var(--e2)" }}>{Object.keys(nombres).map((k) => (
            <ColorCampo key={k} label={nombres[k]} valor={(tk.colores[m] as unknown as Record<string, string>)[k]} onChange={(v) => poner(`colores.${m}.${k}`, v)}
              sobre={k === "tinta" ? { fondo: tk.colores[m].superficie, nombre: "las tarjetas" } : k === "tinta_suave" ? { fondo: tk.colores[m].superficie, nombre: "las tarjetas" } : undefined} />))}</div>
        </details>))}
    </Grupo>
  );
}

/* ---------- 8. Vocabulario y listas ---------- */
export function Vocabulario({ tk, poner }: { tk: Tokens; poner: Poner }) {
  const grupos = [...new Set(Object.values(VOCABULARIO).map((v) => v.grupo))];
  return (
    <Grupo titulo="Vocabulario" ayuda="Renombrá los términos de la interfaz sin tocar código. Vacío = texto de fábrica.">
      {grupos.map((g) => (
        <details key={g}><summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 40 }}>{g}</summary>
          <div className="fila" style={{ marginTop: "var(--e2)" }}>{(Object.keys(VOCABULARIO) as Termino[]).filter((k) => VOCABULARIO[k].grupo === g).map((k) => (
            <Campo key={k} label={VOCABULARIO[k].texto}><input type="text" value={tk.vocabulario[k] || ""} placeholder={VOCABULARIO[k].texto}
              onChange={(e) => { const v = { ...tk.vocabulario }; if (e.target.value.trim()) v[k] = e.target.value; else delete v[k]; poner("vocabulario", v); }} /></Campo>))}</div>
        </details>))}
    </Grupo>
  );
}
export function Listas() {
  const d = useDatos();
  const [lista, setLista] = useState<ItemLista["lista"] | "tipos" | "areas">("tipo_falla");
  const titulos = { tipo_falla: "Tipos de falla", causa: "Causas", estado_orden: "Estados de orden", destino_baja: "Destinos de baja", tipos: "Tipos de equipo", areas: "Áreas" };
  return (
    <Grupo titulo="Listas" ayuda="Se guardan al momento. Los estados de orden internos no cambian: solo su nombre y color.">
      <div className="pestanas">{(Object.keys(titulos) as (keyof typeof titulos)[]).map((k) => <button key={k} type="button" className={lista === k ? "activa" : ""} onClick={() => setLista(k)}>{titulos[k]}</button>)}</div>
      {lista === "tipos" ? <ListaTipos /> : lista === "areas" ? <ListaAreas /> : (
        <>
          {d.listas.filter((x) => x.lista === lista).map((x) => <FilaLista key={x.clave} x={x} />)}
          {lista !== "estado_orden" && <NuevaOpcion lista={lista} />}
        </>
      )}
    </Grupo>
  );
}
function FilaLista({ x }: { x: ItemLista }) {
  const d = useDatos();
  const [v, setV] = useState(x);
  useEffect(() => setV(x), [x]);
  const cambio = v.nombre !== x.nombre || v.color !== x.color || v.icono !== x.icono || v.activo !== x.activo;
  return (
    <div className="fila" style={{ alignItems: "end" }}>
      <Campo label={x.clave}><input type="text" value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} /></Campo>
      {x.lista === "tipo_falla" && <Campo label="Ícono"><select value={v.icono || "pregunta"} onChange={(e) => setV({ ...v, icono: e.target.value })}>{ICONOS.map((i) => <option key={i}>{i}</option>)}</select></Campo>}
      {x.lista === "tipo_falla" && <Ico n={v.icono || "pregunta"} />}
      {x.lista === "estado_orden" && <ColorCampo label="Color" valor={v.color || "#566472"} onChange={(c) => setV({ ...v, color: c })} />}
      {x.lista !== "estado_orden" && <label className="chico" style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={v.activo} onChange={(e) => setV({ ...v, activo: e.target.checked })} /> Activo</label>}
      <button type="button" className="boton chico" disabled={!cambio} onClick={async () => {
        const { error } = await sb().from("listas").update({ nombre: v.nombre, color: v.color, icono: v.icono, activo: v.activo }).eq("lista", x.lista).eq("clave", x.clave);
        if (error) avisar(mensajeError(error)); else { await d.recargar("listas"); avisar("Guardado"); }
      }}>Guardar</button>
    </div>
  );
}
function NuevaOpcion({ lista }: { lista: ItemLista["lista"] }) {
  const d = useDatos();
  const [n, setN] = useState("");
  return (
    <div className="fila" style={{ alignItems: "end" }}>
      <Campo label="Nueva opción"><input type="text" value={n} onChange={(e) => setN(e.target.value)} /></Campo>
      <button type="button" className="boton" disabled={n.trim().length < 2} onClick={async () => {
        const clave = n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "opcion";
        try { await insertar("listas", { lista, clave, nombre: n.trim(), orden: 50, icono: lista === "tipo_falla" ? "pregunta" : null }); await d.recargar("listas"); setN(""); avisar("Agregada"); }
        catch (x) { avisar((x as { msg?: string }).msg || "No se pudo agregar"); }
      }}>Agregar</button>
    </div>
  );
}
function ListaTipos() {
  const d = useDatos();
  const [n, setN] = useState({ sigla: "", nombre: "" });
  return (
    <>
      {d.tipos_equipo.map((t) => <FilaSimple key={t.sigla} etiqueta={t.sigla} valor={t.nombre} activo={t.activo} guardar={async (nombre, activo) => { await actualizar("tipos_equipo", t.sigla, { nombre, activo }, "sigla"); await d.recargar("tipos_equipo"); }} />)}
      <div className="fila" style={{ alignItems: "end" }}>
        <Campo label="Sigla (3 letras)"><input type="text" value={n.sigla} maxLength={3} onChange={(e) => setN({ ...n, sigla: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} /></Campo>
        <Campo label="Nombre"><input type="text" value={n.nombre} onChange={(e) => setN({ ...n, nombre: e.target.value })} /></Campo>
        <button type="button" className="boton" disabled={n.sigla.length !== 3 || n.nombre.length < 2} onClick={async () => {
          try { await insertar("tipos_equipo", { ...n, orden: 50 }); await d.recargar("tipos_equipo"); setN({ sigla: "", nombre: "" }); avisar("Tipo agregado"); }
          catch (x) { avisar((x as { msg?: string }).msg || "No se pudo agregar"); }
        }}>Agregar tipo</button>
      </div>
    </>
  );
}
function ListaAreas() {
  const d = useDatos();
  const [n, setN] = useState("");
  return (
    <>
      {d.areas.map((a) => <FilaSimple key={a.id} etiqueta="Área" valor={a.nombre} activo={a.activa} guardar={async (nombre, activa) => { await actualizar("areas", a.id, { nombre, activa }); await d.recargar("areas"); }} />)}
      <div className="fila" style={{ alignItems: "end" }}>
        <Campo label="Área nueva"><input type="text" value={n} onChange={(e) => setN(e.target.value)} /></Campo>
        <button type="button" className="boton" disabled={n.trim().length < 2} onClick={async () => {
          try { await insertar("areas", { nombre: n.trim(), orden: 50 }); await d.recargar("areas"); setN(""); avisar("Área agregada"); } catch (x) { avisar((x as { msg?: string }).msg || "No se pudo agregar"); }
        }}>Agregar área</button>
      </div>
    </>
  );
}
function FilaSimple({ etiqueta, valor, activo, guardar }: { etiqueta: string; valor: string; activo: boolean; guardar: (v: string, a: boolean) => Promise<void> }) {
  const [v, setV] = useState(valor); const [a, setA] = useState(activo);
  useEffect(() => { setV(valor); setA(activo); }, [valor, activo]);
  return (
    <div className="fila" style={{ alignItems: "end" }}>
      <Campo label={etiqueta}><input type="text" value={v} onChange={(e) => setV(e.target.value)} /></Campo>
      <label className="chico" style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={a} onChange={(e) => setA(e.target.checked)} /> Activo</label>
      <button type="button" className="boton chico" disabled={v === valor && a === activo} onClick={async () => { try { await guardar(v, a); avisar("Guardado"); } catch (x) { avisar((x as { msg?: string }).msg || "No se pudo guardar"); } }}>Guardar</button>
    </div>
  );
}

/* ---------- 9. Campos de la ficha por tipo de equipo ---------- */
export function CamposFicha() {
  const d = useDatos();
  const [sigla, setSigla] = useState(d.tipos_equipo[0]?.sigla || "");
  const tipo = d.tipos_equipo.find((t) => t.sigla === sigla);
  const [campos, setCampos] = useState<CampoTipo[]>(tipo?.campos || []);
  useEffect(() => setCampos(tipo?.campos || []), [tipo]);
  const poner = (i: number, c: Partial<CampoTipo>) => setCampos(campos.map((x, j) => (j === i ? { ...x, ...c } : x)));
  return (
    <Grupo titulo="Campos de la ficha" ayuda="Campos propios por tipo de equipo. Por ejemplo, «Capacidad de carga (kg)» para apiladores.">
      <Campo label="Tipo de equipo"><select value={sigla} onChange={(e) => setSigla(e.target.value)}>{d.tipos_equipo.map((t) => <option key={t.sigla} value={t.sigla}>{t.sigla} · {t.nombre}</option>)}</select></Campo>
      {campos.map((c, i) => (
        <div key={i} className="fila" style={{ alignItems: "end" }}>
          <Campo label="Nombre del campo"><input type="text" value={c.etiqueta} onChange={(e) => poner(i, { etiqueta: e.target.value })} /></Campo>
          <Campo label="Tipo"><select value={c.tipo} onChange={(e) => poner(i, { tipo: e.target.value as CampoTipo["tipo"] })}>
            <option value="texto">Texto</option><option value="numero">Número con unidad</option><option value="fecha">Fecha</option><option value="lista">Lista</option><option value="foto">Foto</option></select></Campo>
          {c.tipo === "numero" && <Campo label="Unidad"><input type="text" value={c.unidad || ""} onChange={(e) => poner(i, { unidad: e.target.value })} /></Campo>}
          {c.tipo === "lista" && <Campo label="Opciones (separadas por coma)"><input type="text" value={(c.opciones || []).join(", ")} onChange={(e) => poner(i, { opciones: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></Campo>}
          <label className="chico" style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={!!c.obligatorio} onChange={(e) => poner(i, { obligatorio: e.target.checked })} /> Obligatorio</label>
          <button type="button" className="boton chico peligro" onClick={() => setCampos(campos.filter((_, j) => j !== i))}>Quitar</button>
        </div>))}
      <div className="botones">
        <button type="button" className="boton" onClick={() => setCampos([...campos, { clave: "", etiqueta: "", tipo: "texto", obligatorio: false }])}>Agregar campo</button>
        <button type="button" className="boton pri" onClick={async () => {
          const usadas = new Set<string>();
          const limpios = campos.filter((c) => c.etiqueta.trim()).map((c) => {
            let k = c.clave || c.etiqueta.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "campo";
            while (usadas.has(k)) k += "_2"; usadas.add(k);
            return { ...c, clave: k, etiqueta: c.etiqueta.trim() };
          });
          try { await actualizar("tipos_equipo", sigla, { campos: limpios }, "sigla"); await d.recargar("tipos_equipo"); avisar("Campos guardados"); } catch (x) { avisar((x as { msg?: string }).msg || "No se pudo guardar"); }
        }}>Guardar campos de {sigla}</button>
      </div>
    </Grupo>
  );
}

/* ---------- 10. Etiqueta QR y NFC ---------- */
export function Etiqueta({ tk, poner }: { tk: Tokens; poner: Poner }) {
  const d = useDatos();
  const [tel, setTel] = useState(d.conf<string>("telefono_mantenimiento", ""));
  const campos: [string, string][] = [["codigo", "Código"], ["nombre", "Nombre"], ["empresa", "Empresa"], ["area", "Área"], ["telefono", "Teléfono de mantenimiento"]];
  return (
    <Grupo titulo="Etiqueta QR y NFC" ayuda="Lleva el QR y el chip NFC con el mismo enlace. La vista previa en escala real y la impresión están en Equipos → Etiquetas.">
      <div className="campo"><span>Tamaño</span><div className="opciones">{(["50x30", "70x40", "100x50"] as const).map((k) => <label key={k}><input type="radio" checked={tk.etiqueta.tamano === k} onChange={() => poner("etiqueta.tamano", k)} /><span>{k.replace("x", " × ")} mm</span></label>)}</div></div>
      <div className="campo"><span>Campos visibles</span><div className="opciones">{campos.map(([k, n]) => (
        <label key={k}><input type="checkbox" checked={tk.etiqueta.campos.includes(k)} onChange={(e) => poner("etiqueta.campos", e.target.checked ? [...tk.etiqueta.campos, k] : tk.etiqueta.campos.filter((x) => x !== k))} /><span>{n}</span></label>))}</div></div>
      <label className="chico" style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={tk.etiqueta.logo} onChange={(e) => poner("etiqueta.logo", e.target.checked)} /> Con logo</label>
      <div className="campo"><span>Impresión</span><div className="opciones">{([["a4", "Hoja A4"], ["rollo", "Rollo (una por etiqueta)"]] as const).map(([k, n]) => <label key={k}><input type="radio" checked={tk.etiqueta.hoja === k} onChange={() => poner("etiqueta.hoja", k)} /><span>{n}</span></label>)}</div></div>
      <div className="fila" style={{ alignItems: "end" }}>
        <Campo label="Teléfono de mantenimiento"><input type="tel" value={tel} onChange={(e) => setTel(e.target.value)} /></Campo>
        <button type="button" className="boton chico" onClick={async () => { try { await actualizar("config", "telefono_mantenimiento", { valor: tel }, "clave"); await d.recargar("config"); avisar("Teléfono guardado"); } catch (x) { avisar((x as { msg?: string }).msg || "No se pudo guardar"); } }}>Guardar teléfono</button>
      </div>
    </Grupo>
  );
}

/* ---------- 11. Informes · 12. Pantalla de oficina ---------- */
const SECCIONES: [string, string][] = [["realizados", "Mantenimientos realizados"], ["parada", "Horas de máquina parada"], ["externas", "Equipos en reparación externa"], ["gasto", "Gasto por empresa"], ["preventivos", "Cumplimiento de preventivos"], ["mtbf", "MTBF y MTTR"]];
export function Informes({ tk, poner }: { tk: Tokens; poner: Poner }) {
  const sec = tk.informes.secciones;
  const mover = (i: number, d: number) => { const n = [...sec]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); poner("informes.secciones", n); };
  return (
    <Grupo titulo="Informes" ayuda="El encabezado usa el logo y los colores de la marca. El envío por mail se suma en la etapa 3.">
      <div className="lista">{[...sec, ...SECCIONES.map((s) => s[0]).filter((k) => !sec.includes(k))].map((k, i) => (
        <div key={k} className="item" style={{ alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minHeight: 40 }}><input type="checkbox" checked={sec.includes(k)} onChange={(e) => poner("informes.secciones", e.target.checked ? [...sec, k] : sec.filter((x) => x !== k))} />{SECCIONES.find((s) => s[0] === k)?.[1]}</label>
          {sec.includes(k) && <><button type="button" className="boton chico" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir">↑</button><button type="button" className="boton chico" disabled={i >= sec.length - 1} onClick={() => mover(i, 1)} aria-label="Bajar">↓</button></>}
        </div>))}</div>
      <Campo label="Destinatarios (mails separados por coma)"><input type="text" value={tk.informes.destinatarios.join(", ")} onChange={(e) => poner("informes.destinatarios", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></Campo>
      <div className="fila">
        <Campo label="Día del envío semanal"><select value={tk.informes.dia} onChange={(e) => poner("informes.dia", e.target.value)}>{["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"].map((x) => <option key={x}>{x}</option>)}</select></Campo>
        <Campo label="Hora"><input type="time" value={tk.informes.hora} onChange={(e) => poner("informes.hora", e.target.value)} /></Campo>
      </div>
    </Grupo>
  );
}
export function Oficina({ tk, poner }: { tk: Tokens; poner: Poner }) {
  const d = useDatos();
  const tarjetas: [string, string][] = [["parados", "Equipos parados"], ["ordenes", "Órdenes abiertas"], ["reportes", "Reportes nuevos"], ["externas", "Reparaciones externas"], ["preventivos", "Preventivos de la semana"]];
  const o = tk.oficina;
  return (
    <Grupo titulo="Pantalla de oficina" ayuda="Estado de cada máquina en vivo, en modo kiosco (se suma en la etapa 3).">
      <div className="campo"><span>Tarjetas</span><div className="opciones">{tarjetas.map(([k, n]) => <label key={k}><input type="checkbox" checked={o.tarjetas.includes(k)} onChange={(e) => poner("oficina.tarjetas", e.target.checked ? [...o.tarjetas, k] : o.tarjetas.filter((x) => x !== k))} /><span>{n}</span></label>)}</div></div>
      <div className="campo"><span>Empresas (ninguna = todas)</span><div className="opciones">{d.empresas.map((e) => <label key={e.id}><input type="checkbox" checked={o.empresas.includes(e.sigla)} onChange={(x) => poner("oficina.empresas", x.target.checked ? [...o.empresas, e.sigla] : o.empresas.filter((s) => s !== e.sigla))} /><span>{e.sigla}</span></label>)}</div></div>
      <div className="fila">
        <Campo label="Rotar cada (segundos)"><input type="number" min={5} max={300} value={o.rotacion_seg} onChange={(e) => poner("oficina.rotacion_seg", Number(e.target.value) || 20)} /></Campo>
        <Campo label="Tamaño del texto"><select value={o.tamano_texto} onChange={(e) => poner("oficina.tamano_texto", e.target.value)}><option value="normal">Normal</option><option value="grande">Grande</option><option value="enorme">Enorme</option></select></Campo>
      </div>
    </Grupo>
  );
}

/* ---------- 13. Pantalla de inicio por perfil ---------- */
export function InicioPerfil() {
  const d = useDatos();
  const actual = d.conf<Record<string, Orden>>("inicio_por_perfil", {});
  const [perfil, setPerfil] = useState<Perfil>("tecnico");
  const [orden, setOrden] = useState<Orden>(combinarOrden(perfil, actual[perfil], null));
  useEffect(() => setOrden(combinarOrden(perfil, actual[perfil], null)), [perfil, d.config]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Grupo titulo="Pantalla de inicio por perfil" ayuda="Versión por defecto de cada perfil. Cada usuario puede reordenar la suya desde su inicio.">
      <Campo label="Perfil"><select value={perfil} onChange={(e) => setPerfil(e.target.value as Perfil)}>{(["jefe", "encargado", "tecnico", "direccion"] as Perfil[]).map((p) => <option key={p} value={p}>{p}</option>)}</select></Campo>
      <EditorOrden orden={orden} onChange={setOrden} />
      <button type="button" className="boton pri" style={{ alignSelf: "start" }} onClick={async () => {
        try { await actualizar("config", "inicio_por_perfil", { valor: { ...actual, [perfil]: orden } }, "clave"); await d.recargar("config"); avisar("Inicio del perfil guardado"); }
        catch (x) { avisar((x as { msg?: string }).msg || "No se pudo guardar"); }
      }}>Guardar inicio de {perfil}</button>
    </Grupo>
  );
}
export { completar };
export type { AreaId };
