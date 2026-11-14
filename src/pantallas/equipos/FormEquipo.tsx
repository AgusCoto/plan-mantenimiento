// Relevamiento y edición de equipos (jefe de mantenimiento), pensado para completar en la máquina con el celular:
// foto de la chapa, ficha con los campos propios del tipo y fotos. El código lo genera la base.
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDatos } from "../../datos/store";
import { useTema } from "../../sistema/tema";
import { insertar, actualizar } from "../../datos/cola";
import { falla } from "../../datos/supabase";
import { achicarFoto, subir } from "../../comun/archivos";
import { Campo, avisar } from "../../comun/ui";
import { Ico } from "../../sistema/iconos";
import { Recien } from "./Recien";
import type { CampoTipo, Equipo } from "../../datos/tipos";

function CampoPropio({ c, valor }: { c: CampoTipo; valor: unknown }) {
  const nombre = "campo:" + c.clave, req = !!c.obligatorio;
  const et = c.etiqueta + (c.unidad ? ` (${c.unidad})` : "") + (req ? " *" : "");
  if (c.tipo === "numero") return <Campo label={et}><input type="number" step="any" name={nombre} required={req} defaultValue={valor as number ?? ""} inputMode="decimal" /></Campo>;
  if (c.tipo === "fecha") return <Campo label={et}><input type="date" name={nombre} required={req} defaultValue={(valor as string) || ""} /></Campo>;
  if (c.tipo === "lista") return <Campo label={et}><select name={nombre} required={req} defaultValue={(valor as string) || ""}><option value="">Elegí…</option>{(c.opciones || []).map((o) => <option key={o}>{o}</option>)}</select></Campo>;
  if (c.tipo === "foto") return <Campo label={et} ayuda={valor ? "Ya tiene foto: elegí otra para reemplazarla" : undefined}><input type="file" name={"foto:" + c.clave} accept="image/*" capture="environment" /></Campo>;
  return <Campo label={et}><input type="text" name={nombre} required={req} defaultValue={(valor as string) || ""} /></Campo>;
}

