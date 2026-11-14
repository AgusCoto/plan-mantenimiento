// Aplica el tema activo en vivo: lo lee de la base (también sin sesión, para la pantalla de ingreso),
// lo guarda en caché para que la app se vea bien sin señal y escucha los cambios por Realtime.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { sb } from "../datos/supabase";
import { FABRICA, aplicar, cargarFuentes, completar, variables, type AreaId, type Modo, type Perfil, type Tokens } from "./tokens";
import { termino, type Termino } from "./vocabulario";

const CACHE = "mant-tema";
const leerCache = (): { version: number; tokens: Tokens } | null => {
  try { return JSON.parse(localStorage.getItem(CACHE) || "null"); } catch { return null; }
};

interface Ctx {
  tokens: Tokens; version: number; modo: Modo; area: AreaId;
  t: (k: Termino) => string;
  /** Preferencias del usuario: tema claro/oscuro/sistema y tamaño de texto */
  setPreferencias: (p: { tema?: "claro" | "oscuro" | "sistema"; tamano?: "chico" | "normal" | "grande" | null }) => void;
  preferencias: { tema: "claro" | "oscuro" | "sistema" | null; tamano: "chico" | "normal" | "grande" | null };
  empresas: { sigla: string; color: string }[];
  setEmpresas: (e: { sigla: string; color: string }[]) => void;
  setPerfil: (p: Perfil | null) => void;
  recargar: () => void;
}
const C = createContext<Ctx | null>(null);
export const useTema = () => { const c = useContext(C); if (!c) throw new Error("useTema fuera de TemaProvider"); return c; };

const oscuroSistema = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
const tactil = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export function TemaProvider({ children }: { children: ReactNode }) {
  const cache = leerCache();
  const [tokens, setTokens] = useState<Tokens>(completar(cache?.tokens || FABRICA));
  const [version, setVersion] = useState(cache?.version || 0);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [empresas, setEmpresas] = useState<{ sigla: string; color: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem("mant-empresas") || "[]"); } catch { return []; }
  });
  const [preferencias, setPref] = useState<Ctx["preferencias"]>(() => {
    try { return { tema: null, tamano: null, ...JSON.parse(localStorage.getItem("mant-preferencias") || "{}") }; } catch { return { tema: null, tamano: null }; }
  });
  const [sisOscuro, setSisOscuro] = useState(oscuroSistema());
  const [tocar, setTocar] = useState(0);

  // Tema activo + cambios en vivo
  useEffect(() => {
    let vivo = true;
    sb().from("temas").select("version,tokens").eq("activo", true).maybeSingle().then(({ data }) => {
      if (!vivo || !data) return;
      setTokens(completar(data.tokens as Tokens)); setVersion(data.version);
      try { localStorage.setItem(CACHE, JSON.stringify(data)); } catch { /* sin espacio */ }
    });
    const canal = sb().channel("tema").on("postgres_changes", { event: "*", schema: "public", table: "temas" }, () => setTocar((x) => x + 1)).subscribe();
    return () => { vivo = false; sb().removeChannel(canal); };
  }, [tocar]);
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const f = () => setSisOscuro(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);

  const elegido = preferencias.tema || tokens.modo;
  const modo: Modo = elegido === "sistema" ? (sisOscuro ? "oscuro" : "claro") : elegido;
  const area: AreaId = perfil ? tokens.perfil_area[perfil] || "mant" : "mant";

  useEffect(() => {
    aplicar(document.documentElement, variables(tokens, { modo, area, empresas, tamano: preferencias.tamano, tactil: tactil() }));
    document.documentElement.dataset.modo = modo;
    document.documentElement.style.colorScheme = modo === "oscuro" ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", tokens.areas[area]?.barra || tokens.marca.fondo_carga);
    document.title = tokens.marca.nombre || "Mantenimiento";
    cargarFuentes(tokens);
  }, [tokens, modo, area, empresas, preferencias.tamano]);

  const v = useMemo<Ctx>(() => ({
    tokens, version, modo, area, preferencias, empresas,
    t: (k) => termino(tokens.vocabulario, k),
    setPreferencias: (p) => setPref((x) => {
      const n = { ...x, ...p };
      try { localStorage.setItem("mant-preferencias", JSON.stringify(n)); } catch { /* */ }
      return n;
    }),
    setEmpresas: (e) => { setEmpresas(e); try { localStorage.setItem("mant-empresas", JSON.stringify(e)); } catch { /* */ } },
    setPerfil, recargar: () => setTocar((x) => x + 1),
  }), [tokens, version, modo, area, preferencias, empresas]);
  return <C.Provider value={v}>{children}</C.Provider>;
}
