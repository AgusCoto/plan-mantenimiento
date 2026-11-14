-- =====================================================================
-- App de mantenimiento · 2 · Equipos, documentos, proveedores y movimientos
-- =====================================================================

create table if not exists public.proveedores (
  id       uuid primary key default gen_random_uuid(),
  nombre   text not null check (length(btrim(nombre)) between 2 and 120),
  rubro    text,
  contacto text,
  telefono text,
  email    text,
  notas    text,
  activo   boolean not null default true,
  ejemplo  boolean not null default false
);
select public._control('public.proveedores');

-- ---------- Equipos ----------
-- Código EMPRESA DUEÑA-TIPO-NÚMERO (ej. PIN-APL-001): lo genera la base, correlativo por empresa
-- y tipo, y no se edita. La empresa dueña no cambia aunque el equipo se preste: a ella se le
-- cargan las reparaciones. Dónde está ahora es un dato aparte (empresa_ubicacion_id, área y ubicación).
create table if not exists public.equipos (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text not null unique,
  empresa_duena_id     uuid not null references public.empresas(id),
  tipo                 text not null references public.tipos_equipo(sigla),
  numero               int  not null,
  nombre               text not null check (length(btrim(nombre)) between 2 and 120),
  marca                text,
  modelo               text,
  serie                text,
  potencia             text,
  tension              text,
  proveedor_id         uuid references public.proveedores(id),
  planos               text,
  criticidad           text not null default 'media' check (criticidad in ('alta','media','baja')),
  empresa_ubicacion_id uuid not null references public.empresas(id),
  area_id              uuid references public.areas(id),
  ubicacion            text,
  estado               text not null default 'operativo'
                       check (estado in ('operativo','detenido','en_reparacion','reparacion_externa','baja')),
  campos               jsonb not null default '{}' check (jsonb_typeof(campos) = 'object'),
  horometro            numeric(12,1),
  horometro_fecha      date,
  notas                text,
  ejemplo              boolean not null default false,
  unique (empresa_duena_id, tipo, numero)
);
select public._control('public.equipos');
create index if not exists equipos_ubicacion on public.equipos (empresa_ubicacion_id, estado);
create index if not exists equipos_duena on public.equipos (empresa_duena_id);
drop trigger if exists no_borrar on public.equipos;
create trigger no_borrar before delete on public.equipos for each row execute function public.no_se_borra();

create or replace function public.codigo_equipo() returns trigger
language plpgsql security definer set search_path = public as $$
declare sig text;
begin
  if tg_op = 'INSERT' then
    select sigla into sig from public.empresas where id = new.empresa_duena_id;
    perform pg_advisory_xact_lock(hashtext('equipo:' || new.empresa_duena_id || ':' || new.tipo));
    if new.numero is null or auth.uid() is not null then
      select coalesce(max(numero), 0) + 1 into new.numero from public.equipos
        where empresa_duena_id = new.empresa_duena_id and tipo = new.tipo;
    end if;
    new.codigo := sig || '-' || new.tipo || '-' || lpad(new.numero::text, 3, '0');
    new.empresa_ubicacion_id := coalesce(new.empresa_ubicacion_id, new.empresa_duena_id);
  else
    if new.codigo is distinct from old.codigo or new.numero is distinct from old.numero
       or new.empresa_duena_id is distinct from old.empresa_duena_id or new.tipo is distinct from old.tipo then
      raise exception 'El código, la empresa dueña y el tipo del equipo no se pueden cambiar.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists b_codigo on public.equipos;
create trigger b_codigo before insert or update on public.equipos for each row execute function public.codigo_equipo();

-- La sigla de una empresa no se cambia si ya tiene equipos (es parte de sus códigos)
create or replace function public.sigla_fija() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sigla is distinct from old.sigla and exists (select 1 from public.equipos where empresa_duena_id = old.id) then
    raise exception 'La sigla % ya está en códigos de equipos y no se puede cambiar.', old.sigla using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists b_sigla on public.empresas;
create trigger b_sigla before update on public.empresas for each row execute function public.sigla_fija();

-- Códigos anteriores (etiquetas de W-Main): siguen abriendo el equipo
create table if not exists public.equipo_alias (
  alias     text primary key,
  equipo_id uuid not null references public.equipos(id) on delete cascade
);

-- Documentos del equipo: foto de chapa, fotos, manuales, planos, programas de PLC,
-- procedimientos de bloqueo y etiquetado, fotos de configuración. Se desactivan, no se borran.
create table if not exists public.documentos (
  id        uuid primary key default gen_random_uuid(),
  equipo_id uuid not null references public.equipos(id),
  categoria text not null check (categoria in ('chapa','foto','manual','plano','plc','bloqueo','configuracion','otro')),
  nombre    text not null,
  bucket    text,
  ruta      text,
  url       text,
  mime      text,
  bytes     bigint,
  activo    boolean not null default true,
  ejemplo   boolean not null default false,
  check (ruta is not null or url is not null)
);
select public._control('public.documentos');
create index if not exists documentos_equipo on public.documentos (equipo_id);

-- ---------- Movimientos de equipos ----------
-- prestamo:           lo pide el jefe, lo aprueba (o rechaza) dirección; después sale y vuelve.
-- reparacion_externa: taller, fechas de salida y vuelta, presupuesto, remito y garantía.
-- baja:               motivo y destino (venta, desguace o chatarra).
-- reubicacion:        cambio de área o lugar dentro de la misma empresa.
create table if not exists public.movimientos_equipo (
  id                  uuid primary key default gen_random_uuid(),
  equipo_id           uuid not null references public.equipos(id),
  tipo                text not null check (tipo in ('prestamo','reparacion_externa','baja','reubicacion')),
  estado              text not null default 'solicitado'
                      check (estado in ('solicitado','aprobado','rechazado','en_curso','cerrado')),
  empresa_origen_id   uuid references public.empresas(id),
  area_origen_id      uuid references public.areas(id),
  ubicacion_origen    text,
  empresa_destino_id  uuid references public.empresas(id),
  area_destino_id     uuid references public.areas(id),
  ubicacion_destino   text,
  motivo              text,
  destino_baja        text,
  proveedor_id        uuid references public.proveedores(id),
  fecha_salida        date,
  fecha_vuelta_prevista date,
  fecha_vuelta        date,
  presupuesto         numeric(14,2) check (presupuesto is null or presupuesto >= 0),
  remito              text,
  garantia_hasta      date,
  resuelto_por        uuid references public.usuarios(id),
  resuelto_en         timestamptz,
  respuesta           text,
  ejemplo             boolean not null default false
);
select public._control('public.movimientos_equipo');
create index if not exists movimientos_equipo_eq on public.movimientos_equipo (equipo_id, creado_en desc);
create index if not exists movimientos_equipo_estado on public.movimientos_equipo (estado, tipo);
drop trigger if exists no_borrar on public.movimientos_equipo;
create trigger no_borrar before delete on public.movimientos_equipo for each row execute function public.no_se_borra();
