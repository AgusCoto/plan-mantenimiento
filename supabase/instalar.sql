-- =====================================================================
-- Gestión de Planta · INSTALACIÓN / ACTUALIZACIÓN COMPLETA
-- Pegá todo este archivo en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin perder datos. Si el proyecto tenía W-Main, al final
-- migra sus datos (una sola vez) y muestra el resumen.
-- Generado con "npm run sql" a partir de supabase/migrations (no editar a mano).
-- =====================================================================

-- >>>>>>>>>> 20261113000100_base.sql
-- =====================================================================
-- Gestión de Planta · 1/6 · Base: catálogos, cuentas, sellos y roles
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- Sellos: quién y cuándo creó y modificó cada registro ----------
-- Los completa la base (no la app). Si el cambio lo hace el sistema (migraciones,
-- panel de Supabase) se respetan los valores que vengan.
create or replace function public.sellar() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.creado_por := auth.uid();
      new.creado := now();
    end if;
    new.creado := coalesce(new.creado, now());
    new.modificado_por := coalesce(auth.uid(), new.modificado_por, new.creado_por);
    new.modificado := case when auth.uid() is not null then now() else coalesce(new.modificado, new.creado) end;
  else
    new.creado_por := old.creado_por;
    new.creado := old.creado;
    new.modificado_por := coalesce(auth.uid(), new.modificado_por);
    new.modificado := now();
  end if;
  return new;
end $$;

-- Agrega las cuatro columnas de sellos y su trigger a una tabla.
create or replace function public._con_sellos(t regclass) returns void
language plpgsql as $$
begin
  execute format('alter table %s add column if not exists creado_por uuid references auth.users(id) on delete set null,
                  add column if not exists creado timestamptz not null default now(),
                  add column if not exists modificado_por uuid references auth.users(id) on delete set null,
                  add column if not exists modificado timestamptz not null default now()', t);
  execute format('drop trigger if exists a_sellar on %s', t);
  execute format('create trigger a_sellar before insert or update on %s for each row execute function public.sellar()', t);
end $$;

-- ---------- Empresas del grupo (la sigla no cambia: es parte del código de cada equipo) ----------
create table if not exists public.empresas (
  sigla  text primary key check (sigla in ('INY','LIM','PIN','SAL')),
  nombre text not null check (length(btrim(nombre)) between 2 and 60),
  orden  int  not null default 0
);
select public._con_sellos('public.empresas');

create table if not exists public.areas (
  codigo text primary key check (codigo ~ '^[A-Z]{3}$'),
  nombre text not null,
  orden  int  not null default 0
);
create table if not exists public.tipos_equipo (
  codigo text primary key check (codigo ~ '^[A-Z]{3}$'),
  nombre text not null,
  orden  int  not null default 0
);
create table if not exists public.productos (
  id      bigint generated always as identity primary key,
  empresa text not null references public.empresas(sigla),
  nombre  text not null,
  orden   int  not null default 0,
  activo  boolean not null default true,
  unique (empresa, nombre)
);
select public._con_sellos('public.productos');

-- Parámetros (límites de archivos, dirección pública para los QR)
create table if not exists public.config (
  clave text primary key,
  valor jsonb not null
);
select public._con_sellos('public.config');

insert into public.empresas (sigla, nombre, orden) values
  ('INY','Inyectora de plásticos',1), ('LIM','Productos de limpieza',2), ('PIN','Pinturas',3), ('SAL','Salsas y aderezos',4)
on conflict (sigla) do nothing;

insert into public.areas (codigo, nombre, orden) values
  ('PRO','Producción',1), ('SER','Servicios',2), ('LOG','Logística',3), ('MAN','Mantenimiento',4), ('ALM','Almacén',5)
on conflict (codigo) do nothing;

insert into public.tipos_equipo (codigo, nombre, orden) values
  ('INY','Inyectora',1), ('SOP','Sopladora',2), ('COM','Compresor',3), ('CHI','Chiller',4), ('MOL','Molino',5),
  ('MEZ','Mezclador',6), ('ENV','Envasadora',7), ('ETQ','Etiquetadora',8), ('BOM','Bomba',9), ('DIS','Dispersora',10),
  ('APL','Apilador',11), ('CAL','Caldera',12), ('TAB','Tablero eléctrico',13), ('OTR','Otro',99)
on conflict (codigo) do nothing;

insert into public.productos (empresa, nombre, orden) values
  ('INY','Bidón 5 L',1), ('INY','Bidón 10 L',2), ('INY','Botella 1 L',3), ('INY','Botella 500 ml',4),
  ('LIM','Lavandina 1 L',1), ('LIM','Detergente 750 ml',2), ('LIM','Limpiador de pisos 900 ml',3), ('LIM','Desengrasante 500 ml',4),
  ('PIN','Látex interior 20 L',1), ('PIN','Látex exterior 10 L',2), ('PIN','Esmalte sintético 1 L',3), ('PIN','Membrana líquida 20 kg',4),
  ('SAL','Mayonesa 250 g',1), ('SAL','Ketchup 500 g',2), ('SAL','Mostaza 250 g',3), ('SAL','Salsa golf 250 g',4)
on conflict (empresa, nombre) do nothing;

insert into public.config (clave, valor) values
  ('limite_video_mb', '50'), ('limite_foto_mb', '15'), ('limite_pdf_mb', '20'), ('url_publica', '""')
on conflict (clave) do nothing;

-- ---------- Cuentas ----------
-- gm: gerente de mantenimiento · tec: técnico · gp: gerente de producción
-- adm: administración · dir: dirección · op: operario
-- Las cuentas no se borran: se desactivan (activo = false) y conservan su historial.
create table if not exists public.cuentas (
  id      uuid primary key references auth.users(id) on delete restrict,
  usuario text not null unique check (usuario ~ '^[a-z0-9._-]{3,30}$'),
  nombre  text not null check (length(btrim(nombre)) between 2 and 80),
  rol     text not null check (rol in ('gm','tec','gp','adm','dir','op')),
  empresa text references public.empresas(sigla),
  activo  boolean not null default true,
  ejemplo boolean not null default false,
  email_anterior text,
  check (rol <> 'op' or empresa is not null)
);
select public._con_sellos('public.cuentas');

-- Códigos de acceso personales (gerentes y dirección). Nadie los puede leer:
-- solo las funciones del servidor comparan contra el hash.
create table if not exists public.codigos_acceso (
  cuenta_id   uuid primary key references public.cuentas(id) on delete cascade,
  hash        text not null,
  actualizado timestamptz not null default now()
);
create table if not exists public.intentos_codigo (
  id        bigint generated always as identity primary key,
  cuenta_id uuid,
  ts        timestamptz not null default now(),
  ok        boolean not null
);
create index if not exists intentos_codigo_cuenta_ts on public.intentos_codigo (cuenta_id, ts);

-- ---------- Rol de quien está conectado ----------
create or replace function public.rol_actual() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.cuentas where id = auth.uid() and activo
$$;
create or replace function public.tiene_rol(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol from public.cuentas where id = auth.uid() and activo) = any(roles), false)
$$;
create or replace function public.es_gestion() returns boolean
language sql stable security definer set search_path = public as $$
  select public.tiene_rol('gm','tec','gp','adm','dir')
$$;


-- >>>>>>>>>> 20261113000200_planta.sql
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


-- >>>>>>>>>> 20261113000300_reglas_y_permisos.sql
-- =====================================================================
-- Gestión de Planta · 3/6 · Reglas de negocio (triggers) y permisos por rol (RLS)
-- Los permisos se cumplen acá, en la base: ocultar un botón en la app no alcanza.
-- =====================================================================

-- true si entre a y b solo cambiaron las columnas permitidas (y los sellos)
create or replace function public._solo_cambian(a jsonb, b jsonb, permitidas text[]) returns boolean
language sql immutable as $$
  select not exists (
    select 1 from jsonb_each(a) x
    where not (x.key = any(permitidas || array['creado_por','creado','modificado_por','modificado']))
      and (b -> x.key) is distinct from x.value)
$$;

