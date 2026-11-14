// Panel Apariencia (solo el jefe de mantenimiento): todo se ve en una vista previa en vivo antes de guardar.
// Cada guardado crea una versión nueva del tema; se puede volver a cualquier versión, exportar e importar.
import { useMemo, useState } from "react";
import { useDatos } from "../../datos/store";
import { useTema } from "../../sistema/tema";
import { sb, falla, mensajeError } from "../../datos/supabase";
import { completar, revisarContraste, AREAS, type AreaId, type Tokens, type Modo } from "../../sistema/tokens";
import { logoSvg } from "../../sistema/logos";
import { textoSobre } from "../../sistema/color";
import { Ventana, abrir, avisar, confirmar, descargar, Pastilla } from "../../comun/ui";
import { fdt } from "../../comun/formato";
import { Vista, type Muestra } from "./Vista";
import * as S from "./secciones";

const SECCIONES: [string, string][] = [
  ["marca", "Marca"], ["areas", "Colores por área"], ["logos", "Logos por área"], ["estados", "Estados y empresas"], ["tipografia", "Tipografía"],
  ["forma", "Forma"], ["tema", "Tema"], ["vocabulario", "Vocabulario y listas"], ["campos", "Campos de la ficha"], ["etiqueta", "Etiqueta QR y NFC"],
  ["informes", "Informes"], ["oficina", "Pantalla de oficina"], ["inicio", "Inicio por perfil"],
];

function conRuta<T>(obj: T, ruta: string, valor: unknown): T {
  const [k, ...resto] = ruta.split(".");
  const o = (obj || {}) as Record<string, unknown>;
  return { ...o, [k]: resto.length ? conRuta(o[k], resto.join("."), valor) : valor } as T;
}

