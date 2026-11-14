// Fechas, números y moneda en formato argentino: dd/mm/aaaa, 1.234,5 y $.
export const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export const hoy = () => ymd(new Date());
export function parseD(s: string | null | undefined): Date | null {
  if (!s) return null;
  if (s.length === 10) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  const d = new Date(s);
  return isNaN(+d) ? null : d;
}
export const fd = (s: string | null | undefined) => { const d = parseD(s); return d ? pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() : "—"; };
export const fdt = (s: string | null | undefined) => { const d = parseD(s); return d ? fd(s) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) : "—"; };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const nf = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
export const nf0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
export const pesos = (v: number | null | undefined) => "$ " + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(v || 0);
export const hace = (s: string | null | undefined) => {
  const d = parseD(s); if (!d) return "—";
  const min = Math.round((Date.now() - +d) / 60000);
  if (min < 1) return "recién"; if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60); if (h < 24) return `hace ${h} h`;
  const dd = Math.round(h / 24); return dd === 1 ? "ayer" : `hace ${dd} días`;
};