create or replace function public._nombre_cuenta(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select nombre from public.cuentas where id = u
$$;

-- ---------- Autoría: quien carga una ficha, un reporte o un movimiento es quien está conectado ----------
create or replace function public.autoria_tecnico() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.tecnico_id := auth.uid(); end if;
  new.tecnico_nombre := coalesce(public._nombre_cuenta(new.tecnico_id), new.tecnico_nombre);
  return new;
end $$;
drop trigger if exists b_autoria on public.fichas;
create trigger b_autoria before insert on public.fichas for each row execute function public.autoria_tecnico();
drop trigger if exists b_autoria on public.preventivo_ejecuciones;
create trigger b_autoria before insert on public.preventivo_ejecuciones for each row execute function public.autoria_tecnico();

create or replace function public.autoria_operario() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.cuentas;
begin
  if auth.uid() is not null then
    new.operario_id := auth.uid();
    select * into c from public.cuentas where id = auth.uid();
    new.operario_nombre := c.nombre;
    new.ts := now();
    if tg_table_name = 'reportes' then
      new.empresa := coalesce(c.empresa, new.empresa);
      new.estado := 'nuevo'; new.nota := null; new.orden_id := null;
    else
      new.estado := 'pendiente'; new.nota := null; new.revisor_id := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists b_autoria on public.reportes;
create trigger b_autoria before insert on public.reportes for each row execute function public.autoria_operario();
drop trigger if exists b_autoria on public.movimientos;
create trigger b_autoria before insert on public.movimientos for each row execute function public.autoria_operario();

-- Producción revisa u observa: solo cambia estado, nota y revisor (queda a su nombre)
create or replace function public.revision_movimiento() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not public._solo_cambian(to_jsonb(old), to_jsonb(new), array['estado','nota','revisor_id']) then
    raise exception 'Solo se puede revisar u observar el registro; los datos los carga el operario.' using errcode = '42501';
  end if;
  new.revisor_id := auth.uid();
  return new;
end $$;
drop trigger if exists b_revision on public.movimientos;
create trigger b_revision before update on public.movimientos for each row execute function public.revision_movimiento();

-- ---------- Órdenes ----------
create or replace function public.reglas_orden() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('ordenes.numero'));
    if auth.uid() is not null or new.numero is null then
      select coalesce(max(numero), 0) + 1 into new.numero from public.ordenes;
    end if;
  elsif new.numero is distinct from old.numero then
    raise exception 'El número de la orden no se puede cambiar.' using errcode = '42501';
  end if;
  if new.estado = 'cerrada' and (tg_op = 'INSERT' or old.estado <> 'cerrada') then
    new.cerrada := case when auth.uid() is null and new.cerrada is not null then new.cerrada else now() end;
    new.cerrada_por := coalesce(auth.uid(), new.cerrada_por);
    new.cerrada_por_nombre := coalesce(public._nombre_cuenta(auth.uid()), new.cerrada_por_nombre);
  elsif new.estado <> 'cerrada' then
    new.cerrada := null; new.cerrada_por := null; new.cerrada_por_nombre := null;
  elsif tg_op = 'UPDATE' then
    new.cerrada := old.cerrada; new.cerrada_por := old.cerrada_por; new.cerrada_por_nombre := old.cerrada_por_nombre;
  end if;
  return new;
end $$;
drop trigger if exists b_reglas on public.ordenes;
create trigger b_reglas before insert or update on public.ordenes for each row execute function public.reglas_orden();

-- Una OT creada desde un reporte deja el reporte como "OT generada"
create or replace function public.orden_desde_reporte() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reporte_id is not null then
    update public.reportes set estado = 'ot', orden_id = new.id where id = new.reporte_id;
  end if;
  return new;
end $$;
drop trigger if exists c_desde_reporte on public.ordenes;
create trigger c_desde_reporte after insert on public.ordenes for each row execute function public.orden_desde_reporte();

-- La ficha del técnico mueve la orden: "En curso" o, si terminó, "Para revisar"
create or replace function public.ficha_mueve_orden() returns trigger
language plpgsql security definer set search_path = public as $$
declare est text;
begin
  if auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' then return new; end if;
  select estado into est from public.ordenes where id = new.orden_id for update;
  if est = 'cerrada' then
    raise exception 'La orden está cerrada: pedile al gerente que la reabra.' using errcode = '42501';
  end if;
  update public.ordenes set estado = case when new.resultado = 'terminado' then 'revisar' else 'curso' end where id = new.orden_id;
  return new;
end $$;
drop trigger if exists c_mueve_orden on public.fichas;
create trigger c_mueve_orden after insert on public.fichas for each row execute function public.ficha_mueve_orden();

-- Registrar un preventivo actualiza la última realización
create or replace function public.ejecucion_actualiza_preventivo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.preventivos set ultima = greatest(coalesce(ultima, (new.fecha)::date), (new.fecha)::date) where id = new.preventivo_id;
  return new;
end $$;
drop trigger if exists c_actualiza on public.preventivo_ejecuciones;
create trigger c_actualiza after insert on public.preventivo_ejecuciones for each row execute function public.ejecucion_actualiza_preventivo();

-- ---------- Equipos: el código no cambia; los movimientos quedan en su historial ----------
create or replace function public.reglas_equipo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.codigo is distinct from old.codigo then
    raise exception 'El código del equipo no se puede cambiar (la etiqueta QR depende de él).' using errcode = '42501';
  end if;
  if auth.uid() is not null and (new.alta is distinct from old.alta or new.autorizo_id is distinct from old.autorizo_id) then
    raise exception 'La fecha de alta y quién la autorizó no se pueden cambiar.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists b_reglas on public.equipos;
create trigger b_reglas before update on public.equipos for each row execute function public.reglas_equipo();

create or replace function public.historial_equipo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  quien text := coalesce(public._nombre_cuenta(auth.uid()), 'Sistema');
  motivo text := nullif(current_setting('planta.motivo', true), '');
  e_ant text; e_nue text;
begin
  if tg_op = 'INSERT' then
    insert into public.equipo_eventos (equipo, texto, ejemplo) values (new.codigo,
      'Alta del equipo · ' || quien || coalesce(' (autorizó ' || public._nombre_cuenta(new.autorizo_id) || ')', ''), new.ejemplo);
    return new;
  end if;
  if (new.empresa, new.area, coalesce(new.ubicacion,'')) is distinct from (old.empresa, old.area, coalesce(old.ubicacion,'')) then
    select nombre into e_ant from public.empresas where sigla = old.empresa;
    select nombre into e_nue from public.empresas where sigla = new.empresa;
    insert into public.equipo_eventos (equipo, texto, ejemplo) values (new.codigo,
      'Reubicado de ' || e_ant || ' / ' || coalesce(nullif(old.ubicacion,''),'—') || ' a ' || e_nue || ' / ' || coalesce(nullif(new.ubicacion,''),'—')
      || coalesce(' (' || motivo || ')', '') || ' · ' || quien, new.ejemplo);
  end if;
  if new.estado is distinct from old.estado then
    insert into public.equipo_eventos (equipo, texto, ejemplo) values (new.codigo,
      case new.estado when 'baja' then 'Baja' when 'operativo' then case when old.estado = 'baja' then 'Equipo reactivado' else 'Operativo' end
        when 'detenido' then 'Detenido' else 'En reparación' end
      || coalesce(': ' || motivo, '') || ' · ' || quien, new.ejemplo);
  end if;
  return new;
end $$;
drop trigger if exists c_historial on public.equipos;
create trigger c_historial after insert or update on public.equipos for each row execute function public.historial_equipo();

-- Reubicar y cambiar de estado con motivo (los permisos los controla RLS: solo el gerente de mantenimiento)
create or replace function public.reubicar_equipo(p_codigo text, p_empresa text, p_area text, p_ubicacion text, p_motivo text default null)
returns void language plpgsql set search_path = public as $$
begin
  perform set_config('planta.motivo', coalesce(p_motivo, ''), true);
  update public.equipos set empresa = p_empresa, area = p_area, ubicacion = nullif(btrim(p_ubicacion), '') where codigo = p_codigo;
  if not found then raise exception 'No tenés permiso para reubicar este equipo, o no existe.' using errcode = '42501'; end if;
end $$;

create or replace function public.estado_equipo(p_codigo text, p_estado text, p_motivo text default null)
returns void language plpgsql set search_path = public as $$
begin
  if p_estado = 'baja' and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indicá el motivo de la baja.';
  end if;
  perform set_config('planta.motivo', coalesce(p_motivo, ''), true);
  update public.equipos set estado = p_estado where codigo = p_codigo;
  if not found then raise exception 'No tenés permiso para cambiar el estado de este equipo, o no existe.' using errcode = '42501'; end if;
end $$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.empresas               enable row level security;
alter table public.areas                  enable row level security;
alter table public.tipos_equipo           enable row level security;
alter table public.productos              enable row level security;
alter table public.config                 enable row level security;
alter table public.cuentas                enable row level security;
alter table public.codigos_acceso         enable row level security;  -- sin políticas: nadie la lee
alter table public.intentos_codigo        enable row level security;  -- sin políticas
alter table public.equipos                enable row level security;
alter table public.equipo_alias           enable row level security;
alter table public.equipo_eventos         enable row level security;
alter table public.manuales               enable row level security;
alter table public.ordenes                enable row level security;
alter table public.fichas                 enable row level security;
alter table public.preventivos            enable row level security;
alter table public.preventivo_ejecuciones enable row level security;
alter table public.reportes               enable row level security;
alter table public.adjuntos               enable row level security;
alter table public.movimientos            enable row level security;

-- Vuelve a crear una política (para poder ejecutar el archivo más de una vez)
create or replace function public._politica(nombre text, tabla text, cmd text, usando text, chequeo text default null) returns void
language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', nombre, tabla);
  execute format('create policy %I on public.%I for %s to authenticated %s %s', nombre, tabla, cmd,
    case when usando is null then '' else 'using (' || usando || ')' end,
    case when chequeo is null then '' else 'with check (' || chequeo || ')' end);
end $$;

-- Catálogos: los ve cualquier cuenta activa. Cambiar el nombre de una empresa: renombrar_empresa() con código.
select public._politica('ver', 'empresas',     'select', 'public.rol_actual() is not null');
select public._politica('ver', 'areas',        'select', 'public.rol_actual() is not null');
select public._politica('ver', 'tipos_equipo', 'select', 'public.rol_actual() is not null');
select public._politica('ver', 'productos',    'select', 'public.rol_actual() is not null');
select public._politica('ver', 'config',       'select', 'public.rol_actual() is not null');

-- Cuentas: gestión ve todas; el operario solo la suya. Altas y cambios: funciones de cuentas.
select public._politica('ver', 'cuentas', 'select', 'public.es_gestion() or id = auth.uid()');