/* ---------- Íconos de la app (192 y 512) a partir del logo ---------- */
const imagen = (src: string) => new Promise<HTMLImageElement>((r, j) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => r(i); i.onerror = j; i.src = src; });
async function generarIconos(tk: Tokens): Promise<{ icono_192: string; icono_512: string }> {
  const fondo = tk.marca.fondo_carga;
  let src = tk.marca.logo_url;
  if (!src) {
    const a = tk.areas.mant;
    const svg = logoSvg(a.logo, a.integrar_w).replace(/var\(--marca-tinta\)/g, textoSobre(a.principal)).replace(/var\(--marca\)/g, a.principal).replace(/var\(--dorado\)/g, tk.areas.dir.detalle)
      .replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" `);
    src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  const img = await imagen(src);
  const urls: Record<string, string> = {};
  for (const n of [192, 512]) {
    const c = document.createElement("canvas"); c.width = n; c.height = n;
    const x = c.getContext("2d")!;
    x.fillStyle = tk.marca.logo_url ? fondo : tk.areas.mant.principal; x.fillRect(0, 0, n, n);
    const lado = n * 0.64, esc = Math.min(lado / img.width, lado / img.height);
    x.drawImage(img, (n - img.width * esc) / 2, (n - img.height * esc) / 2, img.width * esc, img.height * esc);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    const ruta = `icono-${n}-${crypto.randomUUID()}.png`;
    const { error } = await sb().storage.from("marca").upload(ruta, blob, { contentType: "image/png" });
    if (error) throw falla("No se pudo generar el ícono: " + mensajeError(error));
    urls["icono_" + n] = sb().storage.from("marca").getPublicUrl(ruta).data.publicUrl;
  }
  return urls as { icono_192: string; icono_512: string };
}
const firmaIcono = (tk: Tokens) => JSON.stringify([tk.marca.logo_url, tk.marca.fondo_carga, tk.areas.mant.logo, tk.areas.mant.integrar_w, tk.areas.mant.principal]);

/* ---------- Guardar (con control de contraste) ---------- */
async function guardar(borrador: Tokens, actual: Tokens, nota: string, confirmo: boolean) {
  let tk = borrador;
  if (firmaIcono(borrador) !== firmaIcono(actual) || !borrador.marca.icono_192) {
    try { tk = conRuta(tk, "marca", { ...tk.marca, ...(await generarIconos(tk)) }); } catch (e) { console.error("íconos", e); avisar((e as { msg?: string }).msg || "No se pudieron generar los íconos; se guarda igual."); }
  }
  const { data, error } = await sb().rpc("guardar_tema", { p_tokens: tk, p_nota: nota || null, p_confirmo_contraste: confirmo });
  if (error) throw falla(mensajeError(error));
  return data as { ok: boolean; version?: number; problemas: unknown[] };
}

function Versiones({ alVolver }: { alVolver: () => void }) {
  const d = useDatos(), tema = useTema();
  return (
    <Ventana titulo="Versiones de la apariencia" ancho={720}>
      <p className="suave chico">Cada guardado es una versión. Volver a una anterior la aplica como versión nueva, así queda todo en el historial.</p>
      <div className="tabla"><table><thead><tr><th>Versión</th><th>Fecha</th><th>Quién</th><th>Nota</th><th></th></tr></thead><tbody>
        {d.temas.map((v) => (
          <tr key={v.id}><td className="mono">{v.version}{v.de_fabrica && <> <Pastilla>De fábrica</Pastilla></>}{v.activo && <> <Pastilla c="ok">En uso</Pastilla></>}</td>
            <td className="num">{fdt(v.creado_en)}</td><td>{d.usuarioDe(v.creado_por)?.nombre || "Sistema"}</td><td className="chico">{v.nota}</td>
            <td><div className="botones">
              {!v.activo && <button className="boton chico" onClick={async () => {
                const { error } = await sb().rpc("volver_a_tema", { p_version: v.version });
                if (error) avisar(mensajeError(error)); else { await d.recargar("temas"); tema.recargar(); alVolver(); avisar("Apariencia restaurada a la versión " + v.version); }
              }}>Volver a esta</button>}
              <button className="boton chico" onClick={() => descargar(`tema-v${v.version}.json`, JSON.stringify(v.tokens, null, 2), "application/json")}>Exportar</button>
            </div></td></tr>))}
      </tbody></table></div>
    </Ventana>
  );
}

export function Apariencia() {
  const tema = useTema(), d = useDatos();
  const actual = tema.tokens;
  const [b, setB] = useState<Tokens>(actual);
  const [sec, setSec] = useState("marca");
  const [muestra, setMuestra] = useState<Muestra>("tablero");
  const [areaVista, setAreaVista] = useState<AreaId>("mant");
  const [nota, setNota] = useState("");
  const poner: S.Poner = (ruta, valor) => setB((x) => completar(conRuta(x, ruta, valor)));
  const cambios = JSON.stringify(b) !== JSON.stringify(actual);
  const problemas = useMemo(() => revisarContraste(b), [b]);
  const empresas = d.empresas.map((e) => ({ sigla: e.sigla, nombre: e.nombre, color: e.color }));

  async function alGuardar(confirmo = false) {
    try {
      const r = await guardar(b, actual, nota, confirmo);
      if (!r.ok) {
        abrir(<Ventana titulo="Hay textos que no se van a leer bien" ok="Guardar igual" peligro onSubmit={async () => { await alGuardar(true); }}>
          <p>Estos pares tienen un contraste menor a 4,5:1 (mínimo recomendado para leer en planta):</p>
          <ul>{problemas.map((p, i) => <li key={i}>{p.par} (modo {p.modo}): {String(p.contraste).replace(".", ",")}:1{p.sugerido && <> — sugerido <span className="muestra" style={{ background: p.sugerido }} /> {p.sugerido}</>}</li>)}</ul>
          <p className="suave chico">Podés cancelar y usar «Corregir todo» o guardar igual (queda anotado en el registro de cambios).</p>
        </Ventana>);
        return;
      }
      await d.recargar("temas", "registro_cambios"); tema.recargar(); setNota("");
      avisar(`Apariencia guardada (versión ${r.version}). Todos la ven al instante.`);
    } catch (e) { avisar((e as { msg?: string }).msg || "No se pudo guardar"); }
  }
  const corregirTodo = () => {
    let x = b;
    for (const p of problemas) if (p.ruta && p.sugerido) x = completar(conRuta(x, p.ruta, p.sugerido));
    setB(x);
  };
  const importar = (f: File) => {
    const r = new FileReader();
    r.onload = () => {
      try { const j = JSON.parse(String(r.result)); if (!j || typeof j !== "object" || !j.colores || !j.areas) throw new Error(); setB(completar(j)); avisar("Tema importado: revisalo en la vista previa y guardalo."); }
      catch { avisar("Ese archivo no es un tema válido."); }
    };
    r.readAsText(f);
  };

  const editor = (() => {
    switch (sec) {
      case "marca": return <S.Marca tk={b} poner={poner} />;
      case "areas": return <S.ColoresArea tk={b} poner={poner} />;
      case "logos": return <S.LogosArea tk={b} poner={poner} />;
      case "estados": return <><S.Estados tk={b} poner={poner} /><S.Empresas /></>;
      case "tipografia": return <S.Tipografia tk={b} poner={poner} />;
      case "forma": return <S.Forma tk={b} poner={poner} />;
      case "tema": return <S.Tema tk={b} poner={poner} />;
      case "vocabulario": return <><S.Vocabulario tk={b} poner={poner} /><S.Listas /></>;
      case "campos": return <S.CamposFicha />;
      case "etiqueta": return <S.Etiqueta tk={b} poner={poner} />;
      case "informes": return <S.Informes tk={b} poner={poner} />;
      case "oficina": return <S.Oficina tk={b} poner={poner} />;
      default: return <S.InicioPerfil />;
    }
  })();
  return (
    <>
      <div className="encabezado"><div><h1>Apariencia</h1><p>Los cambios se ven en la vista previa antes de guardarlos. Al guardar, todos los usuarios conectados los ven al instante. Versión en uso: {tema.version || "de fábrica"}.</p></div><span className="sp" />
        <div className="botones">
          <button className="boton" onClick={() => abrir(<Versiones alVolver={() => setB(tema.tokens)} />)}>Versiones</button>
          <button className="boton" onClick={() => descargar("tema-actual.json", JSON.stringify(b, null, 2), "application/json")}>Exportar</button>
          <label className="boton" style={{ cursor: "pointer" }}>Importar<input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importar(f); }} /></label>
        </div></div>
      <div className="pestanas" role="tablist">{SECCIONES.map(([k, n]) => <button key={k} role="tab" aria-selected={sec === k} className={sec === k ? "activa" : ""} onClick={() => setSec(k)}>{n}</button>)}</div>
      {problemas.length > 0 && (
        <div className="nota critico"><span><b>{problemas.length} {problemas.length === 1 ? "texto no se lee bien" : "textos no se leen bien"}</b> (contraste menor a 4,5:1): {problemas.slice(0, 3).map((p) => `${p.par} (${p.modo})`).join(", ")}{problemas.length > 3 ? "…" : ""}</span>
          <span className="sp" />{problemas.some((p) => p.sugerido) && <button className="boton chico" onClick={corregirTodo}>Corregir todo</button>}</div>
      )}
      <div className="apariencia">
        <div className="form">{editor}
          <div className="panel form" style={{ position: "sticky", bottom: 0 }}>
            <input type="text" placeholder="Nota de esta versión (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} aria-label="Nota de la versión" />
            <div className="botones">
              <button className="boton pri" disabled={!cambios} onClick={() => alGuardar(false)}>Guardar y aplicar a todos</button>
              <button className="boton" disabled={!cambios} onClick={() => setB(actual)}>Descartar cambios</button>
              <button className="boton" onClick={() => confirmar("Volver al tema de fábrica", "Se carga el tema de fábrica en la vista previa. Para aplicarlo, guardalo.", "Cargar", async () => {
                const f = d.temas.find((t) => t.de_fabrica); if (f) setB(completar(f.tokens));
              })}>Tema de fábrica</button>
            </div>
          </div>
        </div>
        <div className="previa" aria-label="Vista previa">
          <div className="botones">
            <select value={muestra} onChange={(e) => setMuestra(e.target.value as Muestra)} aria-label="Qué mostrar">
              <option value="tablero">Tablero</option><option value="ficha">Ficha de equipo</option><option value="orden">Orden</option><option value="celular">Celular del operario</option></select>
            {muestra !== "celular" && <select value={areaVista} onChange={(e) => setAreaVista(e.target.value as AreaId)} aria-label="Área">{AREAS.map((a) => <option key={a} value={a}>{b.areas[a].nombre}</option>)}</select>}
          </div>
          {(["claro", "oscuro"] as Modo[]).map((m) => <Vista key={m} tk={b} modo={m} area={areaVista} muestra={muestra} empresas={empresas} listas={d.listas} />)}
        </div>
      </div>
    </>
  );
}
