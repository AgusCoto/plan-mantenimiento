// Componentes comunes: pastillas, etiqueta de empresa, placa de código, campos, ventanas y avisos.
import { useEffect, useRef, useState, type ReactNode, type FormEvent, type CSSProperties } from "react";
import type { ErrorUsuario } from "../datos/supabase";

export type ColorEstado = "ok" | "alerta" | "critico" | "info" | "";
export const Pastilla = ({ c = "", children }: { c?: ColorEstado; children: ReactNode }) => <span className={"pastilla " + c}>{children}</span>;
export function Emp({ sigla, nombre }: { sigla: string; nombre: string }) {
  return <span className="emp"><i style={{ background: `var(--emp-${sigla}, var(--tinta-suave))` }} />{nombre}</span>;
}
export const Codigo = ({ children, href, style }: { children: ReactNode; href?: string; style?: CSSProperties }) =>
  href ? <a href={href} className="codigo" style={style}>{children}</a> : <span className="codigo" style={style}>{children}</span>;
export function Campo({ label, children, style, ayuda }: { label: ReactNode; children: ReactNode; style?: CSSProperties; ayuda?: ReactNode }) {
  return <label className="campo" style={style}>{label !== "" && <span>{label}</span>}{children}{ayuda && <small className="suave chico">{ayuda}</small>}</label>;
}
export function Elegir({ name, opciones, valor, id, onChange, vacio }: { name: string; opciones: [string, string][]; valor?: string | null; id?: string; onChange?: (v: string) => void; vacio?: string }) {
  return (
    <select name={name} id={id || "f-" + name} defaultValue={valor ?? undefined} onChange={onChange ? (e) => onChange(e.target.value) : undefined}>
      {vacio !== undefined && <option value="">{vacio}</option>}
      {opciones.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
    </select>
  );
}

/* ---------- Avisos breves ---------- */
let empujar: ((m: string) => void) | null = null;
export function avisar(m: string) { empujar?.(m); }
export function Avisos() {
  const [l, setL] = useState<{ id: number; m: string }[]>([]);
  useEffect(() => {
    empujar = (m) => { const id = Math.random(); setL((x) => [...x, { id, m }]); setTimeout(() => setL((x) => x.filter((y) => y.id !== id)), 3200); };
    return () => { empujar = null; };
  }, []);
  return <>{l.slice(-1).map((t) => <div className="aviso-flotante" role="status" key={t.id}>{t.m}</div>)}</>;
}

/* ---------- Ventanas ---------- */
let poner: ((n: ReactNode) => void) | null = null;
export const abrir = (n: ReactNode) => poner?.(n);
export const cerrar = () => poner?.(null);
export function Ventanas() {
  const [n, setN] = useState<ReactNode>(null);
  useEffect(() => { poner = setN; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setN(null); }; document.addEventListener("keydown", k); return () => { poner = null; document.removeEventListener("keydown", k); }; }, []);
  return <>{n}</>;
}
export type Valores = Record<string, string>;
/**
 * Ventana con formulario: los campos usan `name` y llegan como texto. Si onSubmit lanza {msg},
 * se muestra el error y la ventana queda abierta.
 */
export function Ventana({ titulo, children, onSubmit, ok = "Guardar", ancho, peligro }: {
  titulo: string; children: ReactNode; onSubmit?: (v: Valores, f: HTMLFormElement) => Promise<void> | void; ok?: string; ancho?: number; peligro?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]),select,textarea")?.focus(); }, []);
  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!onSubmit) return;
    const f = ev.currentTarget, v: Valores = {};
    new FormData(f).forEach((val, k) => { if (typeof val === "string") v[k] = v[k] !== undefined ? v[k] + "," + val : val; });
    setOcupado(true); setError(null);
    try { await onSubmit(v, f); cerrar(); }
    catch (e) { setOcupado(false); setError((e as ErrorUsuario)?.msg || (e instanceof Error ? e.message : "No se pudo guardar.")); }
  }
  return (
    <div className="velo" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <div className="ventana" role="dialog" aria-modal="true" aria-label={titulo} ref={ref} style={ancho ? { width: `min(${ancho}px, 100%)` } : undefined}>
        <div className="ventana-c"><h2>{titulo}</h2><button className="cerrar" onClick={cerrar} aria-label="Cerrar">×</button></div>
        {onSubmit ? (
          <form className="form" onSubmit={enviar}>
            {children}
            {error && <p className="nota critico" role="alert">{error}</p>}
            <div className="botones"><button className={"boton " + (peligro ? "peligro" : "pri")} type="submit" disabled={ocupado}>{ocupado ? "Guardando…" : ok}</button><button className="boton" type="button" onClick={cerrar}>Cancelar</button></div>
          </form>
        ) : children}
      </div>
    </div>
  );
}
export function confirmar(titulo: string, texto: ReactNode, ok: string, fn: () => Promise<void>, peligro = false) {
  abrir(<Ventana titulo={titulo} ok={ok} onSubmit={fn} peligro={peligro}><p>{texto}</p></Ventana>);
}
export function descargar(nombre: string, datos: Blob | string, tipo = "text/plain;charset=utf-8") {
  const b = typeof datos === "string" ? new Blob([datos], { type: tipo }) : datos;
  const u = URL.createObjectURL(b);
  const a = document.createElement("a"); a.href = u; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