-- Equipos: los ven todos (el operario elige la máquina). Alta: alta_equipo() con código. Cambios: gerente de mantenimiento.
select public._politica('ver',       'equipos', 'select', 'public.rol_actual() is not null');
select public._politica('modificar', 'equipos', 'update', 'public.tiene_rol(''gm'')', 'public.tiene_rol(''gm'')');
select public._politica('ver', 'equipo_alias',   'select', 'public.rol_actual() is not null');
select public._politica('ver', 'equipo_eventos', 'select', 'public.es_gestion()');

select public._politica('ver',    'manuales', 'select', 'public.es_gestion()');
select public._politica('cargar', 'manuales', 'insert', null, 'public.tiene_rol(''gm'')');
select public._politica('quitar', 'manuales', 'delete', 'public.tiene_rol(''gm'')');

-- Órdenes: las ve toda la gestión; las crea y administra el gerente de mantenimiento.
select public._politica('ver',       'ordenes', 'select', 'public.es_gestion()');
select public._politica('crear',     'ordenes', 'insert', null, 'public.tiene_rol(''gm'')');
select public._politica('modificar', 'ordenes', 'update', 'public.tiene_rol(''gm'')', 'public.tiene_rol(''gm'')');

-- Fichas: las cargan técnicos y gerente de mantenimiento, siempre a su nombre. No se editan ni se borran.
select public._politica('ver',    'fichas', 'select', 'public.es_gestion()');
select public._politica('cargar', 'fichas', 'insert', null, 'public.tiene_rol(''gm'',''tec'') and tecnico_id = auth.uid()');

-- Preventivos: los programa el gerente de mantenimiento; los registran técnicos y gerente.
select public._politica('ver',       'preventivos', 'select', 'public.es_gestion()');
select public._politica('crear',     'preventivos', 'insert', null, 'public.tiene_rol(''gm'')');
select public._politica('modificar', 'preventivos', 'update', 'public.tiene_rol(''gm'')', 'public.tiene_rol(''gm'')');
select public._politica('quitar',    'preventivos', 'delete', 'public.tiene_rol(''gm'')');
select public._politica('ver',       'preventivo_ejecuciones', 'select', 'public.es_gestion()');
select public._politica('registrar', 'preventivo_ejecuciones', 'insert', null, 'public.tiene_rol(''gm'',''tec'') and tecnico_id = auth.uid()');

-- Reportes: los crea el operario (a su nombre) y ve los suyos; gestión los ve; el gerente de mantenimiento los atiende.
select public._politica('ver',       'reportes', 'select', 'public.es_gestion() or operario_id = auth.uid()');
select public._politica('crear',     'reportes', 'insert', null, 'public.tiene_rol(''op'') and operario_id = auth.uid()');
select public._politica('modificar', 'reportes', 'update', 'public.tiene_rol(''gm'')', 'public.tiene_rol(''gm'')');
select public._politica('ver',   'adjuntos', 'select', 'public.es_gestion() or exists (select 1 from public.reportes r where r.id = reporte_id and r.operario_id = auth.uid())');
select public._politica('crear', 'adjuntos', 'insert', null,
  'public.tiene_rol(''op'') and exists (select 1 from public.reportes r where r.id = reporte_id and r.operario_id = auth.uid() and r.creado > now() - interval ''1 day'') and split_part(ruta, ''/'', 1) = auth.uid()::text');

-- Movimientos: los carga el operario y ve los suyos; los ven mantenimiento, producción, administración y dirección;
-- solo producción los revisa u observa.
select public._politica('ver',     'movimientos', 'select', 'public.tiene_rol(''gm'',''gp'',''adm'',''dir'') or operario_id = auth.uid()');
select public._politica('crear',   'movimientos', 'insert', null, 'public.tiene_rol(''op'') and operario_id = auth.uid()');
select public._politica('revisar', 'movimientos', 'update', 'public.tiene_rol(''gp'')', 'public.tiene_rol(''gp'')');

