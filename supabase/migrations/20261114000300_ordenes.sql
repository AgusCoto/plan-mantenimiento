-- =====================================================================
-- App de mantenimiento · 3 · Reportes de falla, órdenes de trabajo, fichas, costos y compras
-- Los id los puede generar el celular (para cargas sin señal): reenviar lo mismo no duplica.
-- =====================================================================

-- ---------- Reportes de falla del operario ----------
create table if not exists public.reportes_falla (
  id            uuid primary key default gen_random_uuid(),
  equipo_id     uuid not null references public.equipos(id),
  tipo_falla    text not null,
  parada        boolean not null,
  texto         text,
  operario_id   uuid references public.usuarios(id) default auth.uid(),
  estado        text not null default 'nuevo' check (estado in ('nuevo','en_orden','descartado')),
  orden_id      uuid,
  motivo_descarte text,
  hecho_en      timestamptz not null default now(),  -- cuándo lo cargó en el celular (puede ser sin señal)
  ejemplo       boolean not null default false
);
select public._control('public.reportes_falla');
create index if not exists reportes_estado on public.reportes_falla (estado, hecho_en desc);
create index if not exists reportes_equipo on public.reportes_falla (equipo_id);

-- ---------- Órdenes de trabajo ----------
-- Estados internos (no cambian; su nombre y color se editan en listas):
-- abierta → asignada → en_curso ⇄ esperando_repuesto → terminada → (verificada) → cerrada · anulada
create table if not exists public.ordenes (
  id                   uuid primary key default gen_random_uuid(),
  numero               int not null unique,
  equipo_id            uuid not null references public.equipos(id),
  reporte_id           uuid references public.reportes_falla(id),
  titulo               text not null check (length(btrim(titulo)) between 2 and 200),
  descripcion          text,
  tipo                 text not null default 'correctiva' check (tipo in ('correctiva','preventiva','mejora')),
  estado               text not null default 'abierta'
                       check (estado in ('abierta','asignada','esperando_repuesto','en_curso','terminada','verificada','cerrada','anulada')),
  parada               boolean not null default false,
  prioridad_calculada  text not null default 'media' check (prioridad_calculada in ('urgente','alta','media','baja')),
  prioridad            text not null default 'media' check (prioridad in ('urgente','alta','media','baja')),
  prioridad_por        uuid references public.usuarios(id),
  prioridad_en         timestamptz,
  asignado_a           uuid references public.usuarios(id),
  contratista_id       uuid references public.proveedores(id),
  vence                date,
  empresa_cargo_id     uuid not null references public.empresas(id),
  requiere_verificacion boolean not null default false,
  terminada_en         timestamptz,
  cerrada_en           timestamptz,
  motivo_anulacion     text,
  ejemplo              boolean not null default false
);
select public._control('public.ordenes');
create index if not exists ordenes_estado on public.ordenes (estado, prioridad);
create index if not exists ordenes_equipo on public.ordenes (equipo_id);
create index if not exists ordenes_asignado on public.ordenes (asignado_a, estado);
drop trigger if exists no_borrar on public.ordenes;
create trigger no_borrar before delete on public.ordenes for each row execute function public.no_se_borra();
do $$ begin
  alter table public.reportes_falla add constraint reportes_orden_fk foreign key (orden_id) references public.ordenes(id);
exception when duplicate_object then null; end $$;

-- Prioridad: combina la criticidad del equipo con si está parado.
create or replace function public.prioridad_de(criticidad text, parada boolean) returns text
language sql immutable as $$
  select case
    when parada and criticidad = 'alta' then 'urgente'
    when parada and criticidad = 'media' then 'alta'
    when parada then 'media'
    when criticidad = 'alta' then 'alta'
    when criticidad = 'media' then 'media'
    else 'baja' end
$$;

