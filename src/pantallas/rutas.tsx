// Pantallas y menú. El menú se arma por secciones, como en W-Main:
// Día a día · Equipos · Compras · Consultas e informes · Ajustes.
import { Navigate, Route } from "react-router-dom";
import type { ReactNode } from "react";
import type { Perfil } from "../sistema/tokens";
import type { Termino } from "../sistema/vocabulario";
import { Equipos, Etiquetas } from "./equipos/Equipos";
import { FormEquipo } from "./equipos/FormEquipo";
import { Ficha } from "./equipos/Ficha";
import { Enlace } from "./equipos/Enlace";
import { ElegirEquipo, Reportar } from "./operario/Reportar";
import { Reportes } from "./ordenes/Reportes";
import { Ordenes, NuevaOrden } from "./ordenes/Ordenes";
import { Orden } from "./ordenes/Orden";
import { FichaTrabajo } from "./ordenes/FichaTrabajo";
import { Compras } from "./compras/Compras";
import { Movimientos } from "./movimientos/Movimientos";
import { Externos } from "./Externos";
import { Proveedores } from "./Proveedores";
import { Preventivos } from "./preventivos/Preventivos";
import { Escanear } from "./Escanear";
import { Ayuda, BuscarFallas, HistorialIntervenciones, InformeMensual, Manuales, ResumenDireccion } from "./Consultas";

export interface ItemMenu { a: string; texto: string; ico: string; insignia?: number; perfiles: Perfil[]; accion?: "cuenta" | "salir" }
export interface Seccion { titulo: string; items: ItemMenu[] }

const MANT: Perfil[] = ["jefe", "encargado", "tecnico"];
const TODOS: Perfil[] = ["jefe", "encargado", "tecnico", "direccion", "operario"];
export interface Contadores { nuevos: number; compras: number; prestamos: number; preventivos: number }

export function secciones(t: (k: Termino) => string, c: Contadores): Seccion[] {
  return [
    { titulo: "Día a día", items: [
      { a: "/", texto: "Inicio", ico: "inicio", perfiles: TODOS },
      { a: "/ordenes", texto: t("ordenes"), ico: "ordenes", perfiles: [...MANT, "direccion"] },
      { a: "/reportes", texto: t("reportes"), ico: "aviso", insignia: c.nuevos, perfiles: [...MANT, "direccion"] },
      { a: "/preventivos", texto: "Preventivos", ico: "calendario", insignia: c.preventivos, perfiles: [...MANT, "direccion"] },
      { a: "/reportar", texto: t("reportar"), ico: "reportes", perfiles: ["operario"] },
      { a: "/escanear", texto: "Escanear QR / NFC", ico: "escanear", perfiles: TODOS },
      { a: "/resumen", texto: "Resumen para Dirección", ico: "tablero", perfiles: ["jefe", "direccion"] },
    ] },
    { titulo: "Equipos", items: [
      { a: "/equipos", texto: t("equipos"), ico: "equipos", perfiles: [...MANT, "direccion"] },
      { a: "/movimientos", texto: t("movimientos"), ico: "movimientos", insignia: c.prestamos, perfiles: [...MANT, "direccion"] },
      { a: "/manuales", texto: "Manuales", ico: "libro", perfiles: MANT },
      { a: "/equipos/etiquetas", texto: "Etiquetas QR y NFC", ico: "qr", perfiles: ["jefe"] },
    ] },
    { titulo: "Compras", items: [
      { a: "/compras", texto: t("pedidos"), ico: "compras", insignia: c.compras, perfiles: ["jefe", "encargado", "direccion"] },
      { a: "/proveedores", texto: "Proveedores y contratistas", ico: "usuarios", perfiles: ["jefe", "encargado"] },
    ] },
    { titulo: "Consultas e informes", items: [
      { a: "/fallas", texto: "Buscar fallas anteriores", ico: "buscar", perfiles: [...MANT, "direccion"] },
      { a: "/intervenciones", texto: "Historial de intervenciones", ico: "reloj", perfiles: [...MANT, "direccion"] },
      { a: "/externos", texto: "Intervenciones externas", ico: "registro", perfiles: ["jefe", "encargado", "direccion"] },
      { a: "/informe", texto: "Informe mensual", ico: "grafico", perfiles: ["jefe", "encargado", "direccion"] },
      { a: "/registro", texto: "Historial de modificaciones", ico: "lapiz", perfiles: ["jefe", "direccion"] },
      { a: "/exportar", texto: "Exportar datos", ico: "descargar", perfiles: ["jefe", "direccion"] },
    ] },
    { titulo: "Ajustes", items: [
      { a: "/apariencia", texto: "Configuración", ico: "configuracion", perfiles: ["jefe"] },
      { a: "/usuarios", texto: "Usuarios y permisos", ico: "usuarios", perfiles: ["jefe"] },
      { a: "#cuenta", texto: "Mi cuenta", ico: "persona", perfiles: TODOS, accion: "cuenta" },
      { a: "#salir", texto: "Cerrar sesión", ico: "salir", perfiles: TODOS, accion: "salir" },
      { a: "/ayuda", texto: "¿Dónde está cada cosa?", ico: "pregunta", perfiles: TODOS },
    ] },
  ];
}
/** Las secciones con lo que ve ese perfil (sin secciones vacías). */
export const seccionesDe = (s: Seccion[], p: Perfil) => s.map((x) => ({ ...x, items: x.items.filter((i) => i.perfiles.includes(p)) })).filter((x) => x.items.length);

