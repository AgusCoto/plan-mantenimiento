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
