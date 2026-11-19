// Pantallas de cada etapa (equipos, órdenes, reportes, movimientos y compras) y su lugar en el menú.
import { Navigate, Route } from "react-router-dom";
import type { ReactNode } from "react";
import type { Perfil } from "../sistema/tokens";
import type { Termino } from "../sistema/vocabulario";
import type { ItemMenu } from "../App";
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

const MANT: Perfil[] = ["jefe", "encargado", "tecnico"];
export function menuExtra(t: (k: Termino) => string, c: { nuevos: number; compras: number; prestamos: number }): ItemMenu[] {
  return [
    { a: "/ordenes", texto: t("ordenes"), ico: "ordenes", perfiles: [...MANT, "direccion"] },
    { a: "/reportes", texto: t("reportes"), ico: "reportes", insignia: c.nuevos, perfiles: [...MANT, "direccion"] },
    { a: "/equipos", texto: t("equipos"), ico: "equipos", perfiles: [...MANT, "direccion"] },
    { a: "/movimientos", texto: t("movimientos"), ico: "movimientos", insignia: c.prestamos, perfiles: [...MANT, "direccion"] },
    { a: "/externos", texto: "Intervenciones externas", ico: "registro", perfiles: ["jefe", "encargado", "direccion"] },
    { a: "/compras", texto: t("pedidos"), ico: "compras", insignia: c.compras, perfiles: ["jefe", "encargado", "direccion"] },
  ];
}
const solo = (perfiles: Perfil[], perfil: Perfil, el: ReactNode) => (perfiles.includes(perfil) ? el : <Navigate to="/" replace />);
export function rutasExtra(perfil: Perfil): ReactNode[] {
  return [
    <Route key="e" path="/e/:codigo" element={<Enlace />} />,
    <Route key="rep" path="/reportar" element={<ElegirEquipo />} />,
    <Route key="rep-e" path="/reportar/:id" element={<Reportar />} />,
    <Route key="reps" path="/reportes" element={solo([...MANT, "direccion"], perfil, <Reportes />)} />,
    <Route key="ots" path="/ordenes" element={solo([...MANT, "direccion"], perfil, <Ordenes />)} />,
    <Route key="ot-n" path="/ordenes/nueva" element={solo(["jefe", "encargado"], perfil, <NuevaOrden />)} />,
    <Route key="ot-f" path="/ordenes/:id/ficha" element={solo(MANT, perfil, <FichaTrabajo />)} />,
    <Route key="ot" path="/ordenes/:id" element={solo([...MANT, "direccion"], perfil, <Orden />)} />,
    <Route key="cp" path="/compras" element={solo(["jefe", "encargado", "direccion"], perfil, <Compras />)} />,
    <Route key="ext" path="/externos" element={solo(["jefe", "encargado", "direccion"], perfil, <Externos />)} />,
    <Route key="mov" path="/movimientos" element={solo([...MANT, "direccion"], perfil, <Movimientos />)} />,
    <Route key="eq" path="/equipos" element={solo([...MANT, "direccion"], perfil, <Equipos />)} />,
    <Route key="eq-n" path="/equipos/nuevo" element={solo(["jefe"], perfil, <FormEquipo />)} />,
    <Route key="eq-et" path="/equipos/etiquetas" element={solo(["jefe"], perfil, <Etiquetas />)} />,
    <Route key="eq-ed" path="/equipos/:id/editar" element={solo(["jefe"], perfil, <FormEquipo />)} />,
    <Route key="eq-f" path="/equipos/:id" element={solo([...MANT, "direccion"], perfil, <Ficha />)} />,
  ];
}
