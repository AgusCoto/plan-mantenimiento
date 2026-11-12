// Catálogos y textos fijos del prototipo. Las empresas, áreas, tipos y productos
// viven en la base (tablas empresas, areas, tipos_equipo, productos); acá quedan
// los estados, perfiles y permisos que maneja la interfaz.

export type Rol = "gm" | "tec" | "gp" | "adm" | "dir" | "op";
export type Area = "mant" | "prod" | "admin" | "dir" | "op";
export type Par = [string, string]; // [texto, clase de color]

export const SIGLAS = ["INY", "LIM", "PIN", "SAL"] as const;
export type Sigla = (typeof SIGLAS)[number];

export const ESTADOS_EQ: Record<string, Par> = { operativo: ["Operativo", "ok"], detenido: ["Detenido", "crit"], reparacion: ["En reparación", "warn"], baja: ["De baja", ""] };
export const ESTADOS_OT: Record<string, Par> = { abierta: ["Abierta", "info"], curso: ["En curso", "warn"], revisar: ["Para revisar", "warn"], cerrada: ["Cerrada", "ok"] };
export const PRIOR: Record<string, Par> = { alta: ["Alta", "crit"], media: ["Media", "warn"], baja: ["Baja", ""] };
export const TIPOS_REP = ["Ruido", "Vibración", "Pérdida / fuga", "Temperatura alta", "No arranca", "Olor a quemado", "Falla eléctrica", "Otro"];
export const ESTADOS_REP: Record<string, Par> = { nuevo: ["Nuevo", "crit"], analisis: ["En análisis", "warn"], ot: ["OT generada", "ok"], descartado: ["Descartado", ""] };
export const ESTADOS_MOV: Record<string, Par> = { pendiente: ["Sin revisar", "warn"], revisado: ["Revisado", "ok"], observado: ["Observado", "crit"] };
export const TIPOS_MOV: Record<string, string> = { produccion: "Producción", venta: "Venta", compra: "Compra" };

export type Nav =
  | "tablero" | "equipos" | "ordenes" | "preventivos" | "reportes" | "informe" | "produccion" | "registros"
  | "listados" | "direccion" | "empresas" | "usuarios" | "registro";

export const ROLES: Record<Rol, { n: string; app: "gestion" | "operarios"; nav: Nav[] }> = {
  gm: { n: "Gerente de mantenimiento", app: "gestion", nav: ["tablero", "equipos", "ordenes", "preventivos", "reportes", "informe", "empresas", "usuarios", "registro"] },
  tec: { n: "Técnico", app: "gestion", nav: ["ordenes", "equipos", "preventivos"] },
  gp: { n: "Gerente de producción", app: "gestion", nav: ["produccion", "registros", "reportes", "informe", "empresas", "usuarios", "registro"] },
  adm: { n: "Administración", app: "gestion", nav: ["listados", "informe"] },
  dir: { n: "Dirección", app: "gestion", nav: ["direccion", "informe", "empresas", "usuarios", "registro"] },
  op: { n: "Operario", app: "operarios", nav: [] },
};

export const NAV: Record<Nav, [string, string]> = {
  tablero: ["Tablero", "▦"], equipos: ["Equipos", "⚙"], ordenes: ["Órdenes", "✎"], preventivos: ["Preventivos", "↻"], reportes: ["Reportes", "⚠"],
  informe: ["Informe semanal", "▤"], produccion: ["Tablero", "▦"], registros: ["Registros", "☰"], listados: ["Listados", "☰"], direccion: ["Resumen", "▦"],
  empresas: ["Empresas", "▣"], usuarios: ["Usuarios", "◉"], registro: ["Registro de cambios", "≡"],
};

// Lo que muestra la interfaz a cada perfil. Los permisos reales los aplica la base (RLS y funciones).
export type Permiso =
  | "eq.new" | "eq.edit" | "ot.create" | "ot.manage" | "prev.manage" | "prev.do" | "rep.manage" | "ficha" | "seed"
  | "emp.rename" | "users" | "audit" | "mov.review" | "export" | "rep.create" | "mov.create";
export const PERM: Record<Rol, Permiso[]> = {
  gm: ["eq.new", "eq.edit", "ot.create", "ot.manage", "prev.manage", "prev.do", "rep.manage", "ficha", "seed", "emp.rename", "users", "audit"],
  tec: ["eq.new", "ficha", "prev.do"],
  gp: ["mov.review", "emp.rename", "users", "audit"],
  adm: ["export"],
  dir: ["emp.rename", "users", "audit"],
  op: ["rep.create", "mov.create"],
};
/** Qué cuentas puede crear cada perfil (la base lo vuelve a controlar). */
export const CREA: Partial<Record<Rol, Rol[]>> = { dir: ["dir", "gm", "gp", "adm", "tec", "op"], gm: ["tec", "op"], gp: ["adm", "op"] };
/** Perfiles con código de acceso personal. */
export const CON_CODIGO: Rol[] = ["gm", "gp", "dir"];
export const AREA: Record<Rol, Area> = { gm: "mant", tec: "mant", gp: "prod", adm: "admin", dir: "dir", op: "op" };
export const AREA_N: Record<Area, string> = { mant: "Mantenimiento", prod: "Producción", admin: "Administración", dir: "Dirección", op: "Operarios" };

export const puede = (rol: Rol | null | undefined, p: Permiso) => !!rol && PERM[rol].includes(p);
