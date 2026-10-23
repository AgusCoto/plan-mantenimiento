-- =====================================================================
-- Plan de Mantenimiento · esquema de base de datos para Supabase
-- Pegar completo en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin perder datos.
-- =====================================================================

-- ---------- Perfiles de usuario y roles ----------
-- rol: 'admin' (todo), 'tecnico' (carga fallas, registros, tareas), 'lectura' (solo ver),
--      'pendiente' (recién registrado: no ve nada hasta que un administrador lo apruebe)
create table if not exists public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null default '',
  email      text,
  rol        text not null default 'pendiente' check (rol in ('admin','tecnico','lectura','pendiente')),
  creado     timestamptz not null default now()
);

-- Al registrarse un usuario se crea su perfil. El primero de todos queda como administrador;
-- los demás quedan pendientes de aprobación.
create or replace function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre, email, rol)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nombre',''), split_part(new.email,'@',1)),
    new.email,
    case when exists (select 1 from public.perfiles) then 'pendiente' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.nuevo_usuario();

alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check check (rol in ('admin','tecnico','lectura','pendiente'));
alter table public.perfiles alter column rol set default 'pendiente';

create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid()
$$;

alter table public.perfiles enable row level security;
drop policy if exists perfiles_ver on public.perfiles;
create policy perfiles_ver on public.perfiles for select to authenticated using (true);
drop policy if exists perfiles_admin on public.perfiles;
create policy perfiles_admin on public.perfiles for update to authenticated
  using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');
-- Cada uno puede cambiar su propio nombre, pero no su rol.
drop policy if exists perfiles_propio on public.perfiles;
create policy perfiles_propio on public.perfiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and rol = public.mi_rol());

-- ---------- Documentos de la aplicación ----------
-- Cada registro es un documento JSON de una colección:
-- equipos, tareas, registros, ots (fallas), checklists, manuales, informes, config.
create table if not exists public.docs (
  col         text not null,
  id          text not null,
  data        jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now(),
  actualizado_por uuid default auth.uid(),
  primary key (col, id)
);
create index if not exists docs_col on public.docs (col);

alter table public.docs enable row level security;
drop policy if exists docs_ver on public.docs;
create policy docs_ver on public.docs for select to authenticated
  using (public.mi_rol() in ('admin','tecnico','lectura'));
drop policy if exists docs_crear on public.docs;
-- La configuración (empresas, áreas, tipos y sus nombres) solo la modifica un administrador.
create policy docs_crear on public.docs for insert to authenticated
  with check (public.mi_rol() = 'admin' or (public.mi_rol() = 'tecnico' and col <> 'config'));
drop policy if exists docs_modificar on public.docs;
create policy docs_modificar on public.docs for update to authenticated
  using (public.mi_rol() = 'admin' or (public.mi_rol() = 'tecnico' and col <> 'config'))
  with check (public.mi_rol() = 'admin' or (public.mi_rol() = 'tecnico' and col <> 'config'));
drop policy if exists docs_borrar on public.docs;
create policy docs_borrar on public.docs for delete to authenticated
  using (public.mi_rol() = 'admin');

-- Actualización parcial: mezcla los campos nuevos con los existentes (como "update" de la app).
create or replace function public.doc_update(p_col text, p_id text, p_patch jsonb)
returns public.docs language plpgsql security invoker set search_path = public as $$
declare r public.docs;
begin
  update public.docs
     set data = data || p_patch, actualizado = now(), actualizado_por = auth.uid()
   where col = p_col and id = p_id
  returning * into r;
  if r is null then
    raise exception 'El documento %/% no existe', p_col, p_id using errcode = 'P0002';
  end if;
  return r;
end $$;

-- Tiempo real: las dos computadoras ven los cambios al instante.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.perfiles;
exception when duplicate_object then null; end $$;

-- ---------- Archivos (manuales en PDF) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('manuales', 'manuales', false, 52428800)
on conflict (id) do nothing;

drop policy if exists manuales_ver on storage.objects;
create policy manuales_ver on storage.objects for select to authenticated
  using (bucket_id = 'manuales' and public.mi_rol() in ('admin','tecnico','lectura'));
drop policy if exists manuales_subir on storage.objects;
create policy manuales_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'manuales' and public.mi_rol() = 'admin');
drop policy if exists manuales_borrar on storage.objects;
create policy manuales_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'manuales' and public.mi_rol() = 'admin');


