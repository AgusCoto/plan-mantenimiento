// App de Gestión: barra superior, navegación por perfil y pantallas.
import { useEffect, useState } from "react";
import { cliente, configurado, haySesion } from "../compartido/supabase";
import { useSesion, Ingreso, MiCuenta } from "../compartido/sesion";
import { DatosProvider, TABLAS_GESTION, useDatos } from "../compartido/datos";
import { AREA, AREA_N, NAV, ROLES, type Nav } from "../compartido/catalogos";
import { Mark } from "../compartido/logos";
import { ModalHost, Toasts, abrirModal } from "../compartido/ui";
import { sb } from "../compartido/supabase";
import type { Cuenta } from "../compartido/tipos";
import { Tablero, Equipos, Equipo, Ordenes, Orden, Preventivos, Reportes } from "./vistas/mantenimiento";
import { Produccion, Registros, Listados } from "./vistas/produccion";
import { Informe, Direccion } from "./vistas/informes";
import { Empresas, Usuarios, Registro } from "./vistas/admin";
import { SinConfiguracion } from "../compartido/sinConfig";
import { ruta } from "../compartido/ruta";

cliente("gestion");

function useRuta() {
  const [r, setR] = useState(ruta());
  useEffect(() => {
    const f = () => { window.scrollTo(0, 0); setR(ruta()); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return r;
}
const RUTAS = new Set(Object.keys(NAV).concat(["inicio", "operarios"]));
/** Un hash que no es una pantalla puede ser el código de un equipo (etiquetas de W-Main o del prototipo) */
const posibleEquipo = (h: string) => (h.startsWith("eq-") ? h.slice(3) : h.startsWith("g-eq-") ? h.slice(5) : h && !RUTAS.has(h) && !h.startsWith("ot-") && h.length < 60 && !/^conectar=/.test(h) ? h : null);

export function App() {
  if (!configurado) return <SinConfiguracion />;
  return <Sesion />;
}
function Sesion() {
  const s = useSesion("gestion");
  const h = useRuta();
  useEffect(() => { document.documentElement.dataset.area = s.cuenta ? AREA[s.cuenta.rol] : "mant"; }, [s.cuenta]);
  if (!s.listo) return <div className="start"><div className="loading">Cargando…</div></div>;
  if (!s.cuenta) {
    const eq = posibleEquipo(h);
    // Etiqueta escaneada sin sesión de gestión: si hay sesión de operario en este dispositivo, va a reportar
    if (eq && !h.startsWith("g-eq-") && haySesion("operarios")) { location.replace("./operarios/?equipo=" + encodeURIComponent(eq)); return null; }
    return <><Ingreso app="gestion" aviso={s.aviso} equipo={eq} otraApp={"./operarios/" + (eq ? "?equipo=" + encodeURIComponent(eq) : "")} /><Toasts /></>;
  }
  return (
    <DatosProvider tablas={TABLAS_GESTION}>
      <Shell cuenta={s.cuenta} h={h} salir={s.salir} />
      <ModalHost />
      <Toasts />
    </DatosProvider>
  );
}

function Shell({ cuenta, h, salir }: { cuenta: Cuenta; h: string; salir: () => void }) {
  const d = useDatos();
  const R = ROLES[cuenta.rol];
  const [sinCodigo, setSinCodigo] = useState(false);
  useEffect(() => {
    if (["gm", "gp", "dir"].includes(cuenta.rol)) sb().rpc("tengo_codigo").then(({ data }) => setSinCodigo(data === false));
  }, [cuenta.rol, cuenta.modificado]);

  // Códigos de equipo en la dirección: los nuevos (eq-INY-…) y los viejos de W-Main (alias)
  let vista = h;
  const eqTok = posibleEquipo(h);
  if (eqTok && d.cargado) {
    const t = eqTok.toUpperCase();
    const e = d.eq(eqTok) || d.eq(t) || d.eq(d.equipo_alias.find((a) => a.alias === eqTok || a.alias === t)?.equipo);
    if (e) { if (h !== "eq-" + e.codigo) { history.replaceState(null, "", "#eq-" + e.codigo); vista = "eq-" + e.codigo; } }
    else if (!h.startsWith("eq-")) vista = "";
  }
  if (!vista || (!R.nav.includes(vista.split("-")[0] as Nav) && !vista.startsWith("eq-") && !vista.startsWith("ot-"))) vista = R.nav[0];

  const badge = (n: Nav) =>
    n === "reportes" ? d.reportes.filter((r) => r.estado === "nuevo").length
      : n === "registros" ? d.movimientos.filter((m) => m.estado === "pendiente").length
      : n === "ordenes" && cuenta.rol === "tec" ? d.ordenes.filter((o) => o.estado === "abierta").length : 0;
  const on = (n: Nav) => vista === n || (n === "equipos" && vista.startsWith("eq-")) || (n === "ordenes" && vista.startsWith("ot-"));

  let main: JSX.Element;
  if (!d.cargado) main = <div className="loading">Cargando datos…</div>;
  else if (vista.startsWith("eq-")) main = <Equipo codigo={vista.slice(3)} cuenta={cuenta} />;
  else if (vista.startsWith("ot-")) main = <Orden id={vista.slice(3)} cuenta={cuenta} />;
  else {
    const V: Record<Nav, (p: { cuenta: Cuenta }) => JSX.Element> = {
      tablero: Tablero, equipos: Equipos, ordenes: Ordenes, preventivos: Preventivos, reportes: Reportes, informe: Informe,
      produccion: Produccion, registros: Registros, listados: Listados, direccion: Direccion, empresas: Empresas, usuarios: Usuarios, registro: Registro,
    };
    const C = V[vista as Nav] || Tablero;
    main = <C cuenta={cuenta} />;
  }
  return (
    <>
      <header className="top">
        <div className="brand"><Mark area={AREA[cuenta.rol]} size={36} /><span className="brand-t">Gestión de Planta<small>{AREA_N[AREA[cuenta.rol]]}</small></span></div>
        <span className="sp" />
        <div className="role-chip">
          <span><b>{cuenta.nombre}</b> <span className="muted">· {R.n}</span></span>
          <button className="btn sm" onClick={() => abrirModal(<MiCuenta cuenta={cuenta} />)}>Mi cuenta</button>
          <button className="btn sm" onClick={() => { location.hash = ""; salir(); }}>Salir</button>
        </div>
      </header>
      <div className="shell">
        <nav className="side" aria-label="Secciones">
          {R.nav.map((n) => { const b = badge(n); return <a key={n} href={"#" + n} className={on(n) ? "on" : ""}><span className="ico" aria-hidden="true">{NAV[n][1]}</span>{NAV[n][0]}{b ? <span className="badge">{b}</span> : null}</a>; })}
        </nav>
        <main><div className="wrap">
          {d.error && <div className="note">No se pudieron leer los datos ({d.error}). Recargá la página.</div>}
          {d.lento && <div className="note">Los datos tardan en llegar. Lo que ves puede no estar actualizado.</div>}
          {sinCodigo && <div className="note"><span>Todavía no definiste tu <b>código de acceso</b> (4 a 6 números). Lo vas a necesitar para autorizar cambios.</span><span className="sp" /><button className="btn sm" onClick={() => abrirModal(<MiCuenta cuenta={cuenta} />)}>Definirlo ahora</button></div>}
          {main}
        </div></main>
      </div>
    </>
  );
}
