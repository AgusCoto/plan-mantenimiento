// Fechas, números y cálculos de vencimiento (mismo criterio que el prototipo).

export const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export const hoy = () => ymd(new Date());

/** "2026-11-12" se toma como fecha local; cualquier otro texto, como fecha y hora ISO. */
export function parseD(s: string | null | undefined): Date | null {
  if (!s) return null;
  if (s.length === 10) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(s);
  return isNaN(+d) ? null : d;
}
export const fd = (s: string | null | undefined) => {
  const d = parseD(s);
  return d ? pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + String(d.getFullYear()).slice(2) : "—";
};
export const fdt = (s: string | null | undefined) => {
  const d = parseD(s);
  return d ? fd(s) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) : "—";
};
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const daysBetween = (a: string, b: string) => Math.round((+parseD(b)! - +parseD(a)!) / 864e5);
export const nf = new Intl.NumberFormat("es-AR");
export const nf1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
export const money = (v: number | null | undefined) => "$ " + nf.format(Math.round(v || 0));
export const num = (v: number) => nf.format(v);
export const weekStart = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const w = (x.getDay() + 6) % 7;
  return addDays(x, -w);
};
export const sum = <T,>(a: T[], k: keyof T) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
export const hrs = (v: number | null) => (v == null ? "—" : v < 48 ? nf1.format(v) + " h" : nf1.format(v / 24) + " días");
export const niceMax = (v: number) => {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

export interface PrevBase { ultima: string | null; frecuencia: number; creado?: string | null }
export function prevNext(p: PrevBase) {
  const base = p.ultima || (p.creado ? p.creado.slice(0, 10) : hoy());
  return ymd(addDays(parseD(base)!, Number(p.frecuencia) || 30));
}
/** [texto, clase, días hasta el vencimiento (negativo = vencido)] */
export function prevStatus(p: PrevBase): [string, string, number] {
  const n = prevNext(p);
  const dd = daysBetween(hoy(), n);
  return dd < 0 ? ["Vencido", "crit", dd] : dd <= 7 ? ["Próximo", "warn", dd] : ["Al día", "ok", dd];
}
