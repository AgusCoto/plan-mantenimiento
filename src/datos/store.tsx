// Datos en memoria: se cargan al ingresar y se mantienen al día en tiempo real.
// Cada perfil recibe solo lo que la base le deja ver (RLS). Sin señal, se usa la última copia guardada.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sb } from "./supabase";
import { guardarCopia, leerCopia } from "./local";
import { conectarDatos, useCola, type Op } from "./cola";
import type { Datos, Tabla, Equipo, Usuario, Empresa, ItemLista } from "./tipos";
import type { Perfil } from "../sistema/tokens";

export const VACIO: Datos = {
  empresas: [], usuarios: [], usuario_empresas: [], areas: [], tipos_equipo: [], listas: [], config: [], proveedores: [], equipos: [],
  equipo_alias: [], documentos: [], movimientos_equipo: [], reportes_falla: [], ordenes: [], fichas: [], costos_orden: [],
  pedidos_compra: [], adjuntos: [], registro_cambios: [], temas: [], avisos: [],
};
const ORDEN: Partial<Record<Tabla, [string, boolean]>> = {
  empresas: ["orden", true], areas: ["orden", true], tipos_equipo: ["orden", true], listas: ["orden", true], equipos: ["codigo", true],
  ordenes: ["numero", false], pedidos_compra: ["numero", false], reportes_falla: ["hecho_en", false], fichas: ["hecho_en", true],
  movimientos_equipo: ["creado_en", false], registro_cambios: ["id", false], temas: ["version", false], usuarios: ["nombre", true],
};
const CLAVE: Partial<Record<Tabla, string>> = { tipos_equipo: "sigla", config: "clave", equipo_alias: "alias", usuario_empresas: "usuario_id", listas: "lista", temas: "id" };

export function tablasDe(p: Perfil): Tabla[] {
  const comunes: Tabla[] = ["empresas", "usuarios", "usuario_empresas", "areas", "tipos_equipo", "listas", "config", "equipos", "equipo_alias", "reportes_falla", "adjuntos"];
  if (p === "operario") return comunes;
  const gestion: Tabla[] = [...comunes, "avisos", "proveedores", "movimientos_equipo", "ordenes", "fichas", "costos_orden", "pedidos_compra"];
  if (p === "direccion") return [...gestion, "registro_cambios"];
  if (p === "jefe") return [...gestion, "documentos", "registro_cambios", "temas"];
  return [...gestion, "documentos"];
}

