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

const MANT: Perfil[] = ["jefe", "encargado", "tecnico"];
export function menuExtra(t: (k: Termino) => string, _c: { nuevos: number }): ItemMenu[] {
  return [
    { a: "/equipos", texto: t("equipos"), ico: "equipos", perfiles: [...MANT, "direccion"] },
  ];
}
const solo = (perfiles: Perfil[], perfil: Perfil, el: ReactNode) => (perfiles.includes(perfil) ? el : <Navigate to="/" replace />);
export function rutasExtra(perfil: Perfil): ReactNode[] {
  return [
    <Route key="e" path="/e/:codigo" element={<Enlace />} />,
    <Route key="eq" path="/equipos" element={solo([...MANT, "direccion"], perfil, <Equipos />)} />,
    <Route key="eq-n" path="/equipos/nuevo" element={solo(["jefe"], perfil, <FormEquipo />)} />,
    <Route key="eq-et" path="/equipos/etiquetas" element={solo(["jefe"], perfil, <Etiquetas />)} />,
    <Route key="eq-ed" path="/equipos/:id/editar" element={solo(["jefe"], perfil, <FormEquipo />)} />,
    <Route key="eq-f" path="/equipos/:id" element={solo([...MANT, "direccion"], perfil, <Ficha />)} />,
  ];
}
