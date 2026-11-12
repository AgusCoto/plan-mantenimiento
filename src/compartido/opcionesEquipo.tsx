import type { useDatos } from "./datos";

type D = ReturnType<typeof useDatos>;

/** Lista de máquinas agrupada por empresa (primero la indicada) */
export function OpcionesEquipo({ d, emp = "", vacio = "Elegí la máquina" }: { d: D; emp?: string; vacio?: string }) {
  const l = d.equipos.filter((e) => e.estado !== "baja");
  const emps = [...d.empresas].sort((a, b) => (a.sigla === emp ? 0 : 1) - (b.sigla === emp ? 0 : 1));
  return (
    <>
      <option value="">{vacio}</option>
      {emps.map((k) => (
        <optgroup key={k.sigla} label={k.nombre}>
          {l.filter((e) => e.empresa === k.sigla).map((e) => <option key={e.codigo} value={e.codigo}>{e.nombre} ({e.codigo})</option>)}
        </optgroup>
      ))}
    </>
  );
}