grant execute on function public.reubicar_equipo(text, text, text, text, text) to authenticated;
grant execute on function public.estado_equipo(text, text, text) to authenticated;
revoke execute on function public._politica(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public._con_sellos(regclass) from public, anon, authenticated;


-- >>>>>>>>>> 20261113000400_codigos_y_cuentas.sql
-- =====================================================================
-- Gestión de Planta · 4/6 · Códigos de acceso y administración de cuentas
-- Todo se verifica acá, del lado del servidor. El navegador nunca ve los hashes.
-- =====================================================================

-- Los ingresos usan "usuario"; Supabase Auth necesita un email, así que cada usuario
-- se guarda como usuario@cuentas.gestion-planta.app (nunca se le envían correos).
create or replace function public._email_de(usuario text) returns text
language sql immutable as $$ select lower(usuario) || '@cuentas.gestion-planta.app' $$;

-- Deja asentado quién autorizó con su código la operación en curso (lo lee la auditoría).
create or replace function public._autoriza(cuenta uuid) returns void
language sql as $$ select set_config('planta.autorizo_id', coalesce(cuenta::text, ''), true) $$;

-- Freno a la prueba de códigos: 5 intentos fallidos en 10 minutos bloquean a quien los hace.
create or replace function public._codigo_bloqueado() returns boolean
language sql stable security definer set search_path = public as $$
  select count(*) >= 5 from public.intentos_codigo where cuenta_id = auth.uid() and not ok and ts > now() - interval '10 minutes'
$$;
create or replace function public._anotar_intento(ok boolean) returns void
language sql security definer set search_path = public as $$
  insert into public.intentos_codigo (cuenta_id, ok) values (auth.uid(), ok);
  delete from public.intentos_codigo where ts < now() - interval '2 days';
$$;
create or replace function public._hash_codigo(codigo text) returns text
language plpgsql set search_path = public, extensions as $$
begin
  if codigo is null or codigo !~ '^[0-9]{4,6}$' then
    raise exception 'El código de acceso tiene que tener de 4 a 6 números.';
  end if;
  return extensions.crypt(codigo, extensions.gen_salt('bf', 8));
end $$;
create or replace function public._codigo_es(cuenta uuid, codigo text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.codigos_acceso c join public.cuentas u on u.id = c.cuenta_id
                 where c.cuenta_id = cuenta and u.activo and extensions.crypt(coalesce(codigo,''), c.hash) = c.hash)
$$;

-- Las funciones con código devuelven {ok:false, error} en vez de cortar con un error,
-- así el intento fallido queda anotado (un error desharía la anotación).
create or replace function public._falla(msg text) returns jsonb
language sql as $$ select jsonb_build_object('ok', false, 'error', msg) $$;

-- ---------- Cambiar el nombre de una empresa (gerentes o dirección, con su propio código) ----------
create or replace function public.renombrar_empresa(p_sigla text, p_nombre text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_nombre, ''));
begin
  if not public.tiene_rol('gm','gp','dir') then
    raise exception 'Solo los gerentes y dirección pueden cambiar el nombre de una empresa.' using errcode = '42501';
  end if;
  if public._codigo_bloqueado() then return public._falla('Demasiados intentos con códigos incorrectos. Esperá 10 minutos.'); end if;
  if not public._codigo_es(auth.uid(), p_codigo) then
    perform public._anotar_intento(false);
    return public._falla('El código de acceso no es correcto.');
  end if;
  perform public._anotar_intento(true);
  if length(n) < 2 or length(n) > 60 then return public._falla('Escribí un nombre de 2 a 60 letras.'); end if;
  perform public._autoriza(auth.uid());
  update public.empresas set nombre = n where sigla = p_sigla;
  if not found then return public._falla('No existe esa empresa.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Alta de equipo: gerente de mantenimiento o técnico, siempre con el código de un gerente de mantenimiento ----------
create or replace function public.alta_equipo(
  p_empresa text, p_area text, p_tipo text, p_nombre text, p_marca text, p_modelo text,
  p_ubicacion text, p_notas text, p_codigo_gm text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  gm uuid; pref text; n int; cod text;
begin
  if not public.tiene_rol('gm','tec') then
    raise exception 'Solo el gerente de mantenimiento o un técnico pueden dar de alta equipos.' using errcode = '42501';
  end if;
  if public._codigo_bloqueado() then return public._falla('Demasiados intentos con códigos incorrectos. Esperá 10 minutos.'); end if;
  select c.cuenta_id into gm from public.codigos_acceso c join public.cuentas u on u.id = c.cuenta_id
    where u.rol = 'gm' and u.activo and extensions.crypt(coalesce(p_codigo_gm,''), c.hash) = c.hash limit 1;
  if gm is null then
    perform public._anotar_intento(false);
    return public._falla('El código no corresponde a ningún gerente de mantenimiento.');
  end if;
  perform public._anotar_intento(true);
  if length(btrim(coalesce(p_nombre,''))) < 2 then return public._falla('Escribí el nombre del equipo.'); end if;
  pref := p_empresa || '-' || p_area || '-' || p_tipo || '-';
  perform pg_advisory_xact_lock(hashtext('alta_equipo:' || pref));
  select coalesce(max(substr(codigo, length(pref) + 1)::int), 0) + 1 into n
    from public.equipos where codigo like pref || '%' and substr(codigo, length(pref) + 1) ~ '^[0-9]+$';
  cod := pref || lpad(n::text, 3, '0');
  perform public._autoriza(gm);
  insert into public.equipos (codigo, empresa, area, tipo, nombre, marca, modelo, ubicacion, notas, autorizo_id)
  values (cod, p_empresa, p_area, p_tipo, btrim(p_nombre), nullif(btrim(p_marca),''), nullif(btrim(p_modelo),''),
          nullif(btrim(p_ubicacion),''), nullif(btrim(p_notas),''), gm);
  return jsonb_build_object('ok', true, 'codigo', cod, 'autorizo', public._nombre_cuenta(gm));
end $$;

-- ---------- Cuentas ----------
-- Quién puede crear (y administrar) cada perfil.
create or replace function public._puede_administrar(rol_destino text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.rol_actual()
    when 'dir' then rol_destino in ('dir','gm','gp','adm','tec','op')
    when 'gm'  then rol_destino in ('tec','op')
    when 'gp'  then rol_destino in ('adm','op')
    else false end
$$;

-- Crea el usuario de Supabase Auth (ya confirmado: no se envían correos).
create or replace function public._crear_usuario_auth(p_id uuid, p_email text, p_clave text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if length(coalesce(p_clave,'')) < 8 then raise exception 'La contraseña tiene que tener al menos 8 caracteres.'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id::text, p_id,
          jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());
end $$;

create or replace function public._crear_cuenta(p_usuario text, p_nombre text, p_rol text, p_empresa text, p_clave text, p_codigo text, p_ejemplo boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  u text := lower(btrim(coalesce(p_usuario,'')));
  nid uuid := gen_random_uuid();
begin
  if u !~ '^[a-z0-9._-]{3,30}$' then raise exception 'El usuario tiene que tener de 3 a 30 letras minúsculas, números, punto o guion.'; end if;
  if exists (select 1 from public.cuentas where usuario = u) or exists (select 1 from auth.users where email = public._email_de(u)) then
    raise exception 'Ese usuario ya existe.';
  end if;
  if length(btrim(coalesce(p_nombre,''))) < 2 then raise exception 'Escribí el nombre y apellido.'; end if;
  if p_rol not in ('gm','tec','gp','adm','dir','op') then raise exception 'Perfil desconocido.'; end if;
  if p_rol = 'op' and p_empresa is null then raise exception 'Elegí la empresa del operario.'; end if;
  perform public._crear_usuario_auth(nid, public._email_de(u), p_clave);
  insert into public.cuentas (id, usuario, nombre, rol, empresa, ejemplo)
  values (nid, u, btrim(p_nombre), p_rol, case when p_rol = 'op' then p_empresa end, p_ejemplo);
  if p_rol in ('gm','gp','dir') then
    insert into public.codigos_acceso (cuenta_id, hash) values (nid, public._hash_codigo(p_codigo));
  end if;
  return nid;
end $$;

create or replace function public.crear_cuenta(p_usuario text, p_nombre text, p_rol text, p_empresa text, p_clave text, p_codigo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public._puede_administrar(p_rol) then
    raise exception 'No podés crear cuentas con ese perfil.' using errcode = '42501';
  end if;
  return public._crear_cuenta(p_usuario, p_nombre, p_rol, p_empresa, p_clave, p_codigo);
end $$;

-- Nueva contraseña (y código, para gerentes y dirección) puesta por quien administra esa cuenta.
create or replace function public.restablecer_clave(p_cuenta uuid, p_clave text, p_codigo text default null)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
declare r text;
begin
  select rol into r from public.cuentas where id = p_cuenta;
  if r is null or p_cuenta = auth.uid() or not public._puede_administrar(r) then
    raise exception 'No podés cambiar la contraseña de esa cuenta.' using errcode = '42501';
  end if;
  if length(coalesce(p_clave,'')) < 8 then raise exception 'La contraseña tiene que tener al menos 8 caracteres.'; end if;
  if r in ('gm','gp','dir') then
    if p_codigo is null then raise exception 'Al cambiar la contraseña de un gerente o de dirección hay que darle también un código nuevo.'; end if;
    insert into public.codigos_acceso (cuenta_id, hash) values (p_cuenta, public._hash_codigo(p_codigo))
      on conflict (cuenta_id) do update set hash = excluded.hash, actualizado = now();
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), updated_at = now() where id = p_cuenta;
  delete from auth.sessions where user_id = p_cuenta;
  update public.cuentas set modificado = now() where id = p_cuenta;  -- deja constancia en la auditoría
end $$;

-- Desactivar o reactivar (las cuentas no se borran). Al desactivar se cierran sus sesiones.
create or replace function public.cambiar_estado_cuenta(p_cuenta uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
declare r text;
begin
  select rol into r from public.cuentas where id = p_cuenta;
  if r is null or p_cuenta = auth.uid() or not public._puede_administrar(r) then
    raise exception 'No podés cambiar el estado de esa cuenta.' using errcode = '42501';
  end if;
  update public.cuentas set activo = p_activo where id = p_cuenta;
  update auth.users set banned_until = case when p_activo then null else '2999-12-31'::timestamptz end where id = p_cuenta;
  if not p_activo then delete from auth.sessions where user_id = p_cuenta; end if;
end $$;

-- Mi cuenta: cambiar la propia contraseña y/o el código, confirmando la contraseña actual.
create or replace function public.cambiar_mis_datos(p_actual text, p_clave text default null, p_codigo text default null)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
declare r text;
begin
  r := public.rol_actual();
  if r is null then raise exception 'Tu cuenta no está activa.' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and encrypted_password = extensions.crypt(coalesce(p_actual,''), encrypted_password)) then
    raise exception 'La contraseña actual no es correcta.';
  end if;
  if coalesce(p_clave,'') = '' and coalesce(p_codigo,'') = '' then raise exception 'No cambiaste nada.'; end if;
  if coalesce(p_clave,'') <> '' then
    if length(p_clave) < 8 then raise exception 'La contraseña nueva tiene que tener al menos 8 caracteres.'; end if;
    update auth.users set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), updated_at = now() where id = auth.uid();
  end if;
  if coalesce(p_codigo,'') <> '' then
    if r not in ('gm','gp','dir') then raise exception 'Tu perfil no usa código de acceso.'; end if;
    insert into public.codigos_acceso (cuenta_id, hash) values (auth.uid(), public._hash_codigo(p_codigo))
      on conflict (cuenta_id) do update set hash = excluded.hash, actualizado = now();
  end if;
  update public.cuentas set modificado = now() where id = auth.uid();
end $$;

-- ¿Tengo código cargado? (para avisar a los gerentes migrados que lo definan)
create or replace function public.tengo_codigo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.codigos_acceso where cuenta_id = auth.uid())
$$;

-- Primera cuenta de Dirección: se usa una sola vez, desde el SQL Editor de Supabase
-- (ver supabase/primera-cuenta.sql). Desde la app no se puede llamar.
create or replace function public.primera_cuenta_direccion(p_usuario text, p_nombre text, p_clave text, p_codigo text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.cuentas where rol = 'dir' and activo and not ejemplo) then
    raise exception 'Ya hay una cuenta de Dirección activa. Las demás cuentas se crean desde la app (Usuarios).';
  end if;
  perform public._crear_cuenta(p_usuario, p_nombre, 'dir', null, p_clave, p_codigo);
  return 'Cuenta creada. Ingresá a la app con el usuario «' || lower(btrim(p_usuario)) || '».';
end $$;

-- Permisos de ejecución: lo interno no se puede llamar desde la app.
revoke execute on function public._email_de(text), public._autoriza(uuid), public._codigo_bloqueado(), public._anotar_intento(boolean),
  public._hash_codigo(text), public._codigo_es(uuid, text), public._falla(text), public._puede_administrar(text),
  public._crear_usuario_auth(uuid, text, text), public._crear_cuenta(text, text, text, text, text, text, boolean),
  public.primera_cuenta_direccion(text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.renombrar_empresa(text, text, text), public.alta_equipo(text, text, text, text, text, text, text, text, text),
  public.crear_cuenta(text, text, text, text, text, text), public.restablecer_clave(uuid, text, text),
  public.cambiar_estado_cuenta(uuid, boolean), public.cambiar_mis_datos(text, text, text), public.tengo_codigo()
  from public, anon;
grant execute on function public.renombrar_empresa(text, text, text), public.alta_equipo(text, text, text, text, text, text, text, text, text),
  public.crear_cuenta(text, text, text, text, text, text), public.restablecer_clave(uuid, text, text),
  public.cambiar_estado_cuenta(uuid, boolean), public.cambiar_mis_datos(text, text, text), public.tengo_codigo()
  to authenticated;


-- >>>>>>>>>> 20261113000500_auditoria.sql
-- =====================================================================
-- Gestión de Planta · 5/6 · Registro de cambios (auditoría)
-- Cada alta, modificación, baja e ingreso queda registrado por triggers de la base,
-- con quién, cuándo, qué cambió y quién autorizó con su código.
-- Nadie (ni la app ni la clave de servicio) puede editar ni borrar este registro.
-- =====================================================================
create table if not exists public.auditoria (
  id              bigint generated always as identity primary key,
  ts              timestamptz not null default now(),
  usuario_id      uuid,
  nombre          text not null default 'Sistema',
  rol             text,
  operacion       text not null check (operacion in ('alta','modificacion','baja','ingreso')),
  tabla           text not null,
  registro        text,
  resumen         text not null,
  cambios         jsonb,
  autorizo_id     uuid,
  autorizo_nombre text
);
create index if not exists auditoria_ts on public.auditoria (ts desc);
create index if not exists auditoria_usuario on public.auditoria (usuario_id, ts desc);
create index if not exists auditoria_tabla on public.auditoria (tabla, registro);

alter table public.auditoria enable row level security;
select public._politica('ver', 'auditoria', 'select', 'public.tiene_rol(''gm'',''gp'',''dir'')');

create or replace function public.auditoria_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception 'El registro de cambios no se puede modificar ni borrar.' using errcode = '42501';
end $$;
drop trigger if exists inmutable on public.auditoria;
create trigger inmutable before update or delete on public.auditoria for each row execute function public.auditoria_inmutable();
drop trigger if exists inmutable_truncate on public.auditoria;
create trigger inmutable_truncate before truncate on public.auditoria for each statement execute function public.auditoria_inmutable();
revoke update, delete, truncate on public.auditoria from anon, authenticated, service_role;

-- Cómo se nombra cada registro en el resumen
create or replace function public._etiqueta(tabla text, r jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case tabla
    when 'equipos'                then 'el equipo ' || (r->>'codigo') || ' «' || (r->>'nombre') || '»'
    when 'ordenes'                then 'la OT-' || lpad(r->>'numero', 4, '0') || ' «' || (r->>'titulo') || '»'
    when 'fichas'                 then 'una ficha de trabajo en la OT-' || coalesce((select lpad(numero::text, 4, '0') from public.ordenes where id = (r->>'orden_id')::uuid), '?')
    when 'preventivos'            then 'el preventivo «' || (r->>'tarea') || '» de ' || (r->>'equipo')
    when 'preventivo_ejecuciones' then 'la realización del preventivo «' || coalesce((select tarea || '» en ' || equipo from public.preventivos where id = (r->>'preventivo_id')::uuid), '?»')
    when 'reportes'               then 'el reporte «' || (r->>'tipo') || '» en ' || (r->>'equipo')
    when 'adjuntos'               then 'un archivo (' || (r->>'tipo') || ') de un reporte'
    when 'movimientos'            then 'el registro de ' || case r->>'tipo' when 'produccion' then 'producción' else r->>'tipo' end || ': ' || (r->>'producto') || ' × ' || trim_scale((r->>'cantidad')::numeric)::text
    when 'manuales'               then 'el manual «' || (r->>'nombre') || '» de ' || (r->>'equipo')
    when 'cuentas'                then 'la cuenta de ' || (r->>'nombre') || ' (' || (r->>'usuario') || ')'
    when 'empresas'               then 'la empresa ' || (r->>'sigla')
    when 'productos'              then 'el producto «' || (r->>'nombre') || '» de ' || (r->>'empresa')
    when 'config'                 then 'el parámetro ' || (r->>'clave')
    else tabla end
$$;

create or replace function public.auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a jsonb; b jsonb; dif jsonb := '{}'::jsonb; k text;
  ignorar text[] := array['creado_por','creado','modificado_por','modificado'];
  op text; res text; aut uuid; c public.cuentas;
  clave text := tg_argv[0];
begin
  -- Cargas masivas desde el SQL Editor (migración de W-Main, datos de ejemplo): se anota un solo resumen.
  -- Desde la app no aplica: ahí siempre hay un usuario conectado.
  if auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    b := to_jsonb(new) - ignorar; op := 'alta';
    res := case tg_table_name when 'cuentas' then 'Creó ' when 'fichas' then 'Cargó ' when 'preventivo_ejecuciones' then 'Registró '
             when 'reportes' then 'Envió ' when 'movimientos' then 'Cargó ' when 'adjuntos' then 'Adjuntó ' else 'Dio de alta ' end
           || public._etiqueta(tg_table_name, to_jsonb(new));
    dif := b;
  elsif tg_op = 'UPDATE' then
    a := to_jsonb(old) - ignorar; b := to_jsonb(new) - ignorar;
    for k in select key from jsonb_each(b) loop
      if (a -> k) is distinct from (b -> k) then
        dif := dif || jsonb_build_object(k, jsonb_build_array(a -> k, b -> k));
      end if;
    end loop;
    if dif = '{}'::jsonb then
      -- cambio de contraseña o código: se registra sin mostrar nada sensible
      if tg_table_name = 'cuentas' then
        op := 'modificacion'; res := 'Cambió la contraseña o el código de ' || public._etiqueta(tg_table_name, b); dif := null;
      else
        return null;
      end if;
    else
      op := 'modificacion';
      res := case
        when tg_table_name = 'cuentas' and dif ? 'activo' then case when (b->>'activo')::boolean then 'Activó ' else 'Desactivó ' end
        when tg_table_name = 'empresas' and dif ? 'nombre' then 'Cambió el nombre de '
        when tg_table_name = 'ordenes' and dif ? 'estado' and b->>'estado' = 'cerrada' then 'Cerró '
        when tg_table_name = 'ordenes' and dif ? 'estado' and a->>'estado' = 'cerrada' then 'Reabrió '
        when tg_table_name = 'equipos' and dif ? 'estado' and b->>'estado' = 'baja' then 'Dio de baja '
        when tg_table_name = 'equipos' and (dif ? 'empresa' or dif ? 'area' or dif ? 'ubicacion') then 'Reubicó '
        when tg_table_name in ('equipos','ordenes','reportes') and dif ? 'estado' and (select count(*) from jsonb_object_keys(dif - 'orden_id')) = 1
          then 'Cambió a «' || case b->>'estado' when 'operativo' then 'Operativo' when 'detenido' then 'Detenido' when 'reparacion' then 'En reparación'
                                  when 'abierta' then 'Abierta' when 'curso' then 'En curso' when 'revisar' then 'Para revisar'
                                  when 'nuevo' then 'Nuevo' when 'analisis' then 'En análisis' when 'ot' then 'OT generada' when 'descartado' then 'Descartado'
                                  else b->>'estado' end || '» '
        when tg_table_name = 'movimientos' and dif ? 'estado' then case b->>'estado' when 'revisado' then 'Marcó como revisado ' else 'Observó ' end
        else 'Modificó ' end
        || public._etiqueta(tg_table_name, to_jsonb(new));
    end if;
  else
    a := to_jsonb(old) - ignorar; op := 'baja';
    res := 'Quitó ' || public._etiqueta(tg_table_name, to_jsonb(old));
    dif := a;
  end if;

  aut := nullif(current_setting('planta.autorizo_id', true), '')::uuid;
  select * into c from public.cuentas where id = auth.uid();
  insert into public.auditoria (usuario_id, nombre, rol, operacion, tabla, registro, resumen, cambios, autorizo_id, autorizo_nombre)
  values (auth.uid(), coalesce(c.nombre, case when auth.uid() is null then 'Sistema' else 'Cuenta sin perfil' end), c.rol, op, tg_table_name,
          coalesce(b, a) ->> clave, res, dif, aut, public._nombre_cuenta(aut));
  return null;
end $$;

do $$
declare t record;
begin
  for t in select * from (values
    ('empresas','sigla'), ('productos','id'), ('config','clave'), ('cuentas','id'), ('equipos','codigo'), ('manuales','id'),
    ('ordenes','id'), ('fichas','id'), ('preventivos','id'), ('preventivo_ejecuciones','id'), ('reportes','id'),
    ('adjuntos','id'), ('movimientos','id')) as x(tabla, clave)
  loop
    execute format('drop trigger if exists z_auditar on public.%I', t.tabla);
    execute format('create trigger z_auditar after insert or update or delete on public.%I for each row execute function public.auditar(%L)', t.tabla, t.clave);
  end loop;
end $$;

-- ---------- Ingresos ----------
-- Cada inicio de sesión crea una fila en auth.sessions: un trigger lo anota en la auditoría.
-- (No depende de la app, así que no se puede saltear.)
create or replace function public.auditar_ingreso() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.cuentas;
begin
  select * into c from public.cuentas where id = new.user_id;
  insert into public.auditoria (usuario_id, nombre, rol, operacion, tabla, registro, resumen)
  values (new.user_id, coalesce(c.nombre, 'Cuenta sin perfil'), c.rol, 'ingreso', 'sesion', new.user_id::text,
          'Ingresó a la app de ' || case when c.rol = 'op' then 'operarios' else 'gestión' end);
  return null;
exception when others then
  return null;  -- un problema al anotar nunca debe impedir el ingreso
end $$;
do $$ begin
  execute 'drop trigger if exists planta_ingreso on auth.sessions';
  execute 'create trigger planta_ingreso after insert on auth.sessions for each row execute function public.auditar_ingreso()';
exception when insufficient_privilege then
  raise notice 'No se pudo crear el trigger de ingresos en auth.sessions (permiso). Ver README.';
end $$;

revoke execute on function public._etiqueta(text, jsonb), public.auditar(), public.auditar_ingreso(), public.auditoria_inmutable()
  from public, anon, authenticated;


-- >>>>>>>>>> 20261113000600_archivos_y_extras.sql
-- =====================================================================
-- Gestión de Planta · 6/6 · Archivos (Storage), tiempo real y datos de ejemplo
-- =====================================================================

-- ---------- Buckets privados ----------
-- reportes/<id del operario>/<archivo>: fotos (JPEG comprimido en el celular) y videos MP4 / MOV del iPhone.
-- manuales/<código del equipo>/<archivo>.pdf  (el bucket ya existía en W-Main: se reutiliza).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reportes', 'reportes', false, 50 * 1024 * 1024,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manuales', 'manuales', false, 20 * 1024 * 1024, array['application/pdf'])
on conflict (id) do update set public = false;

drop policy if exists planta_reportes_subir on storage.objects;
create policy planta_reportes_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'reportes' and public.tiene_rol('op') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists planta_reportes_ver on storage.objects;
create policy planta_reportes_ver on storage.objects for select to authenticated
  using (bucket_id = 'reportes' and (public.es_gestion() or (storage.foldername(name))[1] = auth.uid()::text));

drop policy if exists planta_manuales_ver on storage.objects;
create policy planta_manuales_ver on storage.objects for select to authenticated
  using (bucket_id = 'manuales' and public.es_gestion());
drop policy if exists planta_manuales_subir on storage.objects;
create policy planta_manuales_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'manuales' and public.tiene_rol('gm'));
drop policy if exists planta_manuales_borrar on storage.objects;
create policy planta_manuales_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'manuales' and public.tiene_rol('gm'));

-- Cambiar el límite de video (MB). Se usa desde el SQL Editor, por ejemplo: select public.limite_video(100);
-- Ojo: el plan gratuito de Supabase no acepta archivos de más de 50 MB aunque el límite sea mayor.
create or replace function public.limite_video(mb int) returns text
language plpgsql security definer set search_path = public as $$
begin
  if mb < 1 or mb > 5000 then raise exception 'Indicá un límite entre 1 y 5000 MB.'; end if;
  update public.config set valor = to_jsonb(mb) where clave = 'limite_video_mb';
  update storage.buckets set file_size_limit = greatest(mb, coalesce((select (valor)::int from public.config where clave = 'limite_foto_mb'), 15)) * 1024 * 1024
    where id = 'reportes';
  return 'Límite de video: ' || mb || ' MB';
end $$;
revoke execute on function public.limite_video(int) from public, anon, authenticated;

-- ---------- Crear un reporte con sus fotos y videos en un solo paso ----------
create or replace function public.crear_reporte(p_equipo text, p_tipo text, p_detenida boolean, p_descripcion text, p_adjuntos jsonb default '[]')
returns uuid language plpgsql set search_path = public as $$
declare rid uuid; x jsonb;
begin
  insert into public.reportes (equipo, tipo, detenida, descripcion) values (p_equipo, p_tipo, coalesce(p_detenida, false), p_descripcion)
    returning id into rid;
  for x in select * from jsonb_array_elements(coalesce(p_adjuntos, '[]'::jsonb)) loop
    insert into public.adjuntos (reporte_id, ruta, tipo, mime, bytes)
    values (rid, x->>'ruta', x->>'tipo', x->>'mime', (x->>'bytes')::bigint);
  end loop;
  return rid;
end $$;
revoke execute on function public.crear_reporte(text, text, boolean, text, jsonb) from public, anon;
grant execute on function public.crear_reporte(text, text, boolean, text, jsonb) to authenticated;

-- ---------- Datos de ejemplo ----------
-- Borra todo lo marcado como ejemplo y desactiva las cuentas de ejemplo. Lo real queda.
create or replace function public.borrar_datos_ejemplo() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare n int := 0; m int;
begin
  if not public.tiene_rol('gm') then raise exception 'Solo el gerente de mantenimiento puede borrar los datos de ejemplo.' using errcode = '42501'; end if;
  if (select ejemplo from public.cuentas where id = auth.uid()) then
    raise exception 'Estás usando una cuenta de ejemplo. Creá tu propia cuenta, entrá con ella y después borrá los datos de ejemplo.';
  end if;
  delete from public.movimientos where ejemplo; get diagnostics m = row_count; n := n + m;
  delete from public.adjuntos where ejemplo;
  update public.ordenes set reporte_id = null where ejemplo or reporte_id in (select id from public.reportes where ejemplo);
  delete from public.reportes where ejemplo; get diagnostics m = row_count; n := n + m;
  delete from public.preventivos where ejemplo; get diagnostics m = row_count; n := n + m;
  delete from public.ordenes where ejemplo; get diagnostics m = row_count; n := n + m;
  delete from public.manuales where ejemplo;
  delete from public.equipos e where e.ejemplo
    and not exists (select 1 from public.ordenes o where o.equipo = e.codigo)
    and not exists (select 1 from public.reportes r where r.equipo = e.codigo)
    and not exists (select 1 from public.movimientos v where v.equipo = e.codigo);
  get diagnostics m = row_count; n := n + m;
  update public.cuentas set activo = false where ejemplo and activo;
  update auth.users set banned_until = '2999-12-31'::timestamptz where id in (select id from public.cuentas where ejemplo);
  return jsonb_build_object('ok', true, 'borrados', n);
end $$;
revoke execute on function public.borrar_datos_ejemplo() from public, anon;
grant execute on function public.borrar_datos_ejemplo() to authenticated;

-- ---------- Tiempo real: la app se actualiza sola cuando otro carga algo ----------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Sin publicación supabase_realtime: la app se actualiza al recargar.';
    return;
  end if;
  foreach t in array array['empresas','cuentas','equipos','equipo_eventos','manuales','ordenes','fichas','preventivos',
                           'preventivo_ejecuciones','reportes','adjuntos','movimientos'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Funciones auxiliares sin acceso desde la app
revoke execute on function public._nombre_cuenta(uuid) from public, anon, authenticated;
revoke execute on function public.rol_actual(), public.tiene_rol(text[]), public.es_gestion(), public._solo_cambian(jsonb, jsonb, text[]),
  public.reubicar_equipo(text, text, text, text, text), public.estado_equipo(text, text, text) from public, anon;
grant execute on function public.rol_actual(), public.tiene_rol(text[]), public.es_gestion(), public._solo_cambian(jsonb, jsonb, text[]),
  public.reubicar_equipo(text, text, text, text, text), public.estado_equipo(text, text, text) to authenticated;


-- >>>>>>>>>> 20261113000700_migrar_w_main.sql
-- =====================================================================
-- Gestión de Planta · Migración de los datos de W-Main
-- Pasa a las tablas nuevas lo que ya estaba cargado en W-Main (tabla docs):
-- equipos, manuales, órdenes, preventivos e historial, avisos de operarios y cuentas.
--   · Siglas: IP → INY, LH → LIM, PH → PIN, AL → SAL (GR y cualquier otra → INY).
--   · Los códigos y etiquetas QR viejos siguen funcionando (tabla equipo_alias).
--   · Las cuentas de W-Main pasan a ingresar con USUARIO (el resumen muestra cuál le tocó a cada uno):
--       admin → gerente de mantenimiento · tecnico → técnico · lectura → dirección · pendiente → técnico desactivado.
--   · La tabla docs de W-Main NO se borra: queda como respaldo.
-- Se ejecuta una sola vez (si ya se migró, no hace nada). En un proyecto nuevo, sin W-Main, no hace nada.
-- =====================================================================

create or replace function public.migrar_w_main() returns text
language plpgsql security definer set search_path = public, extensions, auth as $mig$
declare
  d record; x jsonb; s text; n int;
  emp text; ar text; ti text; nro int; cod text; viejo text; partes text[];
  est text; uid uuid; usu text; base text; k int; rol text;
  eq_cod text; ot_id uuid; pv_id uuid;
  c_eq int := 0; c_man int := 0; c_ot int := 0; c_fi int := 0; c_pv int := 0; c_ej int := 0; c_ev int := 0; c_rep int := 0; c_adj int := 0; c_cu int := 0;
  cuentas_txt text := '';
  areas_wm jsonb := '{"INY":"Inyección","SOP":"Soplado","MOL":"Molienda / recuperado","ELA":"Elaboración / mezcla","ENV":"Envasado / llenado","EMP":"Etiquetado y empaque","DEP":"Depósito / logística","SER":"Servicios generales (aire, agua, vapor, energía)","LAB":"Calidad / laboratorio","EFL":"Efluentes","EDI":"Edilicio","TAL":"Taller / pañol de mantenimiento"}';
  tipos_wm jsonb := '{"INY":"Inyectora","SOP":"Sopladora","MOL":"Molino","MDE":"Molde / matriz","CHI":"Chiller / enfriador","COM":"Compresor","SEC":"Secador / deshumidificador","MEZ":"Mezclador / agitador","DIS":"Dispersor","MAR":"Marmita / reactor","BOM":"Bomba","LLE":"Llenadora / envasadora","TAP":"Tapadora","ETQ":"Etiquetadora","CIN":"Cinta transportadora","TAN":"Tanque / recipiente","CAL":"Caldera","INT":"Intercambiador / pasteurizador","TAB":"Tablero eléctrico","MOT":"Motor eléctrico / motorreductor","API":"Apiladora","AUT":"Autoelevador / zorra","HER":"Herramienta eléctrica","SOL":"Soldadora","GEN":"Grupo electrógeno","BAL":"Balanza","EXT":"Extracción / ventilación","ROB":"Robot / manipulador","OTR":"Otro"}';
  cfg jsonb;
begin
  if to_regclass('public.docs') is null then
    return 'No hay datos de W-Main en este proyecto: no hay nada para migrar.';
  end if;
  if exists (select 1 from public.config where clave = 'migracion_w_main') then
    return 'Los datos de W-Main ya se migraron el ' || (select valor->>'fecha' from public.config where clave = 'migracion_w_main') || '. No se hizo nada.';
  end if;
  perform set_config('planta.carga_masiva', '1', true);

  create temp table _emp (sigla_vieja text primary key, nuevo text) on commit drop;
  insert into _emp values ('IP','INY'), ('LH','LIM'), ('PH','PIN'), ('AL','SAL'), ('INY','INY'), ('LIM','LIM'), ('PIN','PIN'), ('SAL','SAL');
  create temp table _eq (doc text primary key, codigo text) on commit drop;
  create temp table _ot (doc text primary key, id uuid, registro text) on commit drop;
  create temp table _pv (doc text primary key, id uuid) on commit drop;

  -- Nombres de áreas y tipos que se usaban en W-Main (incluye los configurados)
  select data into cfg from public.docs where col = 'config' and id = 'codigos';
  if cfg ? 'areasLista' then select areas_wm || coalesce(jsonb_object_agg(e->>'c', e->>'d'), '{}') into areas_wm from jsonb_array_elements(cfg->'areasLista') e where e->>'c' is not null; end if;
  if cfg ? 'tiposLista' then select tipos_wm || coalesce(jsonb_object_agg(e->>'c', e->>'d'), '{}') into tipos_wm from jsonb_array_elements(cfg->'tiposLista') e where e->>'c' is not null; end if;

  -- ---------- Cuentas (primero, para poder relacionar autores) ----------
  if to_regclass('public.perfiles') is not null then
    for d in select p.id, p.nombre, p.rol, u.email from public.perfiles p join auth.users u on u.id = p.id
             where not exists (select 1 from public.cuentas c where c.id = p.id) order by p.creado loop
      base := lower(regexp_replace(split_part(coalesce(d.email, 'usuario'), '@', 1), '[^A-Za-z0-9._-]', '', 'g'));
      if length(base) < 3 then base := rpad(base, 3, '0'); end if;
      base := left(base, 26); usu := base; k := 1;
      while exists (select 1 from public.cuentas where usuario = usu) or exists (select 1 from auth.users where email = public._email_de(usu) and id <> d.id) loop
        k := k + 1; usu := base || k;
      end loop;
      rol := case d.rol when 'admin' then 'gm' when 'lectura' then 'dir' else 'tec' end;
      insert into public.cuentas (id, usuario, nombre, rol, activo, email_anterior)
      values (d.id, usu, coalesce(nullif(btrim(d.nombre), ''), usu), rol, d.rol <> 'pendiente', d.email);
      update auth.users set email = public._email_de(usu), updated_at = now() where id = d.id;
      update auth.identities set identity_data = identity_data || jsonb_build_object('email', public._email_de(usu))
        where user_id = d.id and provider = 'email';
      if d.rol = 'pendiente' then update auth.users set banned_until = '2999-12-31'::timestamptz where id = d.id; end if;
      c_cu := c_cu + 1;
      cuentas_txt := cuentas_txt || E'\n   · ' || coalesce(d.email, '?') || ' → usuario «' || usu || '» (' ||
        case rol when 'gm' then 'Gerente de mantenimiento' when 'dir' then 'Dirección' else 'Técnico' end ||
        case when d.rol = 'pendiente' then ', desactivada' else '' end || ')';
    end loop;
  end if;
  -- Las cuentas nuevas ya no crean perfiles de W-Main
  drop trigger if exists al_crear_usuario on auth.users;

  -- ---------- Equipos ----------
  for d in select id, data from public.docs where col = 'equipos' order by coalesce(data->>'creado', ''), id loop
    viejo := upper(coalesce(d.data->>'codigo', ''));
    partes := regexp_match(viejo, '^([A-Z]{2,3})-([A-Z]{3})-([A-Z]{3})-([0-9]+)$');
    emp := coalesce((select nuevo from _emp where sigla_vieja = upper(coalesce(d.data->>'empresa', ''))),
                    (select nuevo from _emp where sigla_vieja = partes[1]), 'INY');
    ar := upper(coalesce(partes[2], d.data->>'area', ''));
    ti := upper(coalesce(partes[3], d.data->>'tipo', ''));
    if ar !~ '^[A-Z]{3}$' then ar := 'SER'; end if;
    if ti !~ '^[A-Z]{3}$' then ti := 'OTR'; end if;
    insert into public.areas (codigo, nombre, orden) values (ar, coalesce(areas_wm->>ar, ar), 50) on conflict do nothing;
    insert into public.tipos_equipo (codigo, nombre, orden) values (ti, coalesce(tipos_wm->>ti, ti), 50) on conflict do nothing;
    nro := coalesce(nullif(partes[4], '')::int, case when d.data->>'numero' ~ '^[0-9]+$' then (d.data->>'numero')::int end, 1);
    cod := emp || '-' || ar || '-' || ti || '-' || lpad(nro::text, 3, '0');
    while exists (select 1 from public.equipos where codigo = cod) loop
      nro := nro + 1; cod := emp || '-' || ar || '-' || ti || '-' || lpad(nro::text, 3, '0');
    end loop;
    est := case
      when d.data->>'estado' = 'Baja' then 'baja'
      when coalesce(d.data->>'estadoOp', '') ~* 'repara' then 'reparacion'
      when coalesce(d.data->>'estadoOp', '') ~* 'detenid|fuera' then 'detenido'
      else 'operativo' end;
    insert into public.equipos (codigo, empresa, area, tipo, nombre, marca, modelo, ubicacion, notas, estado, alta, ejemplo, creado, modificado)
    values (cod, emp, ar, ti, left(coalesce(nullif(btrim(d.data->>'nombre'), ''), cod), 120),
            nullif(d.data->>'marca', ''), nullif(d.data->>'modelo', ''), nullif(d.data->>'ubicacion', ''),
            nullif(concat_ws(E'\n', nullif(d.data->>'notas', ''), 'Serie: ' || nullif(d.data->>'serie', ''), 'Criticidad: ' || nullif(d.data->>'criticidad', '')), ''),
            est, coalesce((left(d.data->>'creado', 10))::date, current_date), coalesce(d.data->>'nombre', '') ~* '^ejemplo',
            coalesce((d.data->>'creado')::timestamptz, now()), now());
    insert into _eq values (d.id, cod);
    for s in select distinct upper(v) from (select d.id as v union all select viejo union all select d.data->>'idActivo'
                                            union all select jsonb_array_elements_text(coalesce(d.data->'codigosAnteriores', '[]'))) a
             where coalesce(v, '') <> '' loop
      if s <> cod then insert into public.equipo_alias values (s, cod) on conflict do nothing; end if;
    end loop;
    insert into public.equipo_alias values (d.id, cod) on conflict do nothing;  -- id interno, tal cual
    insert into public.equipo_eventos (equipo, fecha, texto) values (cod, now(), 'Migrado desde W-Main' || coalesce(' (código anterior ' || nullif(viejo, '') || ')', ''));
    c_eq := c_eq + 1;
  end loop;

  -- ---------- Manuales (los PDF ya están en el bucket "manuales") ----------
  for d in select id, data from public.docs where col = 'manuales' loop
    for s in select jsonb_array_elements_text(coalesce(d.data->'equipoIds', jsonb_build_array(d.data->>'equipoId'))) loop
      eq_cod := (select codigo from _eq where doc = s);
      if eq_cod is not null and (d.data->>'assetId' is not null or nullif(d.data->>'url', '') is not null) then
        insert into public.manuales (equipo, nombre, bucket, ruta, url, fecha, creado)
        values (eq_cod, coalesce(nullif(d.data->>'titulo', ''), d.data->>'nombreArchivo', 'Manual'),
                case when d.data->>'assetId' is not null then 'manuales' end, d.data->>'assetId', nullif(d.data->>'url', ''),
                coalesce(left(d.data->>'creado', 10)::date, current_date), coalesce((d.data->>'creado')::timestamptz, now()));
        c_man := c_man + 1;
      end if;
    end loop;
  end loop;

  -- ---------- Órdenes (las anuladas no se pasan) ----------
  for d in select id, data from public.docs where col = 'ots' and coalesce(data->>'estado', '') <> 'Anulada'
           order by case when data->>'numero' ~ '^[0-9]+$' then (data->>'numero')::int end nulls last, data->>'reportado' loop
    eq_cod := (select codigo from _eq where doc = d.data->>'equipoId');
    continue when eq_cod is null;
    nro := case when d.data->>'numero' ~ '^[0-9]+$' then (d.data->>'numero')::int end;
    if nro is not null and exists (select 1 from public.ordenes where numero = nro) then nro := null; end if;
    insert into public.ordenes (numero, equipo, titulo, descripcion, tipo, prioridad, vence, asignado, estado, cerrada, cerrada_por_nombre, ejemplo, creado, modificado)
    values (nro, eq_cod,
            left(coalesce(nullif(btrim(d.data->>'desc'), ''), d.data->>'tareaNombre', 'Orden de W-Main'), 200),
            nullif(concat_ws(E'\n', d.data->>'desc', 'Motivo de la urgencia: ' || nullif(d.data->>'porQue', ''), 'Notas: ' || nullif(d.data->>'notas', '')), ''),
            case when d.data->>'tipo' = 'preventivo' then 'preventiva' else 'correctiva' end,
            case coalesce(d.data->>'urgManual', d.data->>'urg') when 'U1' then 'alta' when 'U2' then 'alta' when 'U4' then 'baja' else 'media' end,
            case when d.data->>'vence' ~ '^\d{4}-\d{2}-\d{2}' then left(d.data->>'vence', 10)::date end,
            nullif(coalesce(nullif(d.data->>'tecnicoNombre', ''), d.data->>'asignado'), ''),
            case d.data->>'estado' when 'Cerrada' then 'cerrada' when 'Abierta' then 'abierta' else 'curso' end,
            case when d.data->>'estado' = 'Cerrada' then coalesce((d.data->>'cierre')::timestamptz, now()) end,
            case when d.data->>'estado' = 'Cerrada' then nullif(d.data->>'tecnicoNombre', '') end,
            coalesce(d.data->>'desc', '') ~* '^ejemplo',
            coalesce((d.data->>'reportado')::timestamptz, (d.data->>'creado')::timestamptz, now()), now())
    returning id into ot_id;
    insert into _ot values (d.id, ot_id, d.data->>'registroId');
    c_ot := c_ot + 1;
  end loop;

  -- ---------- Preventivos (tareas del plan) ----------
  for d in select id, data from public.docs where col = 'tareas' loop
    eq_cod := (select codigo from _eq where doc = d.data->>'equipoId');
    continue when eq_cod is null;
    nro := case
      when coalesce(d.data->>'modo', 'tiempo') = 'horas' and d.data->>'cadaHoras' ~ '^[0-9.]+$' then
        greatest(1, ceil((d.data->>'cadaHoras')::numeric / greatest(coalesce((select (x2.data->>'horasDia')::numeric from public.docs x2 where x2.col = 'equipos' and x2.id = d.data->>'equipoId' and x2.data->>'horasDia' ~ '^[0-9.]+$'), 8), 1)))::int
      when d.data->>'cadaValor' ~ '^[0-9.]+$' then
        greatest(1, round((d.data->>'cadaValor')::numeric * case d.data->>'cadaUnidad' when 'semanas' then 7 when 'meses' then 30 when 'anios' then 365 else 1 end))::int
      else 30 end;
    insert into public.preventivos (equipo, tarea, frecuencia, ultima, responsable, ejemplo, creado, modificado)
    values (eq_cod, left(coalesce(nullif(d.data->>'nombre', ''), 'Tarea de W-Main'), 300)
                    || case when coalesce(d.data->>'modo', 'tiempo') = 'horas' then ' (cada ' || (d.data->>'cadaHoras') || ' h de uso)' else '' end,
            least(nro, 3650), case when d.data->>'ultimaFecha' ~ '^\d{4}-\d{2}-\d{2}' then left(d.data->>'ultimaFecha', 10)::date end,
            nullif(d.data->>'responsable', ''), (select ejemplo from public.equipos where codigo = eq_cod),
            coalesce((d.data->>'creado')::timestamptz, now()), now())
    returning id into pv_id;
    insert into _pv values (d.id, pv_id);
    c_pv := c_pv + 1;
  end loop;

  -- ---------- Registros: realizaciones de preventivos, fichas de órdenes o historial del equipo ----------
  for d in select id, data from public.docs where col = 'registros' order by data->>'fecha', id loop
    eq_cod := (select codigo from _eq where doc = d.data->>'equipoId');
    continue when eq_cod is null;
    s := nullif(coalesce(nullif(d.data->>'firmaNombre', ''), nullif(d.data->>'tecnico', ''), d.data->>'porNombre'), '');
    pv_id := (select id from _pv where doc = d.data->>'tareaId');
    ot_id := coalesce((select id from _ot where doc = d.data->>'otId'), (select id from _ot where registro = d.id));
    if ot_id is not null then
      insert into public.fichas (orden_id, tecnico_id, tecnico_nombre, fecha, trabajo, horas, parada, repuestos, resultado, creado, modificado)
      values (ot_id, null, coalesce(s, 'W-Main'),
              coalesce((d.data->>'fecha')::date + time '12:00', now()),
              coalesce(nullif(concat_ws(' · ', 'Causa: ' || nullif(d.data->>'causa', ''), nullif(d.data->>'solucion', ''), nullif(d.data->>'obs', '')), ''), d.data->>'tareaNombre', 'Trabajo registrado en W-Main'),
              least(coalesce(case when d.data->>'duracion' ~ '^[0-9.]+$' then (d.data->>'duracion')::numeric end, 0), 1000),
              least(coalesce(case when d.data->>'parada' ~ '^[0-9.]+$' then (d.data->>'parada')::numeric end, 0), 1000),
              nullif(d.data->>'repuestos', ''),
              case when coalesce(d.data->>'resultado', '') ~* 'resuelt|ok|termin' then 'terminado' else 'pendiente' end,
              coalesce((d.data->>'creado')::timestamptz, now()), now());
      c_fi := c_fi + 1;
    elsif pv_id is not null then
      insert into public.preventivo_ejecuciones (preventivo_id, tecnico_id, tecnico_nombre, fecha, horas, obs, creado, modificado)
      values (pv_id, null, coalesce(s, 'W-Main'), coalesce((d.data->>'fecha')::date + time '12:00', now()),
              least(coalesce(case when d.data->>'duracion' ~ '^[0-9.]+$' then (d.data->>'duracion')::numeric end, 0), 1000),
              nullif(concat_ws(' · ', nullif(d.data->>'obs', ''), nullif(d.data->>'resultado', '')), ''),
              coalesce((d.data->>'creado')::timestamptz, now()), now());
      c_ej := c_ej + 1;
    else
      insert into public.equipo_eventos (equipo, fecha, texto)
      values (eq_cod, coalesce((d.data->>'fecha')::date + time '12:00', now()),
              left(concat_ws(' · ', coalesce(nullif(d.data->>'tipo', ''), 'Registro') || ': ' || coalesce(d.data->>'tareaNombre', ''),
                             nullif(d.data->>'obs', ''), nullif(d.data->>'resultado', ''), s), 1000));
      c_ev := c_ev + 1;
    end if;
  end loop;

  -- ---------- Avisos de operarios → reportes ----------
  for d in select id, data from public.docs where col = 'avisos' order by data->>'fecha' loop
    eq_cod := (select codigo from _eq where doc = d.data->>'equipoId');
    continue when eq_cod is null;
    s := coalesce(d.data->'sintomas'->>0, '');
    insert into public.reportes (equipo, tipo, detenida, descripcion, operario_id, operario_nombre, empresa, estado, nota, orden_id, ts, creado, modificado)
    values (eq_cod,
            case when s ~* 'ruido' then 'Ruido' when s ~* 'vibra' then 'Vibración' when s ~* 'olor|humo' then 'Olor a quemado'
                 when s ~* 'pérdida|perdida' then 'Pérdida / fuga' when s ~* 'recalent' then 'Temperatura alta'
                 when s ~* 'arranca' then 'No arranca' when s ~* 'chispa' then 'Falla eléctrica' else 'Otro' end,
            d.data->>'funcionamiento' = 'parado',
            coalesce(nullif(concat_ws('. ', 'Notó: ' || nullif((select string_agg(v, ', ') from jsonb_array_elements_text(coalesce(d.data->'sintomas', '[]')) v), ''),
                                      nullif(d.data->>'descripcion', '')), ''), 'Aviso de W-Main'),
            null, coalesce(nullif(d.data->>'operario', ''), 'Operario'),
            (select empresa from public.equipos where codigo = eq_cod),
            case d.data->>'estado' when 'Nuevo' then 'nuevo' when 'Descartado' then 'descartado' else 'ot' end,
            nullif(d.data->>'motivo', ''), (select id from _ot where doc = d.data->>'otId'),
            coalesce((d.data->>'fecha')::timestamptz, now()), coalesce((d.data->>'fecha')::timestamptz, now()), now())
    returning id into ot_id;
    update public.reportes set estado = 'analisis' where id = ot_id and estado = 'ot' and orden_id is null;
    if to_regclass('public.avisos_fotos') is not null then
      for x in execute 'select jsonb_build_object(''tipo'', tipo, ''data'', data) from public.avisos_fotos where aviso_id = $1 and tipo = ''foto'' order by id' using d.id loop
        insert into public.adjuntos (reporte_id, bucket, ruta, tipo, mime) values (ot_id, 'w-main', x->>'data', 'foto', 'image/jpeg');
        c_adj := c_adj + 1;
      end loop;
    end if;
    c_rep := c_rep + 1;
  end loop;

  insert into public.config (clave, valor) values ('migracion_w_main', jsonb_build_object('fecha', to_char(now(), 'DD/MM/YYYY HH24:MI'),
    'equipos', c_eq, 'ordenes', c_ot, 'preventivos', c_pv, 'reportes', c_rep, 'cuentas', c_cu));
  insert into public.auditoria (operacion, tabla, registro, resumen, cambios)
  values ('alta', 'w-main', null, 'Migró los datos de W-Main: ' || c_eq || ' equipos, ' || c_ot || ' órdenes, ' || c_pv || ' preventivos, ' || c_rep || ' reportes, ' || c_cu || ' cuentas',
          jsonb_build_object('equipos', c_eq, 'manuales', c_man, 'ordenes', c_ot, 'fichas', c_fi, 'preventivos', c_pv, 'realizaciones', c_ej,
                             'historial', c_ev, 'reportes', c_rep, 'fotos', c_adj, 'cuentas', c_cu));
  return 'Migración de W-Main terminada:' ||
    E'\n · Equipos: ' || c_eq || ' (los códigos y QR viejos siguen funcionando)' ||
    E'\n · Manuales: ' || c_man ||
    E'\n · Órdenes de trabajo: ' || c_ot || ' (con ' || c_fi || ' fichas de trabajo)' ||
    E'\n · Preventivos: ' || c_pv || ' (con ' || c_ej || ' realizaciones)' ||
    E'\n · Otros registros pasados al historial de los equipos: ' || c_ev ||
    E'\n · Reportes de operarios: ' || c_rep || ' (con ' || c_adj || ' fotos)' ||
    E'\n · Cuentas: ' || c_cu || case when c_cu > 0 then ' — desde ahora ingresan con USUARIO (no con el email) y la misma contraseña:' || cuentas_txt
      || E'\n   Los gerentes tienen que definir su código de acceso en «Mi cuenta» al ingresar.' else '' end;
end $mig$;
revoke execute on function public.migrar_w_main() from public, anon, authenticated;

select public.migrar_w_main() as resultado;
