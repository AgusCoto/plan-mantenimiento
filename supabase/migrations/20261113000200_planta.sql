-- =====================================================================
-- Gestión de Planta · 2/6 · Equipos, órdenes, preventivos, reportes y movimientos
-- =====================================================================

-- ---------- Equipos ----------
-- Código: EMPRESA-ÁREA-TIPO-NÚMERO (ej. INY-PRO-INY-001). Lo genera alta_equipo()
-- y no cambia nunca, aunque el equipo se reubique en otra empresa o área.
create table if not exists public.equipos (
  codigo      text primary key check (codigo ~ '^[A-Z]{3}-[A-Z]{3}-[A-Z]{3}-[0-9]{3,}$'),
  empresa     text not null references public.empresas(sigla),
  area        text not null references public.areas(codigo),
  tipo        text not null references public.tipos_equipo(codigo),
  nombre      text not null check (length(btrim(nombre)) between 2 and 120),
  marca       text,
  modelo      text,
  ubicacion   text,
  notas       text,
  estado      text not null default 'operativo' check (estado in ('operativo','detenido','reparacion','baja')),
  alta        date not null default current_date,
  autorizo_id uuid references public.cuentas(id),
  ejemplo     boolean not null default false
);
select public._con_sellos('public.equipos');
create index if not exists equipos_empresa on public.equipos (empresa, estado);

-- Códigos anteriores (por ejemplo los de W-Main): los QR viejos siguen abriendo el equipo.
create table if not exists public.equipo_alias (
  alias  text primary key,
  equipo text not null references public.equipos(codigo) on delete cascade
);
create index if not exists equipo_alias_equipo on public.equipo_alias (equipo);

-- Historial del equipo: alta, reubicaciones, cambios de estado, bajas (lo escribe la base).
create table if not exists public.equipo_eventos (
  id      bigint generated always as identity primary key,
  equipo  text not null references public.equipos(codigo) on delete cascade,
  fecha   timestamptz not null default now(),
  texto   text not null,
  ejemplo boolean not null default false
);
select public._con_sellos('public.equipo_eventos');
create index if not exists equipo_eventos_equipo on public.equipo_eventos (equipo, fecha desc);

create table if not exists public.manuales (
  id      uuid primary key default gen_random_uuid(),
  equipo  text not null references public.equipos(codigo) on delete cascade,
  nombre  text not null,
  bucket  text,
  ruta    text,
  url     text,
  fecha   date not null default current_date,
  ejemplo boolean not null default false,
  check (ruta is not null or url is not null)
);
select public._con_sellos('public.manuales');
create index if not exists manuales_equipo on public.manuales (equipo);

-- ---------- Órdenes de trabajo ----------
-- El número lo asigna la base (el más alto + 1), sin saltos aunque un intento falle.
create table if not exists public.ordenes (
  id          uuid primary key default gen_random_uuid(),
  numero      int not null unique,
  equipo      text not null references public.equipos(codigo),
  titulo      text not null check (length(btrim(titulo)) between 2 and 200),
  descripcion text,
  tipo        text not null default 'correctiva' check (tipo in ('correctiva','preventiva')),
  prioridad   text not null default 'media' check (prioridad in ('alta','media','baja')),
  vence       date,
  asignado    text,
  estado      text not null default 'abierta' check (estado in ('abierta','curso','revisar','cerrada')),
  reporte_id  uuid,
  cerrada     timestamptz,
  cerrada_por uuid references public.cuentas(id),
  cerrada_por_nombre text,
  ejemplo     boolean not null default false
);
select public._con_sellos('public.ordenes');
create index if not exists ordenes_equipo on public.ordenes (equipo);
create index if not exists ordenes_estado on public.ordenes (estado, prioridad);

-- Fichas de trabajo de los técnicos (no se editan ni se borran: quedan como constancia)
create table if not exists public.fichas (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null references public.ordenes(id) on delete cascade,
  tecnico_id     uuid references public.cuentas(id) default auth.uid(),
  tecnico_nombre text,
  fecha          timestamptz not null default now(),
  trabajo        text not null check (length(btrim(trabajo)) >= 2),
  horas          numeric(7,2) not null default 0 check (horas >= 0 and horas <= 1000),
  parada         numeric(7,2) not null default 0 check (parada >= 0 and parada <= 1000),
  repuestos      text,
  resultado      text not null default 'pendiente' check (resultado in ('pendiente','terminado')),
  ejemplo        boolean not null default false
);
select public._con_sellos('public.fichas');
create index if not exists fichas_orden on public.fichas (orden_id, fecha);
create index if not exists fichas_fecha on public.fichas (fecha);