-- ---------- Fichas de trabajo (las cargan técnicos, encargado o el jefe por un contratista) ----------
-- La ficha de cierre lleva horas, horas de máquina parada, causa, fotos de antes y después y,
-- en equipos críticos, la firma del supervisor de producción (sin cuenta propia).
create table if not exists public.fichas (
  id                uuid primary key default gen_random_uuid(),
  orden_id          uuid not null references public.ordenes(id),
  tecnico_id        uuid references public.usuarios(id),
  contratista_id    uuid references public.proveedores(id),
  es_cierre         boolean not null default false,
  trabajo           text not null check (length(btrim(trabajo)) >= 2),
  horas             numeric(7,2) not null default 0 check (horas between 0 and 1000),
  horas_parada      numeric(7,2) not null default 0 check (horas_parada between 0 and 1000),
  causa             text,
  supervisor_nombre text,
  firma_ruta        text,
  remito            text,
  hecho_en          timestamptz not null default now(),
  ejemplo           boolean not null default false
);
select public._control('public.fichas');
create index if not exists fichas_orden on public.fichas (orden_id, hecho_en);

-- ---------- Costos de la orden: repuestos, servicios externos y otros (las horas salen de las fichas) ----------
create table if not exists public.costos_orden (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null references public.ordenes(id),
  tipo           text not null check (tipo in ('repuesto','servicio','otro')),
  descripcion    text not null,
  cantidad       numeric(12,3) not null default 1 check (cantidad > 0),
  costo_unitario numeric(14,2) not null default 0 check (costo_unitario >= 0),
  proveedor_id   uuid references public.proveedores(id),
  remito         text,
  ejemplo        boolean not null default false
);
select public._control('public.costos_orden');
create index if not exists costos_orden_orden on public.costos_orden (orden_id);

-- ---------- Pedidos de compra (los aprueba dirección; el jefe, debajo del tope configurado) ----------
create table if not exists public.pedidos_compra (
  id             uuid primary key default gen_random_uuid(),
  numero         int not null unique,
  orden_id       uuid references public.ordenes(id),
  equipo_id      uuid references public.equipos(id),
  empresa_id     uuid not null references public.empresas(id),
  descripcion    text not null check (length(btrim(descripcion)) >= 2),
  cantidad       numeric(12,3) not null default 1 check (cantidad > 0),
  monto_estimado numeric(14,2) check (monto_estimado is null or monto_estimado >= 0),
  proveedor_id   uuid references public.proveedores(id),
  estado         text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado','recibido','anulado')),
  resuelto_por   uuid references public.usuarios(id),
  resuelto_en    timestamptz,
  respuesta      text,
  ejemplo        boolean not null default false
);
select public._control('public.pedidos_compra');
create index if not exists pedidos_estado on public.pedidos_compra (estado);
drop trigger if exists no_borrar on public.pedidos_compra;
create trigger no_borrar before delete on public.pedidos_compra for each row execute function public.no_se_borra();

-- ---------- Fotos y videos (de reportes, fichas, costos y movimientos) ----------
create table if not exists public.adjuntos (
  id          uuid primary key default gen_random_uuid(),
  tabla       text not null check (tabla in ('reportes_falla','fichas','costos_orden','movimientos_equipo')),
  registro_id uuid not null,
  bucket      text not null default 'adjuntos',
  ruta        text not null,
  tipo        text not null check (tipo in ('foto','video')),
  momento     text check (momento in ('antes','despues')),
  mime        text,
  bytes       bigint,
  segundos    numeric(7,1),
  ejemplo     boolean not null default false
);
select public._control('public.adjuntos');
create index if not exists adjuntos_registro on public.adjuntos (tabla, registro_id);

-- Números correlativos sin saltos (órdenes y pedidos)
create or replace function public.numerar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('numerar:' || tg_table_name));
    if new.numero is null or auth.uid() is not null then
      execute format('select coalesce(max(numero), 0) + 1 from public.%I', tg_table_name) into new.numero;
    end if;
  elsif new.numero is distinct from old.numero then
    raise exception 'El número no se puede cambiar.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists b_numerar on public.ordenes;
create trigger b_numerar before insert or update on public.ordenes for each row execute function public.numerar();
drop trigger if exists b_numerar on public.pedidos_compra;
create trigger b_numerar before insert or update on public.pedidos_compra for each row execute function public.numerar();
