// Componentes de interfaz del prototipo: pastillas, etiquetas de empresa, gráficos, modales y avisos.
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { ymd, addDays, nf, sum, niceMax } from "./formato";
import type { Par } from "./catalogos";

export function Pill({ map, k }: { map: Record<string, Par>; k: string }) {
  const v = map[k] || [k, ""];
  return <span className={"pill " + v[1]}>{v[0]}</span>;
}
export function EmpTag({ sigla, nombre }: { sigla: string; nombre: string }) {
  return <span className="emp"><i style={{ background: `var(--c-${sigla})` }} />{nombre}</span>;
}
export const Code = ({ children, href, style }: { children: ReactNode; href?: string; style?: React.CSSProperties }) =>
  href ? <a href={href} className="code" style={style}>{children}</a> : <span className="code" style={style}>{children}</span>;

export function Field({ label, children, style }: { label: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return <label className="field" style={style}>{label !== "" && <span>{label}</span>}{children}</label>;
}
export function Sel({ name, opciones, valor, id, onChange }: { name: string; opciones: [string, string][]; valor?: string; id?: string; onChange?: (v: string) => void }) {
  return (
    <select name={name} id={id || "m-" + name} defaultValue={valor} onChange={onChange ? (e) => onChange(e.target.value) : undefined}>
      {opciones.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
    </select>
  );
}

/* ---------- Avisos breves ---------- */
let pushToast: ((m: string) => void) | null = null;
export function toast(m: string) { pushToast?.(m); }
export function Toasts() {
  const [l, setL] = useState<{ id: number; m: string }[]>([]);
  useEffect(() => {
    pushToast = (m) => { const id = Math.random(); setL((x) => [...x, { id, m }]); setTimeout(() => setL((x) => x.filter((y) => y.id !== id)), 2800); };
    return () => { pushToast = null; };
  }, []);
  return <>{l.slice(-1).map((t) => <div className="toast" role="status" key={t.id}>{t.m}</div>)}</>;
}

/* ---------- Modales ---------- */
let setModalGlobal: ((n: ReactNode) => void) | null = null;
export function abrirModal(n: ReactNode) { setModalGlobal?.(n); }
export function cerrarModal() { setModalGlobal?.(null); }
export function ModalHost() {
  const [n, setN] = useState<ReactNode>(null);
  useEffect(() => { setModalGlobal = setN; return () => { setModalGlobal = null; }; }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setN(null); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);
  return <div id="modal-root">{n}</div>;
}

export type Valores = Record<string, string>;
/** Error que se muestra tal cual al usuario */
export interface ErrorUsuario { msg: string }
export const falla = (msg: string): ErrorUsuario => ({ msg });

/**
 * Modal con formulario (como modal() del prototipo): los campos usan `name` y llegan
 * como texto en `onSubmit`. Si onSubmit lanza {msg}, se muestra y el modal queda abierto.
 */
export function Modal({ title, children, onSubmit, ok = "Guardar", ancho }: {
  title: string; children: ReactNode; onSubmit?: (v: Valores, f: HTMLFormElement) => Promise<void> | void; ok?: string; ancho?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]),select,textarea");
    first?.focus();
  }, []);
  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!onSubmit) return;
    const f = ev.currentTarget;
    const v: Valores = {};
    new FormData(f).forEach((val, k) => { if (typeof val === "string") v[k] = val; });
    setOcupado(true);
    try { await onSubmit(v, f); cerrarModal(); }
    catch (e) { setOcupado(false); const m = (e as ErrorUsuario)?.msg; toast(m || "No se pudo guardar. Revisá la conexión e intentá de nuevo."); }
  }
  return (
    <div className="ov" onClick={(e) => { if (e.target === e.currentTarget) cerrarModal(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={ancho ? { width: `min(${ancho}px,100%)` } : undefined}>
        <div className="modal-h"><h2>{title}</h2><button className="x" onClick={cerrarModal} aria-label="Cerrar">×</button></div>
        {onSubmit ? (
          <form className="form" onSubmit={enviar}>
            {children}
            <div className="btns"><button className="btn pri" type="submit" disabled={ocupado}>{ocupado ? "Guardando…" : ok}</button><button className="btn" type="button" onClick={cerrarModal}>Cancelar</button></div>
          </form>
        ) : children}
      </div>
    </div>
  );
}
export function confirmar(title: string, texto: ReactNode, ok: string, fn: () => Promise<void>) {
  abrirModal(<Modal title={title} ok={ok} onSubmit={fn}><p>{texto}</p></Modal>);
}
/** Campo de código de acceso (se verifica en el servidor) */
export const CampoCodigo = ({ label }: { label: string }) => (
  <Field label={label}><input type="password" name="codigo" id="m-cod" required inputMode="numeric" pattern="[0-9]{4,6}" autoComplete="off" style={{ maxWidth: 180 }} /></Field>
);

/* ---------- Gráficos (iguales al prototipo) ---------- */
export function Hbars({ rows, f }: { rows: [string, number, string][]; f: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="hbar" style={{ marginTop: 8 }}>
      {rows.map((r) => [
        <span key={r[0] + "n"}>{r[0]}</span>,
        <div key={r[0] + "t"} className="track"><div className="fill" style={{ width: ((r[1] / max) * 100).toFixed(1) + "%", background: r[2] }} /></div>,
        <span key={r[0] + "v"} className="val">{f(r[1])}</span>,
      ])}
    </div>
  );
}
export function ChartDaily({ prod, ws, emps }: { prod: { fecha: string; empresa: string; cantidad: number }[]; ws: Date; emps: [string, string][] }) {
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const data = days.map((d) => { const k = ymd(d); return emps.map(([e]) => sum(prod.filter((m) => m.fecha === k && m.empresa === e), "cantidad")); });
  const tot = data.map((r) => r.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(1, ...tot));
  const W = 560, H = 220, L = 48, B = 26, T = 12, cw = (W - L - 8) / 7, bw = cw * 0.56;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const dn = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  return (
    <>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Unidades producidas por día, apiladas por empresa">
          {[0, max / 2, max].map((t) => (
            <g key={t}><line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} style={{ stroke: "var(--line)" }} strokeWidth={1} /><text x={L - 6} y={y(t) + 4} textAnchor="end">{nf.format(t)}</text></g>
          ))}
          {data.map((r, i) => {
            let acc = 0;
            const x = L + i * cw + (cw - bw) / 2;
            return (
              <g key={i}>
                {r.map((v, j) => {
                  if (!v) return null;
                  const y0 = y(acc), y1 = y(acc + v); acc += v;
                  return <rect key={j} x={x} y={y1} width={bw} height={Math.max(0, y0 - y1)} style={{ fill: `var(--c-${emps[j][0]})` }}><title>{emps[j][1]}: {nf.format(v)}</title></rect>;
                })}
                {tot[i] ? <text x={x + bw / 2} y={y(tot[i]) - 4} textAnchor="middle">{nf.format(tot[i])}</text> : null}
                <text x={x + bw / 2} y={H - 8} textAnchor="middle">{dn[i]} {days[i].getDate()}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="legend">{emps.map(([e, n]) => <span key={e}><i style={{ background: `var(--c-${e})` }} />{n}</span>)}</div>
    </>
  );
}

/** Descarga un archivo generado en el navegador */
export function descargar(nombre: string, datos: Blob | string, tipo = "text/html;charset=utf-8") {
  const b = typeof datos === "string" ? new Blob([datos], { type: tipo }) : datos;
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = u; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