-- ---------- Órdenes de trabajo: número correlativo y cambios firmados ----------
-- 1) Número de orden de trabajo ascendente (OT-000001, OT-000002, …).
--    Lo asigna la base al crear cada orden, así nunca se repite aunque
--    se carguen dos al mismo tiempo desde distintas computadoras.
create sequence if not exists public.ot_numero_seq;

create or replace function public.asignar_numero_ot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.col = 'ots' and (new.data->>'numero') is null then
    new.data := new.data || jsonb_build_object('numero', nextval('public.ot_numero_seq'));
  end if;
  return new;
end $$;

drop trigger if exists ot_numero on public.docs;
create trigger ot_numero before insert on public.docs
  for each row execute function public.asignar_numero_ot();

-- Numera las órdenes que ya existían, por fecha de reporte.
do $$
declare r record;
begin
  for r in select id from public.docs
           where col = 'ots' and (data->>'numero') is null
           order by data->>'reportado', id
  loop
    update public.docs set data = data || jsonb_build_object('numero', nextval('public.ot_numero_seq'))
     where col = 'ots' and id = r.id;
  end loop;
end $$;

-- 2) Toda modificación de una orden tiene que ir firmada: el programa agrega
--    al historial quién hizo el cambio, y la base verifica que esa persona
--    sea la que inició sesión con su contraseña para ese cambio.
create or replace function public.verificar_firma_ot() returns trigger
language plpgsql set search_path = public as $$
declare
  n_old int := coalesce(jsonb_array_length(old.data->'historial'), 0);
  n_new int := coalesce(jsonb_array_length(new.data->'historial'), 0);
begin
  if new.col <> 'ots' or auth.uid() is null then
    return new;  -- otras colecciones, o cambios hechos a mano desde el panel de Supabase
  end if;
  if n_new <= n_old then
    raise exception 'FIRMA: el cambio de la orden de trabajo tiene que estar firmado por un técnico';
  end if;
  if (new.data->'historial'->(n_new - 1)->>'porId') is distinct from auth.uid()::text then
    raise exception 'FIRMA: la firma no corresponde al usuario que hizo el cambio';
  end if;
  if new.data->>'numero' is distinct from old.data->>'numero' then
    raise exception 'FIRMA: el número de orden de trabajo no se puede cambiar';
  end if;
  return new;
end $$;

drop trigger if exists ot_firma on public.docs;
create trigger ot_firma before update on public.docs
  for each row execute function public.verificar_firma_ot();


-- ---------- Permisos por rol y firma digital ----------
-- ¿Cambió algo fuera de los campos permitidos?
create or replace function public.solo_cambia(o jsonb, n jsonb, permitidos text[]) returns boolean
language sql immutable as $$ select (coalesce(o,'{}'::jsonb) - permitidos) = (coalesce(n,'{}'::jsonb) - permitidos) $$;

-- Qué puede crear cada rol
drop policy if exists docs_crear on public.docs;
create policy docs_crear on public.docs for insert to authenticated
  with check (public.mi_rol() = 'admin'
              or (public.mi_rol() = 'tecnico' and col in ('ots','registros','firmas')));

drop policy if exists docs_modificar on public.docs;
create policy docs_modificar on public.docs for update to authenticated
  using (public.mi_rol() = 'admin' or (public.mi_rol() = 'tecnico' and col in ('ots','registros','tareas','equipos','checklists')))
  with check (public.mi_rol() = 'admin' or (public.mi_rol() = 'tecnico' and col in ('ots','registros','tareas','equipos','checklists')));