const solo = (perfiles: Perfil[], perfil: Perfil, el: ReactNode) => (perfiles.includes(perfil) ? el : <Navigate to="/" replace />);
export function rutasExtra(perfil: Perfil): ReactNode[] {
  return [
    <Route key="e" path="/e/:codigo" element={<Enlace />} />,
    <Route key="esc" path="/escanear" element={<Escanear />} />,
    <Route key="ayuda" path="/ayuda" element={<Ayuda />} />,
    <Route key="rep" path="/reportar" element={<ElegirEquipo />} />,
    <Route key="rep-e" path="/reportar/:id" element={<Reportar />} />,
    <Route key="reps" path="/reportes" element={solo([...MANT, "direccion"], perfil, <Reportes />)} />,
    <Route key="prev" path="/preventivos" element={solo([...MANT, "direccion"], perfil, <Preventivos />)} />,
    <Route key="ots" path="/ordenes" element={solo([...MANT, "direccion"], perfil, <Ordenes />)} />,
    <Route key="ot-n" path="/ordenes/nueva" element={solo(["jefe", "encargado"], perfil, <NuevaOrden />)} />,
    <Route key="ot-f" path="/ordenes/:id/ficha" element={solo(MANT, perfil, <FichaTrabajo />)} />,
    <Route key="ot" path="/ordenes/:id" element={solo([...MANT, "direccion"], perfil, <Orden />)} />,
    <Route key="cp" path="/compras" element={solo(["jefe", "encargado", "direccion"], perfil, <Compras />)} />,
    <Route key="prov" path="/proveedores" element={solo(["jefe", "encargado"], perfil, <Proveedores />)} />,
    <Route key="ext" path="/externos" element={solo(["jefe", "encargado", "direccion"], perfil, <Externos />)} />,
    <Route key="fal" path="/fallas" element={solo([...MANT, "direccion"], perfil, <BuscarFallas />)} />,
    <Route key="int" path="/intervenciones" element={solo([...MANT, "direccion"], perfil, <HistorialIntervenciones />)} />,
    <Route key="inf" path="/informe" element={solo(["jefe", "encargado", "direccion"], perfil, <InformeMensual />)} />,
    <Route key="res" path="/resumen" element={solo(["jefe", "direccion"], perfil, <ResumenDireccion />)} />,
    <Route key="man" path="/manuales" element={solo(MANT, perfil, <Manuales />)} />,
    <Route key="mov" path="/movimientos" element={solo([...MANT, "direccion"], perfil, <Movimientos />)} />,
    <Route key="eq" path="/equipos" element={solo([...MANT, "direccion"], perfil, <Equipos />)} />,
    <Route key="eq-n" path="/equipos/nuevo" element={solo(["jefe"], perfil, <FormEquipo />)} />,
    <Route key="eq-et" path="/equipos/etiquetas" element={solo(["jefe"], perfil, <Etiquetas />)} />,
    <Route key="eq-ed" path="/equipos/:id/editar" element={solo(["jefe"], perfil, <FormEquipo />)} />,
    <Route key="eq-f" path="/equipos/:id" element={solo([...MANT, "direccion"], perfil, <Ficha />)} />,
  ];
}
