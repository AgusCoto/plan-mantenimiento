// Sesión: quién está conectado, con qué perfil y empresas. Aplica su área (colores) y sus preferencias.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { sb, emailDe, mensajeError } from "./supabase";
import { useTema } from "../sistema/tema";
import type { Usuario } from "./tipos";
import { olvidarEsteCelular } from "./push";

interface Ctx { usuario: Usuario | null; listo: boolean; aviso: string | null; entrar: (u: string, clave: string) => Promise<string | null>; salir: () => Promise<void>; recargarUsuario: () => void }
const C = createContext<Ctx | null>(null);
export const useSesion = () => { const c = useContext(C); if (!c) throw new Error("useSesion fuera de SesionProvider"); return c; };

export function SesionProvider({ children }: { children: ReactNode }) {
  const tema = useTema();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [listo, setListo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tocar, setTocar] = useState(0);

  useEffect(() => {
    let vivo = true;
    async function revisar(uid: string | undefined) {
      if (!uid) { if (vivo) { setUsuario(null); tema.setPerfil(null); setListo(true); } return; }
      const { data, error } = await sb().from("usuarios").select("*").eq("id", uid).maybeSingle();
      if (!vivo) return;
      if (error && !data) {
        // Sin señal: se usa el último usuario guardado para poder trabajar igual
        try { const u = JSON.parse(localStorage.getItem("mant-usuario") || "null"); if (u && u.id === uid) { setUsuario(u); tema.setPerfil(u.perfil); } } catch { /* */ }
        setListo(true); return;
      }
      const u = data as Usuario | null;
      if (!u || !u.activo) {
        setAviso(!u ? "Tu usuario no tiene un perfil asignado. Hablá con el jefe de mantenimiento." : "Este usuario está desactivado. Hablá con el jefe de mantenimiento.");
        await sb().auth.signOut(); setUsuario(null); tema.setPerfil(null); setListo(true); return;
      }
      setUsuario(u); tema.setPerfil(u.perfil);
      try { localStorage.setItem("mant-usuario", JSON.stringify(u)); } catch { /* */ }
      // Preferencias propias (tema y tamaño): se guardan aparte y no afectan a los demás
      const p = await sb().from("preferencias_usuario").select("*").eq("usuario_id", uid).maybeSingle();
      if (vivo && p.data) tema.setPreferencias({ tema: p.data.tema, tamano: p.data.tamano });
      setListo(true);
    }
    sb().auth.getSession().then(({ data, error }) => {
      // Sin señal y con el permiso de acceso vencido, no se puede renovar: se sigue con el último usuario
      // guardado (los datos están en el celular y las cargas quedan en la cola hasta que vuelva la señal).
      if (!data.session && error && !navigator.onLine) {
        try { const u = JSON.parse(localStorage.getItem("mant-usuario") || "null"); if (u) { setUsuario(u); tema.setPerfil(u.perfil); setListo(true); return; } } catch { /* */ }
      }
      revisar(data.session?.user.id);
    });
    const { data: sub } = sb().auth.onAuthStateChange((ev, s) => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") revisar(s?.user.id); });
    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, [tocar]); // eslint-disable-line react-hooks/exhaustive-deps

  const v: Ctx = {
    usuario, listo, aviso,
    entrar: async (u, clave) => {
      setAviso(null);
      const { error } = await sb().auth.signInWithPassword({ email: u.includes("@") ? u : emailDe(u), password: clave });
      return error ? mensajeError(error) : null;
    },
    salir: async () => { try { localStorage.removeItem("mant-usuario"); } catch { /* */ } await olvidarEsteCelular(); await sb().auth.signOut(); },
    recargarUsuario: () => setTocar((x) => x + 1),
  };
  return <C.Provider value={v}>{children}</C.Provider>;
}
