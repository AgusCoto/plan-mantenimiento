// Datos en memoria, como el prototipo: se cargan al ingresar y se mantienen al día
// en tiempo real (y además se recargan después de cada cambio propio).
// Cada perfil solo recibe lo que la base le permite ver (RLS).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sb } from "./supabase";
import type { Datos, Tabla, Equipo, Cuenta } from "./tipos";

const VACIO: Datos = {
  empresas: [], areas: [], tipos_equipo: [], productos: [], config: [], cuentas: [], equipos: [], equipo_alias: [],
  equipo_eventos: [], manuales: [], ordenes: [], fichas: [], preventivos: [], preventivo_ejecuciones: [], reportes: [],
  adjuntos: [], movimientos: [], auditoria: [],
};
const ORDEN: Partial<Record<Tabla, [string, boolean]>> = {
  empresas: ["orden", true], areas: ["orden", true], tipos_equipo: ["orden", true], productos: ["orden", true],
  equipos: ["codigo", true], equipo_eventos: ["fecha", false], ordenes: ["numero", false], fichas: ["fecha", true],
  preventivo_ejecuciones: ["fecha", true], reportes: ["ts", false], movimientos: ["fecha", false], auditoria: ["id", false],
};
// Lo que cada app necesita
export const TABLAS_GESTION: Tabla[] = ["empresas", "areas", "tipos_equipo", "productos", "config", "cuentas", "equipos", "equipo_alias",
  "equipo_eventos", "manuales", "ordenes", "fichas", "preventivos", "preventivo_ejecuciones", "reportes", "adjuntos", "movimientos", "auditoria"];
export const TABLAS_OPERARIOS: Tabla[] = ["empresas", "areas", "tipos_equipo", "productos", "config", "cuentas", "equipos", "equipo_alias", "reportes", "movimientos"];

async function traer(t: Tabla) {
  const filas: unknown[] = [];
  const paso = 1000;
  const [col, asc] = ORDEN[t] || [t === "config" ? "clave" : t === "equipo_alias" ? "alias" : "id", true];
  for (let desde = 0; ; desde += paso) {
    let q = sb().from(t).select("*").order(col, { ascending: asc }).range(desde, desde + paso - 1);
    if (t === "auditoria") q = sb().from(t).select("*").order("id", { ascending: false }).range(0, 499);
    const { data, error } = await q;
    if (error) throw error;
    filas.push(...(data || []));
    if (t === "auditoria" || !data || data.length < paso) break;
  }
  return filas;
}

interface Ctx extends Datos {
  cargado: boolean;
  error: string | null;
  lento: boolean;
  recargar: (...t: Tabla[]) => Promise<void>;
  eq: (codigo: string | null | undefined) => Equipo | undefined;
  cuenta: (id: string | null | undefined) => Cuenta | undefined;
  empN: (sigla: string | null | undefined) => string;
  areaN: (c: string) => string;
  tipoN: (c: string) => string;
  conf: <T>(clave: string, def: T) => T;
}
const C = createContext<Ctx | null>(null);
export const useDatos = () => {
  const c = useContext(C);
  if (!c) throw new Error("useDatos fuera de DatosProvider");
  return c;
};

export function DatosProvider({ tablas, children }: { tablas: Tabla[]; children: ReactNode }) {
  const [d, setD] = useState<Datos>(VACIO);
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lento, setLento] = useState(false);
  const pend = useRef(new Set<Tabla>());
  const timer = useRef<number>();

  const recargar = useCallback(async (...ts: Tabla[]) => {
    const lista = ts.length ? ts : tablas;
    const res = await Promise.allSettled(lista.map((t) => traer(t)));
    setD((prev) => {
      const n = { ...prev };
      res.forEach((r, i) => { if (r.status === "fulfilled") (n as Record<string, unknown[]>)[lista[i]] = r.value; });
      return n;
    });
    const fallo = res.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (fallo && !ts.length) setError(String(fallo.reason?.message || fallo.reason));
  }, [tablas]);

  useEffect(() => {
    const t = window.setTimeout(() => setLento(true), 10000);
    recargar().finally(() => { clearTimeout(t); setLento(false); setCargado(true); });
    // Tiempo real: ante cualquier cambio, se vuelve a traer esa tabla (agrupando cambios seguidos)
    const canal = sb().channel("cambios").on("postgres_changes", { event: "*", schema: "public" }, (p) => {
      const t = p.table as Tabla;
      if (!tablas.includes(t)) return;
      pend.current.add(t);
      if (t === "equipos" || t === "ordenes" || t === "cuentas" || t === "empresas") pend.current.add("auditoria");
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const ts = [...pend.current].filter((x) => tablas.includes(x));
        pend.current.clear();
        recargar(...ts);
      }, 400);
    }).subscribe();
    // Al volver a la app (celular que estuvo en segundo plano) se actualiza todo
    const vis = () => { if (document.visibilityState === "visible") recargar(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearTimeout(t); sb().removeChannel(canal); document.removeEventListener("visibilitychange", vis); };
  }, [recargar, tablas]);

  const v = useMemo<Ctx>(() => {
    const eqMap = new Map(d.equipos.map((e) => [e.codigo, e]));
    const cuMap = new Map(d.cuentas.map((c) => [c.id, c]));
    const empMap = new Map(d.empresas.map((e) => [e.sigla, e.nombre]));
    const arMap = new Map(d.areas.map((a) => [a.codigo, a.nombre]));
    const tiMap = new Map(d.tipos_equipo.map((a) => [a.codigo, a.nombre]));
    const cfMap = new Map(d.config.map((c) => [c.clave, c.valor]));
    return {
      ...d, cargado, error, lento, recargar,
      eq: (c) => (c ? eqMap.get(c) : undefined),
      cuenta: (id) => (id ? cuMap.get(id) : undefined),
      empN: (s) => (s ? empMap.get(s) || s : ""),
      areaN: (c) => arMap.get(c) || c,
      tipoN: (c) => tiMap.get(c) || c,
      conf: <T,>(k: string, def: T) => (cfMap.has(k) ? (cfMap.get(k) as T) : def),
    };
  }, [d, cargado, error, lento, recargar]);
  return <C.Provider value={v}>{children}</C.Provider>;
}
