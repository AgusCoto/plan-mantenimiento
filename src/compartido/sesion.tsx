// Ingreso, sesión y "Mi cuenta". Una cuenta de gestión no entra a operarios y viceversa.
import { useEffect, useState, type FormEvent } from "react";
import { sb, emailDe, mensajeError, type App } from "./supabase";
import { Mark } from "./logos";
import { AREA_N, CON_CODIGO, ROLES, type Rol } from "./catalogos";
import { Modal, Field, toast, falla } from "./ui";
import type { Cuenta } from "./tipos";

export function useSesion(app: App) {
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [listo, setListo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    async function revisar(uid: string | undefined) {
      if (!uid) { if (vivo) { setCuenta(null); setListo(true); } return; }
      const { data, error } = await sb().from("cuentas").select("*").eq("id", uid).maybeSingle();
      if (!vivo) return;
      if (error && !data) { setAviso(mensajeError(error)); setListo(true); return; }
      const c = data as Cuenta | null;
      const motivo = !c ? "Tu usuario no tiene un perfil asignado. Hablá con tu gerente."
        : !c.activo ? "Esta cuenta está desactivada. Hablá con tu gerente."
        : app === "operarios" && c.rol !== "op" ? "Esta cuenta es de gestión. Entrá por la app de Gestión."
        : app === "gestion" && c.rol === "op" ? "Esta cuenta es de operario. Entrá por la app de operarios."
        : null;
      if (motivo) { setAviso(motivo); await sb().auth.signOut(); setCuenta(null); }
      else setCuenta(c);
      setListo(true);
    }
    sb().auth.getSession().then(({ data }) => revisar(data.session?.user.id));
    const { data: sub } = sb().auth.onAuthStateChange((ev, s) => {
      if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") revisar(s?.user.id);
    });
    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, [app]);

  return { cuenta, listo, aviso, setAviso, salir: () => sb().auth.signOut() };
}

export function Ingreso({ app, aviso, equipo, otraApp }: { app: App; aviso: string | null; equipo?: string | null; otraApp: string }) {
  const op = app === "operarios";
  const [err, setErr] = useState<string | null>(aviso);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => setErr(aviso), [aviso]);
  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const u = String(f.get("u") || "").trim(), p = String(f.get("p") || "");
    setOcupado(true); setErr(null);
    const { error } = await sb().auth.signInWithPassword({ email: u.includes("@") ? u : emailDe(u), password: p });
    setOcupado(false);
    if (error) setErr(mensajeError(error));
  }
  return (
    <div className="start" style={{ maxWidth: 440 }}>
      <div className="brand"><Mark area={op ? "op" : "mant"} size={44} />{op ? "Operarios" : "Gestión de Planta"}</div>
      <div>
        <h1>{op ? "App de operarios" : "Ingresar"}</h1>
        <p className="muted">{op ? "Reportá problemas en las máquinas y cargá producción, ventas y compras." : "Mantenimiento, producción, administración y dirección del grupo."}
          {equipo && <> Después de ingresar se abre el equipo <span className="code">{equipo}</span>.</>}</p>
      </div>
      <form className="form panel" onSubmit={enviar} style={op ? { fontSize: 16 } : undefined}>
        <label className="field"><span>Usuario</span><input type="text" id="l-u" name="u" required autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
        <label className="field"><span>Contraseña</span><input type="password" id="l-p" name="p" required autoComplete="current-password" /></label>
        {err && <p className="small" id="l-err" style={{ color: "var(--crit)" }}>{err}</p>}
        <button className="btn pri" type="submit" disabled={ocupado}>{ocupado ? "Ingresando…" : "Ingresar"}</button>
      </form>
      {!op && <div className="areas">{(["mant", "prod", "admin", "dir"] as const).map((a) => <span className="area-chip" key={a}><Mark area={a} size={26} />{AREA_N[a]}</span>)}</div>}
      <p className="muted small">
        {op ? <>¿Sos de mantenimiento o de una gerencia? <a href={otraApp}>Entrá a Gestión</a>.</> : <>¿Sos operario? Entrá por la <a href={otraApp}>app de operarios</a>.</>}
        {" "}Si no tenés cuenta o te olvidaste la contraseña, pedísela a tu gerente.
      </p>
    </div>
  );
}

export function MiCuenta({ cuenta }: { cuenta: Cuenta }) {
  const cod = CON_CODIGO.includes(cuenta.rol);
  return (
    <Modal title="Mi cuenta" onSubmit={async (d) => {
      if (!d.pass && !d.code) throw falla("No cambiaste nada.");
      if (d.pass && d.pass.length < 8) throw falla("La contraseña nueva tiene que tener al menos 8 caracteres.");
      if (d.code && !/^[0-9]{4,6}$/.test(d.code)) throw falla("El código tiene que tener de 4 a 6 números.");
      const { error } = await sb().rpc("cambiar_mis_datos", { p_actual: d.cur, p_clave: d.pass || null, p_codigo: d.code || null });
      if (error) throw falla(mensajeError(error));
      window.dispatchEvent(new Event("planta:mis-datos"));
      toast("Datos actualizados");
    }}>
      <p><b>{cuenta.nombre}</b> · <span className="mono">{cuenta.usuario}</span> · {ROLES[cuenta.rol as Rol].n}</p>
      <Field label="Contraseña actual"><input type="password" name="cur" id="a-cur" required autoComplete="current-password" /></Field>
      <div className="row">
        <Field label="Contraseña nueva (opcional)"><input type="password" name="pass" id="a-p" minLength={8} autoComplete="new-password" /></Field>
        {cod && <Field label="Código de acceso nuevo (opcional)"><input type="password" name="code" id="a-c" inputMode="numeric" pattern="[0-9]{4,6}" autoComplete="off" /></Field>}
      </div>
      {cod && <p className="small muted">El código de acceso (4 a 6 números) autoriza cambios sensibles: el nombre de las empresas y{cuenta.rol === "gm" ? " las altas de equipos." : " otros cambios que lo pidan."}</p>}
    </Modal>
  );
}
