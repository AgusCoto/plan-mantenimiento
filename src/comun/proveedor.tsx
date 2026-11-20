// Elegir un proveedor, taller o contratista de la lista, o cargar uno nuevo a mano en el momento.
// El nuevo se guarda en Proveedores y contratistas (lo pueden cargar el jefe y el encargado).
import { useState } from "react";
import { useDatos } from "../datos/store";
import { useSesion } from "../datos/sesion";
import { insertar } from "../datos/cola";
import { falla } from "../datos/supabase";
import { Campo } from "./ui";

export const NUEVO = "__nuevo__";

export function ProveedorCampo({ name, label, valor, requerido, vacio = "Ninguno", ayuda }: {
  name: string; label: string; valor?: string | null; requerido?: boolean; vacio?: string; ayuda?: string;
}) {
  const d = useDatos(), s = useSesion();
  const puedeCargar = ["jefe", "encargado"].includes(s.usuario!.perfil);
  const activos = d.proveedores.filter((p) => p.activo || p.id === valor);
  const [sel, setSel] = useState(valor || (requerido && !activos.length && puedeCargar ? NUEVO : ""));
  return (
    <>
      <Campo label={label} ayuda={ayuda ?? (!activos.length && puedeCargar ? "Todavía no hay ninguno cargado: elegí «Cargar uno nuevo» y escribí sus datos" : undefined)}>
        <select name={name} required={requerido} value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">{requerido ? "Elegí…" : vacio}</option>
          {activos.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.rubro ? ` · ${p.rubro}` : ""}</option>)}
          {puedeCargar && <option value={NUEVO}>+ Cargar uno nuevo…</option>}
        </select>
      </Campo>
      {sel === NUEVO && (
        <div className="fila" style={{ paddingLeft: "var(--e3)", borderLeft: "3px solid var(--acento)" }}>
          <Campo label="Nombre o razón social *"><input type="text" name={name + "_nombre"} required minLength={2} placeholder="Ej.: Electro Ramos" autoFocus /></Campo>
          <Campo label="Rubro"><input type="text" name={name + "_rubro"} placeholder="Ej.: electricidad, hidráulica, tornería" /></Campo>
          <Campo label="Teléfono"><input type="tel" name={name + "_telefono"} /></Campo>
        </div>
      )}
    </>
  );
}

/** Devuelve el id elegido; si se eligió «nuevo», lo carga (o reusa uno con el mismo nombre). */
export async function proveedorDe(v: Record<string, string>, name: string, d: ReturnType<typeof useDatos>): Promise<string | null> {
  const x = v[name];
  if (x !== NUEVO) return x || null;
  const nombre = (v[name + "_nombre"] || "").trim().replace(/\s+/g, " ");
  if (nombre.length < 2) throw falla("Escribí el nombre del contratista o proveedor.");
  const ya = d.proveedores.find((p) => p.nombre.trim().toLowerCase() === nombre.toLowerCase());
  if (ya) return ya.id;
  const p = await insertar("proveedores", { nombre, rubro: (v[name + "_rubro"] || "").trim() || null, telefono: (v[name + "_telefono"] || "").trim() || null });
  await d.recargar("proveedores");
  return p.id as string;
}
/** Los valores de un formulario como texto (para los formularios que no usan Ventana). */
export const valores = (f: FormData) => Object.fromEntries([...f.entries()].filter(([, x]) => typeof x === "string")) as Record<string, string>;