export function FormEquipo() {
  const { id } = useParams();
  const d = useDatos(), tema = useTema(), nav = useNavigate();
  const e = id ? d.equipo(id) : undefined;
  const [tipo, setTipo] = useState(e?.tipo || "");
  const [chapa, setChapa] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState<Equipo | null>(null);
  if (id && !e) return <p className="vacio">No existe el equipo.</p>;
  if (creado) return <Recien e={creado} otro={() => { setCreado(null); setChapa(null); setTipo(""); }} />;
  const campos = d.tipos_equipo.find((t) => t.sigla === tipo)?.campos || [];

  async function guardar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget), v = (k: string) => String(f.get(k) || "").trim();
    setOcupado(true); setError(null);
    try {
      const valores: Record<string, unknown> = { ...(e?.campos || {}) };
      for (const c of campos) {
        if (c.tipo === "foto") continue;
        const x = v("campo:" + c.clave);
        valores[c.clave] = c.tipo === "numero" ? (x === "" ? null : Number(x.replace(",", "."))) : x || null;
      }
      const fila: Record<string, unknown> = {
        nombre: v("nombre"), marca: v("marca") || null, modelo: v("modelo") || null, serie: v("serie") || null, potencia: v("potencia") || null,
        tension: v("tension") || null, proveedor_id: v("proveedor") || null, planos: v("planos") || null, criticidad: v("criticidad") || "media",
        notas: v("notas") || null, campos: valores,
      };
      let eq: Equipo;
      if (e) eq = await actualizar("equipos", e.id, fila) as Equipo;
      else {
        if (!tipo) throw falla("Elegí el tipo de equipo.");
        Object.assign(fila, { tipo, empresa_duena_id: v("duena"), empresa_ubicacion_id: v("ubicacion_empresa") || v("duena"), area_id: v("area") || null, ubicacion: v("ubicacion") || null, codigo: "", numero: 0 });
        eq = await insertar("equipos", fila) as Equipo;
      }
      // Fotos: chapa, campos de tipo foto y fotos generales → documentos del equipo
      const docs: { categoria: string; nombre: string; archivo: File }[] = [];
      const fc = f.get("chapa"); if (fc instanceof File && fc.size) docs.push({ categoria: "chapa", nombre: "Foto de la chapa", archivo: fc });
      for (const x of f.getAll("fotos")) if (x instanceof File && x.size) docs.push({ categoria: "foto", nombre: "Foto del equipo", archivo: x });
      const camposFoto: Record<string, string> = {};
      for (const c of campos.filter((c) => c.tipo === "foto")) { const x = f.get("foto:" + c.clave); if (x instanceof File && x.size) docs.push({ categoria: "foto", nombre: c.etiqueta, archivo: x }); }
      for (const doc of docs) {
        const blob = await achicarFoto(doc.archivo);
        const ruta = await subir("documentos", `${eq.id}/${crypto.randomUUID()}.jpg`, blob, "image/jpeg");
        await insertar("documentos", { equipo_id: eq.id, categoria: doc.categoria, nombre: doc.nombre, bucket: "documentos", ruta, mime: "image/jpeg", bytes: blob.size });
        const campo = campos.find((c) => c.tipo === "foto" && c.etiqueta === doc.nombre);
        if (campo) camposFoto[campo.clave] = ruta;
      }
      if (Object.keys(camposFoto).length) eq = await actualizar("equipos", eq.id, { campos: { ...valores, ...camposFoto } }) as Equipo;
      await d.recargar("equipos", "documentos", "registro_cambios");
      if (e) { avisar("Ficha guardada"); nav("/equipos/" + eq.id); } else { setCreado(eq); window.scrollTo(0, 0); }
    } catch (x) { setError((x as { msg?: string }).msg || "No se pudo guardar."); setOcupado(false); return; }
    setOcupado(false);
  }

  const empresas = d.empresas.filter((x) => x.activa);
  return (
    <>
      <div className="encabezado"><div><h1>{e ? "Editar " + e.codigo : tema.t("relevamiento") + " de un equipo"}</h1>
        <p>{e ? e.nombre : "Completá la ficha en la máquina. El código (empresa dueña, tipo y número) se genera solo y no se edita."}</p></div></div>
      <form className="form" onSubmit={guardar}>
        {!e && <section className="panel form">
          <h2 style={{ margin: 0 }}>Foto de la {tema.t("chapa").toLowerCase()}</h2>
          <label className="subir">
            <input type="file" name="chapa" accept="image/*" capture="environment" onChange={(x) => { const f = x.target.files?.[0]; setChapa(f ? URL.createObjectURL(f) : null); }} />
            {chapa ? <img src={chapa} alt="Foto de la chapa" style={{ maxWidth: "100%", maxHeight: 240, borderRadius: "var(--r-m)" }} /> : <><Ico n="camara" className="ico" /><br /><b>Sacar la foto de la {tema.t("chapa").toLowerCase()}</b><br /><span className="chico suave">Sirve para completar marca, modelo, serie, potencia y tensión</span></>}
          </label>
        </section>}
        <section className="panel form">
          <h2 style={{ margin: 0 }}>Ficha</h2>
          {!e && <div className="fila">
            <Campo label="Tipo de equipo *"><select name="tipo" required value={tipo} onChange={(x) => setTipo(x.target.value)}><option value="">Elegí…</option>{d.tipos_equipo.filter((t) => t.activo).map((t) => <option key={t.sigla} value={t.sigla}>{t.sigla} · {t.nombre}</option>)}</select></Campo>
            <Campo label="Empresa dueña *" ayuda="No cambia aunque el equipo se preste"><select name="duena" required defaultValue=""><option value="">Elegí…</option>{empresas.map((x) => <option key={x.id} value={x.id}>{x.sigla} · {x.nombre}</option>)}</select></Campo>
          </div>}
          <Campo label="Nombre *"><input type="text" name="nombre" required defaultValue={e?.nombre} placeholder="Ej.: Apilador eléctrico 1,5 t" /></Campo>
          <div className="fila">
            <Campo label="Marca"><input type="text" name="marca" defaultValue={e?.marca || ""} /></Campo>
            <Campo label="Modelo"><input type="text" name="modelo" defaultValue={e?.modelo || ""} /></Campo>
            <Campo label="N.º de serie"><input type="text" name="serie" defaultValue={e?.serie || ""} /></Campo>
          </div>
          <div className="fila">
            <Campo label="Potencia"><input type="text" name="potencia" defaultValue={e?.potencia || ""} placeholder="Ej.: 22 kW" /></Campo>
            <Campo label="Tensión"><input type="text" name="tension" defaultValue={e?.tension || ""} placeholder="Ej.: 380 V" /></Campo>
            <Campo label="Criticidad"><select name="criticidad" defaultValue={e?.criticidad || "media"}><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select></Campo>
          </div>
          <div className="fila">
            <Campo label={tema.t("proveedor")}><select name="proveedor" defaultValue={e?.proveedor_id || ""}><option value="">Sin indicar</option>{d.proveedores.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
            <Campo label="Planos" ayuda="Dónde están o un enlace"><input type="text" name="planos" defaultValue={e?.planos || ""} /></Campo>
          </div>
          {campos.length > 0 && <div className="fila">{campos.map((c) => <CampoPropio key={c.clave} c={c} valor={e?.campos?.[c.clave]} />)}</div>}
          <Campo label="Notas"><textarea name="notas" defaultValue={e?.notas || ""} style={{ minHeight: 60 }} /></Campo>
        </section>
        {!e && <section className="panel form">
          <h2 style={{ margin: 0 }}>Ubicación</h2>
          <div className="fila">
            <Campo label="Empresa donde está" ayuda="Si es la misma que la dueña, dejalo así"><select name="ubicacion_empresa" defaultValue=""><option value="">La empresa dueña</option>{empresas.map((x) => <option key={x.id} value={x.id}>{x.sigla} · {x.nombre}</option>)}</select></Campo>
            <Campo label="Área"><select name="area" defaultValue=""><option value="">Sin indicar</option>{d.areas.filter((a) => a.activa).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
          </div>
          <Campo label="Lugar"><input type="text" name="ubicacion" placeholder="Ej.: Nave 1, sector inyección" /></Campo>
          <p className="chico suave">Después del alta, la ubicación se cambia con un movimiento (reubicación o préstamo), así queda registrado.</p>
        </section>}
        <section className="panel form">
          <Campo label="Más fotos del equipo (opcional)"><input type="file" name="fotos" accept="image/*" multiple /></Campo>
        </section>
        {error && <p className="nota critico" role="alert">{error}</p>}
        <div className="botones"><button className="boton pri grande" type="submit" disabled={ocupado}>{ocupado ? "Guardando…" : e ? "Guardar ficha" : "Dar de alta"}</button></div>
      </form>
    </>
  );
}