-- Reglas detalladas para los técnicos
create or replace function public.reglas_tecnico() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or public.mi_rol() <> 'tecnico' then
    return new;  -- administradores y cambios desde el panel de Supabase
  end if;
  if new.col = 'ots' then
    if old.data->>'estado' in ('Cerrada','Anulada') then
      raise exception 'FIRMA: una orden terminada o anulada solo la modifica un administrador';
    end if;
    if new.data->>'estado' = 'Anulada' then
      raise exception 'FIRMA: solo un administrador puede eliminar (anular) una orden';
    end if;
    if not public.solo_cambia(old.data, new.data, array['estado','historial','inicio','cierre','registroId','estadoAnterior','asignado','tecnicoId','tecnicoNombre','firmaId',
                                                         'desc','tipoFalla','perdida','tEst','urg','porQue','holgura','notas']) then
      raise exception 'FIRMA: el técnico no puede editar los datos de la orden; pedíselo a un administrador';
    end if;
    if coalesce(old.data->>'tecnicoId','') <> '' and (new.data->>'tecnicoId') is distinct from (old.data->>'tecnicoId') then
      raise exception 'FIRMA: el técnico asignado a la orden no se puede cambiar';
    end if;
    if coalesce(old.data->>'asignado','') <> '' and (new.data->>'asignado') is distinct from (old.data->>'asignado') then
      raise exception 'FIRMA: el técnico asignado a la orden no se puede cambiar';
    end if;
  elsif new.col = 'tareas' then
    if not public.solo_cambia(old.data, new.data, array['ultimaFecha','ultimaHoras']) then
      raise exception 'FIRMA: solo un administrador puede modificar las tareas del plan';
    end if;
  elsif new.col = 'equipos' then
    if not public.solo_cambia(old.data, new.data, array['estadoOp','horometro','horometroFecha','horasDia']) then
      raise exception 'FIRMA: solo un administrador puede modificar los datos del equipo';
    end if;
  elsif new.col = 'registros' then
    -- Marcar resuelto un trabajo pendiente: libre
    if public.solo_cambia(old.data, new.data, array['fechaCierre','cierreObs','cierrePorId','parada']) then
      return new;
    end if;
    -- Corregir datos básicos: solo sus propios registros, y dejando constancia firmada del cambio
    if (old.data->>'porId') is distinct from auth.uid()::text then
      raise exception 'FIRMA: solo podés corregir los registros que firmaste vos';
    end if;
    if not public.solo_cambia(old.data, new.data, array['fecha','duracion','parada','resultado','repuestos','obs','causa','solucion','proveedor',
                                                         'fechaCierre','cierreObs','cierrePorId','cambios','editadoPorId','editadoPorNombre','editadoEl']) then
      raise exception 'FIRMA: ese dato del registro solo lo corrige un administrador';
    end if;
    if coalesce(jsonb_array_length(new.data->'cambios'),0) <= coalesce(jsonb_array_length(old.data->'cambios'),0)
       or (new.data->'cambios'->-1->>'porId') is distinct from auth.uid()::text then
      raise exception 'FIRMA: la corrección tiene que quedar registrada con tu firma';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists reglas_tecnico on public.docs;
create trigger reglas_tecnico before update on public.docs
  for each row execute function public.reglas_tecnico();

-- Firma de órdenes: si la orden tiene técnico asignado, solo él (o un administrador) firma los cambios
create or replace function public.verificar_firma_ot() returns trigger
language plpgsql set search_path = public as $$
declare
  n_old int := coalesce(jsonb_array_length(old.data->'historial'), 0);
  n_new int := coalesce(jsonb_array_length(new.data->'historial'), 0);
begin
  if new.col <> 'ots' or auth.uid() is null then
    return new;
  end if;
  if n_new <= n_old then
    raise exception 'FIRMA: el cambio de la orden de trabajo tiene que estar firmado por un técnico';
  end if;
  if (new.data->'historial'->(n_new - 1)->>'porId') is distinct from auth.uid()::text then
    raise exception 'FIRMA: la firma no corresponde al usuario que hizo el cambio';
  end if;
  if new.data->>'numero' is distinct from old.data->>'numero' then
    raise exception 'FIRMA: el número de orden de trabajo no se puede cambiar';
  end if;
  if coalesce(old.data->>'tecnicoId','') <> '' and old.data->>'tecnicoId' <> auth.uid()::text and public.mi_rol() <> 'admin' then
    raise exception 'FIRMA: la orden está asignada a %; solo esa persona o un administrador pueden firmarla', coalesce(old.data->>'tecnicoNombre','otro técnico');
  end if;
  return new;
end $$;

-- Las firmas digitales no se modifican: si alguien cambia su firma se guarda una nueva
-- (los remitos anteriores conservan la firma con la que se firmaron).
create or replace function public.firmas_inmutables() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.col = 'firmas' and auth.uid() is not null then
    raise exception 'FIRMA: las firmas guardadas no se modifican';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists firmas_inmutables on public.docs;
create trigger firmas_inmutables before update or delete on public.docs
  for each row execute function public.firmas_inmutables();

-- Cada usuario solo puede guardar su propia firma
create or replace function public.firma_propia() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.col = 'firmas' and auth.uid() is not null and (new.data->>'userId') is distinct from auth.uid()::text then
    raise exception 'FIRMA: cada usuario carga solo su propia firma';
  end if;
  return new;
end $$;
drop trigger if exists firma_propia on public.docs;
create trigger firma_propia before insert on public.docs
  for each row execute function public.firma_propia();
