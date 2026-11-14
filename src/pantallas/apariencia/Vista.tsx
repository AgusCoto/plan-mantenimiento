// Vista previa en vivo del borrador: tablero, ficha de equipo, orden y celular del operario,
// en modo claro y oscuro, con los mismos componentes y estilos de la app.
import { useMemo } from "react";
import { variables, type AreaId, type Modo, type Tokens } from "../../sistema/tokens";
import { Logo } from "../../sistema/logos";
import { Ico } from "../../sistema/iconos";
import { termino } from "../../sistema/vocabulario";
import { Pastilla, Emp } from "../../comun/ui";
import type { ItemLista } from "../../datos/tipos";

export type Muestra = "tablero" | "ficha" | "orden" | "celular";

export function Vista({ tk, modo, area, muestra, empresas, listas }: {
  tk: Tokens; modo: Modo; area: AreaId; muestra: Muestra; empresas: { sigla: string; nombre: string; color: string }[]; listas: ItemLista[];
}) {
  const vars = useMemo(() => variables(tk, { modo, area: muestra === "celular" ? tk.perfil_area.operario : area, empresas, tactil: muestra === "celular" }), [tk, modo, area, muestra, empresas]);
  const t = (k: Parameters<typeof termino>[1]) => termino(tk.vocabulario, k);
  const a = muestra === "celular" ? tk.perfil_area.operario : area;
  const e1 = empresas[0] || { sigla: "INY", nombre: "Inyectora de plásticos", color: "#2F6FC0" };
  const e2 = empresas[1] || e1;
  const estado = (k: string) => listas.find((x) => x.lista === "estado_orden" && x.clave === k);
  const fallas = listas.filter((x) => x.lista === "tipo_falla" && x.activo).slice(0, 6);
  const barra = (
    <header className="barra">
      <span className="marca-app">{tk.marca.logo_url ? <img src={tk.marca.logo_url} alt="" /> : <Logo tema={tk} area={a} tam={30} />}<span>{tk.marca.nombre}<small>{tk.areas[a].nombre}</small></span></span>
      <span className="sp" /><span className="conexion">Conectado</span>
    </header>
  );
  const est = estado("en_curso");
  return (
    <div className={"tema-local" + (muestra === "celular" ? " celular" : "")} style={vars as React.CSSProperties} data-modo={modo} aria-label={`Vista previa ${muestra} en modo ${modo}`}>
      {barra}
      <div style={{ padding: "var(--e3)", display: "flex", flexDirection: "column", gap: "var(--e3)" }}>
        {muestra === "tablero" && <>
          <h2>Tablero de mantenimiento</h2>
          <div className="kpis">
            <div className="kpi ok"><span className="v">42</span><span className="k">Equipos operativos</span></div>
            <div className="kpi critico"><span className="v">2</span><span className="k">Parados</span></div>
            <div className="kpi alerta"><span className="v">5</span><span className="k">{t("ordenes")} abiertas</span></div>
          </div>
          <div className="panel"><div className="lista">
            <div className="item"><div className="cuerpo-item"><div className="t">Inyectora 280 t</div><div className="meta"><span className="codigo">{e1.sigla}-INY-001</span><Emp sigla={e1.sigla} nombre={e1.nombre} /></div></div><Pastilla c="critico">Detenido</Pastilla></div>
            <div className="item"><div className="cuerpo-item"><div className="t">Compresor 30 HP</div><div className="meta"><span className="codigo">{e2.sigla}-COM-002</span><Emp sigla={e2.sigla} nombre={e2.nombre} /></div></div><Pastilla c="ok">Operativo</Pastilla></div>
          </div><div className="botones" style={{ marginTop: "var(--e3)" }}><button className="boton pri">Nueva {t("orden").toLowerCase()}</button><button className="boton">Ver {t("equipos").toLowerCase()}</button></div></div>
        </>}
        {muestra === "ficha" && <>
          <h2>Apilador eléctrico 1,5 t</h2>
          <div className="placa"><div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="codigo" style={{ fontSize: "var(--t-l)" }}>{e1.sigla}-APL-001</span><Pastilla c="alerta">En reparación</Pastilla></div>
            <dl><dt>Marca</dt><dd>Toyota SPE150</dd><dt>Empresa dueña</dt><dd><Emp sigla={e1.sigla} nombre={e1.nombre} /></dd><dt>Está en</dt><dd><Emp sigla={e2.sigla} nombre={e2.nombre} /> · Depósito</dd><dt>Criticidad</dt><dd>Alta</dd></dl>
          </div></div>
          <div className="pestanas"><button className="activa">Historial</button><button>{t("ordenes")}</button><button>Documentos</button></div>
          <div className="linea-tiempo"><div className="lt orden"><div className="f">12/11/2026 09:30</div><div>{t("orden_abrev")}-0012 · Pérdida de aceite</div></div><div className="lt ok"><div className="f">02/10/2026</div><div>Preventivo realizado</div></div></div>
        </>}
        {muestra === "orden" && <>
          <h2>{t("orden_abrev")}-0012 · Pérdida de aceite</h2>
          <div className="botones">{["abierta", "asignada", "esperando_repuesto", "en_curso", "verificada", "cerrada"].map((k) => { const s = estado(k); return (
            <span key={k} className="pastilla" style={s?.color ? { background: `color-mix(in srgb, ${s.color} 14%, var(--superficie))`, color: `color-mix(in srgb, ${s.color} 80%, var(--tinta))` } : undefined}>{s?.nombre || k}</span>); })}</div>
          <div className="panel form">
            <div className="fila"><div><div className="etiq">Prioridad</div><Pastilla c="critico">Urgente</Pastilla></div><div><div className="etiq">Estado</div><span>{est?.nombre || "En curso"}</span></div></div>
            <label className="campo"><span>{t("ficha")}</span><textarea defaultValue="Cambio de sello del cilindro" /></label>
            <div className="nota info">Equipo crítico: firma el {t("supervisor").toLowerCase()}.</div>
            <button className="boton pri">Guardar {t("ficha").toLowerCase()}</button>
          </div>
        </>}
        {muestra === "celular" && <>
          <h2>{t("reportar")}</h2>
          <div className="placa" style={{ padding: "var(--e3)" }}><div><span className="codigo">{e1.sigla}-INY-001</span><div style={{ fontWeight: 600 }}>Inyectora 280 t</div></div></div>
          <div className="fallas">{fallas.map((f, i) => <button key={f.clave} className="falla" aria-pressed={i === 1}><Ico n={f.icono || "pregunta"} />{f.nombre}</button>)}</div>
          <button className="boton pri grande">Enviar</button>
        </>}
      </div>
    </div>
  );
}
