// Estructura general: tema, sesión, datos, barra superior, menú por perfil y pantallas.
import { useEffect, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { TemaProvider, useTema } from "./sistema/tema";
import { SesionProvider, useSesion } from "./datos/sesion";
import { DatosProvider, useDatos } from "./datos/store";
import { configurado } from "./datos/supabase";
import { Logo } from "./sistema/logos";
import { Ico } from "./sistema/iconos";
import { Avisos, Ventanas, abrir, confirmar } from "./comun/ui";
import { estadoCola } from "./datos/cola";
import { EstadoConexion } from "./comun/conexion";
import { Campanita } from "./comun/avisos";
import { Ingreso } from "./pantallas/Ingreso";
import { MiCuenta } from "./pantallas/MiCuenta";
import { Inicio } from "./pantallas/Inicio";
import { Apariencia } from "./pantallas/apariencia/Apariencia";
import { Usuarios } from "./pantallas/Usuarios";
import { Registro } from "./pantallas/Registro";
import { Exportar } from "./pantallas/Exportar";
import { rutasExtra, menuExtra } from "./pantallas/rutas";
import type { Perfil } from "./sistema/tokens";

export function App() {
  return (
    <TemaProvider>
      <SesionProvider>
        <Raiz />
        <Avisos />
      </SesionProvider>
    </TemaProvider>
  );
}

function SinConfiguracion() {
  return (
    <div className="inicio" style={{ maxWidth: 560 }}>
      <h1>Falta conectar la base de datos</h1>
      <p className="suave">Esta publicación no tiene los datos de Supabase. En Netlify, cargá las variables <span className="codigo">VITE_SUPABASE_URL</span> y{" "}
        <span className="codigo">VITE_SUPABASE_ANON_KEY</span> y volvé a publicar. Los pasos están en el README.</p>
    </div>
  );
}

function Raiz() {
  const s = useSesion();
  const loc = useLocation();
  if (!configurado) return <SinConfiguracion />;
  if (!s.listo) return <div className="cargando">Cargando…</div>;
  if (!s.usuario) return <Ingreso volverA={loc.pathname + loc.search} />;
  return (
    <DatosProvider perfil={s.usuario.perfil} usuarioId={s.usuario.id}>
      <SincronizarEmpresas />
      <Marco perfil={s.usuario.perfil} />
      <Ventanas />
    </DatosProvider>
  );
}

// Los colores de cada empresa (gráficos y etiquetas) vienen de la tabla empresas
function SincronizarEmpresas() {
  const d = useDatos(), tema = useTema();
  useEffect(() => {
    if (d.empresas.length) tema.setEmpresas(d.empresas.map((e) => ({ sigla: e.sigla, color: e.color })));
  }, [d.empresas]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export interface ItemMenu { a: string; texto: string; ico: string; insignia?: number; perfiles: Perfil[] }

function Marco({ perfil }: { perfil: Perfil }) {
  const s = useSesion(), tema = useTema(), d = useDatos(), nav = useNavigate();
  const u = s.usuario!;
  const tk = tema.tokens;
  const nuevos = d.reportes_falla.filter((r) => r.estado === "nuevo").length;
  const todos: ItemMenu[] = [
    { a: "/", texto: "Inicio", ico: "inicio", perfiles: ["jefe", "encargado", "tecnico", "direccion", "operario"] },
    ...menuExtra(tema.t, { nuevos, compras: perfil === "jefe" ? d.pedidos_compra.filter((x) => x.estado === "pendiente").length : 0,
      prestamos: perfil === "jefe" ? d.movimientos_equipo.filter((x) => x.estado === "aprobado").length : 0 }),
    { a: "/usuarios", texto: "Usuarios", ico: "usuarios", perfiles: ["jefe"] },
    { a: "/apariencia", texto: "Apariencia", ico: "apariencia", perfiles: ["jefe"] },
    { a: "/registro", texto: "Registro de cambios", ico: "registro", perfiles: ["jefe", "direccion"] },
    { a: "/exportar", texto: "Exportar datos", ico: "descargar", perfiles: ["jefe", "direccion"] },
  ];
  const menu = todos.filter((m) => m.perfiles.includes(perfil));
  const operario = perfil === "operario";
  return (
    <>
      <header className="barra">
        <a href="/" className="marca-app" style={{ color: "inherit", textDecoration: "none" }} onClick={(e) => { e.preventDefault(); nav("/"); }}>
          {tk.marca.logo_url ? <img src={tk.marca.logo_url} alt={tk.marca.nombre} /> : <Logo tema={tk} area={tema.area} tam={36} />}
          <span>{tk.marca.nombre}<small>{tk.areas[tema.area].nombre}</small></span>
        </a>
        <span className="sp" />
        <EstadoConexion />
        <Campanita />
        <div className="quien">
          <span><b>{u.nombre}</b> <span className="suave">· {tema.t(perfil)}</span></span>
          <button className="boton chico" onClick={() => abrir(<MiCuenta />)}>Mi cuenta</button>
          <button className="boton chico" onClick={() => {
            const n = estadoCola().ops.length;
            if (!n) { nav("/"); s.salir(); return; }
            confirmar("Hay cargas sin enviar", <>Tenés {n} {n === 1 ? "carga guardada" : "cargas guardadas"} en este celular que todavía no llegaron al servidor. Si salís, se envían cuando vuelvas a ingresar con tu usuario en este celular.</>, "Salir igual", async () => { nav("/"); await s.salir(); });
          }}>Salir</button>
        </div>
      </header>
      {d.error && !d.desdeCopia && <div className="nota" style={{ margin: "var(--e3) var(--lado) 0" }}>No se pudieron leer los datos ({d.error}). Recargá la página.</div>}
      {operario ? (
        <div className="op"><Pantallas perfil={perfil} /></div>
      ) : (
        <div className="cuerpo">
          <nav className="menu" aria-label="Secciones">
            {menu.map((m) => (
              <NavLink key={m.a} to={m.a} end={m.a === "/"} className={({ isActive }) => (isActive ? "activo" : "")}>
                <Ico n={m.ico} />{m.texto}{m.insignia ? <span className="insignia">{m.insignia}</span> : null}
              </NavLink>
            ))}
          </nav>
          <main><div className="contenido"><Pantallas perfil={perfil} /></div></main>
        </div>
      )}
    </>
  );
}

function Solo({ perfiles, perfil, children }: { perfiles: Perfil[]; perfil: Perfil; children: ReactNode }) {
  return perfiles.includes(perfil) ? <>{children}</> : <Navigate to="/" replace />;
}
function Pantallas({ perfil }: { perfil: Perfil }) {
  const d = useDatos();
  if (!d.cargado) return <div className="cargando">Cargando datos…</div>;
  return (
    <Routes>
      <Route path="/" element={<Inicio />} />
      {rutasExtra(perfil)}
      <Route path="/usuarios" element={<Solo perfiles={["jefe"]} perfil={perfil}><Usuarios /></Solo>} />
      <Route path="/apariencia" element={<Solo perfiles={["jefe"]} perfil={perfil}><Apariencia /></Solo>} />
      <Route path="/registro" element={<Solo perfiles={["jefe", "direccion"]} perfil={perfil}><Registro /></Solo>} />
      <Route path="/exportar" element={<Solo perfiles={["jefe", "direccion"]} perfil={perfil}><Exportar /></Solo>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