async function traer(t: Tabla) {
  if (t === "registro_cambios" || t === "avisos") {
    const { data, error } = await sb().from(t).select("*").order("id", { ascending: false }).range(0, t === "avisos" ? 199 : 999);
    if (error) throw error;
    return data || [];
  }
  const filas: unknown[] = [];
  const [col, asc] = ORDEN[t] || [CLAVE[t] || "id", true];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb().from(t).select("*").order(col, { ascending: asc }).range(desde, desde + 999);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

interface Ctx extends Datos {
  cargado: boolean; desdeCopia: boolean; error: string | null;
  recargar: (...t: Tabla[]) => Promise<void>;
  /** Cambio local inmediato (cargas sin señal o antes de que llegue el tiempo real) */
  poner: <T extends Tabla>(t: T, filas: Datos[T]) => void;
  equipo: (id: string | null | undefined) => Equipo | undefined;
  usuarioDe: (id: string | null | undefined) => Usuario | undefined;
  empresa: (id: string | null | undefined) => Empresa | undefined;
  item: (lista: ItemLista["lista"], clave: string | null | undefined) => ItemLista | undefined;
  conf: <T>(clave: string, def: T) => T;
  buscarEquipo: (codigoOAlias: string) => Equipo | undefined;
}
const C = createContext<Ctx | null>(null);
export const useDatos = () => { const c = useContext(C); if (!c) throw new Error("useDatos fuera de DatosProvider"); return c; };

export function DatosProvider({ perfil, usuarioId, children }: { perfil: Perfil; usuarioId: string; children: ReactNode }) {
  const tablas = useMemo(() => tablasDe(perfil), [perfil]);
  const [d, setD] = useState<Datos>(VACIO);
  const [cargado, setCargado] = useState(false);
  const [desdeCopia, setDesdeCopia] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pend = useRef(new Set<Tabla>());
  const cola = useCola();
  const dRef = useRef(d); dRef.current = d;
  const timer = useRef<number>();

  const recargar = useCallback(async (...ts: Tabla[]) => {
    const lista = ts.length ? ts.filter((t) => tablas.includes(t)) : tablas;
    const res = await Promise.allSettled(lista.map((t) => traer(t)));
    const nuevos: Partial<Datos> = {};
    res.forEach((r, i) => { if (r.status === "fulfilled") (nuevos as Record<string, unknown[]>)[lista[i]] = r.value; });
    if (Object.keys(nuevos).length) {
      setD((prev) => { const n = { ...prev, ...nuevos }; guardarCopia(usuarioId, n); return n; });
      setDesdeCopia(false);
    }
    const fallo = res.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (fallo && !ts.length) setError(String(fallo.reason?.message || fallo.reason));
    else if (!fallo) setError(null);
  }, [tablas, usuarioId]);

  useEffect(() => {
    let vivo = true;
    // Primero la copia local (abre al instante y sin señal), después lo nuevo de la base
    leerCopia(usuarioId).then((copia) => {
      if (vivo && copia) { setD({ ...VACIO, ...copia }); setDesdeCopia(true); setCargado(true); }
      recargar().finally(() => vivo && setCargado(true));
    });
    const canal = sb().channel("cambios-" + usuarioId).on("postgres_changes", { event: "*", schema: "public" }, (p) => {
      const t = p.table as Tabla;
      if (!tablas.includes(t)) return;
      pend.current.add(t);
      if (tablas.includes("registro_cambios")) pend.current.add("registro_cambios");
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { const ts = [...pend.current]; pend.current.clear(); recargar(...ts); }, 400);
    }).subscribe();
    const vis = () => { if (document.visibilityState === "visible") recargar(); };
    const enLinea = () => recargar();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("online", enLinea);
    return () => { vivo = false; sb().removeChannel(canal); document.removeEventListener("visibilitychange", vis); window.removeEventListener("online", enLinea); };
  }, [recargar, tablas, usuarioId]);

  // La cola de envíos usa la copia para saber qué versión se editó, y avisa cuando sincroniza
  useEffect(() => {
    conectarDatos(usuarioId, (t, k, val) => ((dRef.current as unknown as Record<string, Record<string, unknown>[]>)[t] || []).find((r) => String(r[k]) === val), () => recargar());
  }, [usuarioId, recargar]);

  // Lo cargado sin señal se ve enseguida (marcado como pendiente) hasta que llega al servidor
  const vista = useMemo<Datos>(() => {
    const ops = cola.ops.filter((o: Op) => !o.error);
    if (!ops.length) return d;
    const n = { ...d } as unknown as Record<string, Record<string, unknown>[]>;
    for (const o of ops) {
      if (!o.tabla || !tablas.includes(o.tabla as Tabla)) continue;
      const arr = n[o.tabla] || [];
      if (o.tipo === "insertar" && o.fila && !arr.some((r) => r.id === o.fila!.id)) {
        const cuando = new Date(o.ts).toISOString();
        n[o.tabla] = [{ creado_por: o.usuario, creado_en: cuando, modificado_por: o.usuario, modificado_en: cuando, hecho_en: cuando, ...o.fila, _pendiente: true }, ...arr];
      } else if (o.tipo === "actualizar") {
        n[o.tabla] = arr.map((r) => (String(r[o.clave!]) === o.registro ? { ...r, ...o.cambios, _pendiente: true } : r));
      }
    }
    return n as unknown as Datos;
  }, [d, cola.version, tablas]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = useMemo<Ctx>(() => {
    const d = vista;
    const eq = new Map(d.equipos.map((e) => [e.id, e]));
    const us = new Map(d.usuarios.map((u) => [u.id, u]));
    const em = new Map(d.empresas.map((e) => [e.id, e]));
    const cf = new Map(d.config.map((c) => [c.clave, c.valor]));
    const porCodigo = new Map(d.equipos.map((e) => [e.codigo.toUpperCase(), e]));
    const alias = new Map(d.equipo_alias.map((a) => [a.alias.toUpperCase(), a.equipo_id]));
    return {
      ...d, cargado, desdeCopia, error, recargar,
      poner: (t, filas) => setD((prev) => ({ ...prev, [t]: filas })),
      equipo: (id) => (id ? eq.get(id) : undefined),
      usuarioDe: (id) => (id ? us.get(id) : undefined),
      empresa: (id) => (id ? em.get(id) : undefined),
      item: (l, k) => d.listas.find((x) => x.lista === l && x.clave === k),
      conf: <T,>(k: string, def: T) => (cf.has(k) && cf.get(k) !== null ? (cf.get(k) as T) : def),
      buscarEquipo: (c) => { const k = c.trim().toUpperCase(); return porCodigo.get(k) || eq.get(c) || eq.get(alias.get(k) || "") || eq.get(alias.get(c.trim()) || ""); },
    };
  }, [vista, cargado, desdeCopia, error, recargar]);
  return <C.Provider value={v}>{children}</C.Provider>;
}