-- ---------- Preventivos ----------
create table if not exists public.preventivos (
  id          uuid primary key default gen_random_uuid(),
  equipo      text not null references public.equipos(codigo) on delete cascade,
  tarea       text not null check (length(btrim(tarea)) >= 2),
  frecuencia  int  not null check (frecuencia between 1 and 3650),
  ultima      date,
  responsable text,
  ejemplo     boolean not null default false
);
select public._con_sellos('public.preventivos');
create index if not exists preventivos_equipo on public.preventivos (equipo);

create table if not exists public.preventivo_ejecuciones (
  id             uuid primary key default gen_random_uuid(),
  preventivo_id  uuid not null references public.preventivos(id) on delete cascade,
  fecha          timestamptz not null default now(),
  tecnico_id     uuid references public.cuentas(id) default auth.uid(),
  tecnico_nombre text,
  horas          numeric(7,2) not null default 0 check (horas >= 0 and horas <= 1000),
  obs            text,
  ejemplo        boolean not null default false
);
select public._con_sellos('public.preventivo_ejecuciones');
create index if not exists prev_ejec_prev on public.preventivo_ejecuciones (preventivo_id, fecha);
create index if not exists prev_ejec_fecha on public.preventivo_ejecuciones (fecha);

-- ---------- Reportes de operarios ----------
create table if not exists public.reportes (
  id              uuid primary key default gen_random_uuid(),
  equipo          text not null references public.equipos(codigo),
  tipo            text not null,
  detenida        boolean not null default false,
  descripcion     text not null check (length(btrim(descripcion)) >= 2),
  operario_id     uuid references public.cuentas(id) default auth.uid(),
  operario_nombre text,
  empresa         text references public.empresas(sigla),
  estado          text not null default 'nuevo' check (estado in ('nuevo','analisis','ot','descartado')),
  nota            text,
  orden_id        uuid references public.ordenes(id) on delete set null,
  ts              timestamptz not null default now(),
  ejemplo         boolean not null default false
);
select public._con_sellos('public.reportes');
create index if not exists reportes_estado on public.reportes (estado, ts desc);
create index if not exists reportes_equipo on public.reportes (equipo);
create index if not exists reportes_operario on public.reportes (operario_id);
do $$ begin
  alter table public.ordenes add constraint ordenes_reporte_fk foreign key (reporte_id) references public.reportes(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Fotos y videos de los reportes (los archivos están en Storage, bucket "reportes")
create table if not exists public.adjuntos (
  id         uuid primary key default gen_random_uuid(),
  reporte_id uuid not null references public.reportes(id) on delete cascade,
  bucket     text not null default 'reportes',
  ruta       text not null,
  tipo       text not null check (tipo in ('foto','video')),
  mime       text,
  bytes      bigint,
  ejemplo    boolean not null default false
);
select public._con_sellos('public.adjuntos');
create index if not exists adjuntos_reporte on public.adjuntos (reporte_id);

-- ---------- Producción, ventas y compras cargadas por los operarios ----------
create table if not exists public.movimientos (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null check (tipo in ('produccion','venta','compra')),
  empresa         text not null references public.empresas(sigla),
  fecha           date not null default current_date,
  producto        text not null check (length(btrim(producto)) >= 1),
  cantidad        numeric(14,3) not null default 0 check (cantidad >= 0),
  monto           numeric(16,2) check (monto is null or monto >= 0),
  contraparte     text,
  turno           text,
  equipo          text references public.equipos(codigo),
  destino         text,
  obs             text,
  estado          text not null default 'pendiente' check (estado in ('pendiente','revisado','observado')),
  nota            text,
  revisor_id      uuid references public.cuentas(id),
  operario_id     uuid references public.cuentas(id) default auth.uid(),
  operario_nombre text,
  ts              timestamptz not null default now(),
  ejemplo         boolean not null default false
);
select public._con_sellos('public.movimientos');
create index if not exists movimientos_fecha on public.movimientos (fecha desc, tipo);
create index if not exists movimientos_estado on public.movimientos (estado);
create index if not exists movimientos_operario on public.movimientos (operario_id);
