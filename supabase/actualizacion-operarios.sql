-- =====================================================================
-- Actualización: avisos de operarios (código de planta) y bandeja de avisos
-- Pegar en Supabase → SQL Editor → New query → Run (una sola vez).
-- Se puede volver a ejecutar sin problemas.
--
-- Los operarios no tienen cuenta: ingresan con el código de su planta y su
-- nombre. Solo pueden (1) ver los equipos de su planta y (2) enviar avisos de
-- anomalía con fotos o audio. Todo pasa por funciones que validan el código.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Códigos de planta (guardados cifrados, nunca en texto)
create table if not exists public.codigos_operario (
  empresa     text primary key,
  hash        text not null,
  actualizado timestamptz not null default now()
);
alter table public.codigos_operario enable row level security;  -- sin políticas: solo vía funciones

-- Intentos fallidos (protección contra adivinar el código)
create table if not exists public.operario_intentos (
  id bigserial primary key,
  ts timestamptz not null default now()
);
alter table public.operario_intentos enable row level security;

-- Fotos y audios de los avisos (aparte, para no cargar todo de entrada)
create table if not exists public.avisos_fotos (
  id       bigserial primary key,
  aviso_id text not null,
  tipo     text not null default 'foto',
  data     text not null,
  creado   timestamptz not null default now()
);
create index if not exists avisos_fotos_aviso on public.avisos_fotos (aviso_id);
alter table public.avisos_fotos enable row level security;
drop policy if exists avisos_fotos_ver on public.avisos_fotos;
create policy avisos_fotos_ver on public.avisos_fotos for select to authenticated
  using (public.mi_rol() in ('admin','tecnico','lectura'));
drop policy if exists avisos_fotos_borrar on public.avisos_fotos;
create policy avisos_fotos_borrar on public.avisos_fotos for delete to authenticated
  using (public.mi_rol() = 'admin');

create sequence if not exists public.aviso_numero_seq;

-- El técnico también puede actualizar avisos (convertirlos en orden o descartarlos)
drop policy if exists docs_modificar on public.docs;
create policy docs_modificar on public.docs for update to authenticated
  using (public.mi_rol() = 'admin' or (public.mi_rol() = 'tecnico' and col in ('ots','registros','tareas','equipos','checklists','avisos')))
  with check (public.mi_rol() = 'admin' or (public.mi_rol() = 'tecnico' and col in ('ots','registros','tareas','equipos','checklists','avisos')));

-- ---------- Administración de códigos (solo administrador) ----------
create or replace function public.set_codigo_operario(p_empresa text, p_codigo text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador puede cambiar los códigos de planta'; end if;
  if p_codigo is null or p_codigo !~ '^[0-9A-Za-z]{4,12}$' then raise exception 'El código tiene que tener entre 4 y 12 letras o números'; end if;
  if exists (select 1 from public.codigos_operario c where c.empresa <> p_empresa and extensions.crypt(p_codigo, c.hash) = c.hash) then
    raise exception 'Ese código ya lo usa otra planta';
  end if;
  insert into public.codigos_operario (empresa, hash, actualizado)
  values (p_empresa, extensions.crypt(p_codigo, extensions.gen_salt('bf')), now())
  on conflict (empresa) do update set hash = excluded.hash, actualizado = now();
end $$;

create or replace function public.estado_codigos_operario() returns table (empresa text, actualizado timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador'; end if;
  return query select c.empresa, c.actualizado from public.codigos_operario c order by c.empresa;
end $$;

create or replace function public.borrar_codigo_operario(p_empresa text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador'; end if;
  delete from public.codigos_operario where empresa = p_empresa;
end $$;

-- ---------- Validación del código (uso interno) ----------
create or replace function public._empresa_de_codigo(p_codigo text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare e text;
begin
  if (select count(*) from public.operario_intentos where ts > now() - interval '10 minutes') >= 30 then
    raise exception 'Demasiados intentos con códigos incorrectos. Esperá unos minutos.';
  end if;
  select c.empresa into e from public.codigos_operario c where extensions.crypt(coalesce(p_codigo,''), c.hash) = c.hash limit 1;
  if e is null then
    insert into public.operario_intentos default values;
    delete from public.operario_intentos where ts < now() - interval '1 day';
    raise exception 'Código de planta incorrecto';
  end if;
  return e;
end $$;
revoke all on function public._empresa_de_codigo(text) from public, anon, authenticated;

-- ---------- Ingreso del operario: devuelve su planta y sus equipos ----------
create or replace function public.operario_ingresar(p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text;
begin
  e := public._empresa_de_codigo(p_codigo);
  return jsonb_build_object(
    'empresa', e,
    'config', (select d.data from public.docs d where d.col = 'config' and d.id = 'codigos'),
    'equipos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'codigo', d.data->>'codigo', 'nombre', d.data->>'nombre', 'area', d.data->>'area',
        'tipo', d.data->>'tipo', 'numero', d.data->'numero', 'idActivo', d.data->>'idActivo',
        'codigosAnteriores', coalesce(d.data->'codigosAnteriores','[]'::jsonb), 'ubicacion', d.data->>'ubicacion')
        order by d.data->>'codigo')
      from public.docs d where d.col = 'equipos' and d.data->>'empresa' = e and coalesce(d.data->>'estado','Activo') <> 'Baja'), '[]'::jsonb));
end $$;

-- ---------- Enviar un aviso de anomalía ----------
create or replace function public.reportar_anomalia(p_codigo text, p_nombre text, p_equipo_id text, p_datos jsonb, p_adjuntos jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  e text; eq jsonb; n bigint; aid text; adj jsonb; nombre text := btrim(coalesce(p_nombre,''));
begin
  e := public._empresa_de_codigo(p_codigo);
  if length(nombre) < 2 or length(nombre) > 60 then raise exception 'Escribí tu nombre'; end if;
  select d.data into eq from public.docs d where d.col = 'equipos' and d.id = p_equipo_id;
  if eq is null or eq->>'empresa' <> e then raise exception 'El equipo no corresponde a tu planta'; end if;
  if length(coalesce(p_datos->>'descripcion','')) > 1500 then raise exception 'La descripción es demasiado larga'; end if;
  if jsonb_array_length(coalesce(p_datos->'sintomas','[]'::jsonb)) > 15 then raise exception 'Demasiados síntomas'; end if;
  if jsonb_array_length(coalesce(p_adjuntos,'[]'::jsonb)) > 4 then raise exception 'Máximo 3 fotos y 1 audio'; end if;
  if (select count(*) from public.docs d where d.col = 'avisos' and d.data->>'empresa' = e and d.actualizado > now() - interval '1 hour') >= 60 then
    raise exception 'Se recibieron demasiados avisos en la última hora. Avisale a mantenimiento directamente.';
  end if;
  if exists (select 1 from public.docs d where d.col = 'avisos' and d.data->>'equipoId' = p_equipo_id and lower(d.data->>'operario') = lower(nombre)
             and d.actualizado > now() - interval '3 minutes') then
    raise exception 'Ya enviaste un aviso de este equipo hace un momento';
  end if;
  for adj in select * from jsonb_array_elements(coalesce(p_adjuntos,'[]'::jsonb)) loop
    if length(coalesce(adj->>'data','')) > 900000 then raise exception 'Una de las fotos o el audio es demasiado grande'; end if;
  end loop;

  n := nextval('public.aviso_numero_seq');
  aid := 'av-' || n;
  insert into public.docs (col, id, data, actualizado_por) values ('avisos', aid, jsonb_build_object(
    'numero', n, 'equipoId', p_equipo_id, 'equipoCodigo', eq->>'codigo', 'empresa', e, 'operario', nombre,
    'sintomas', coalesce(p_datos->'sintomas','[]'::jsonb), 'descripcion', coalesce(p_datos->>'descripcion',''),
    'funcionamiento', coalesce(p_datos->>'funcionamiento',''), 'fecha', now(), 'estado', 'Nuevo',
    'fotos', (select count(*) from jsonb_array_elements(coalesce(p_adjuntos,'[]'::jsonb)) x where x->>'tipo' = 'foto'),
    'audio', exists (select 1 from jsonb_array_elements(coalesce(p_adjuntos,'[]'::jsonb)) x where x->>'tipo' = 'audio')), null);
  insert into public.avisos_fotos (aviso_id, tipo, data)
    select aid, coalesce(x->>'tipo','foto'), x->>'data' from jsonb_array_elements(coalesce(p_adjuntos,'[]'::jsonb)) x;
  return 'R-' || lpad(n::text, 4, '0');
end $$;

grant execute on function public.operario_ingresar(text) to anon, authenticated;
grant execute on function public.reportar_anomalia(text, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.set_codigo_operario(text, text) to authenticated;
grant execute on function public.estado_codigos_operario() to authenticated;
grant execute on function public.borrar_codigo_operario(text) to authenticated;

-- El técnico solo revisa avisos nuevos: cambia el estado, nunca lo que escribió el operario
create or replace function public.reglas_avisos() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.col <> 'avisos' or auth.uid() is null or public.mi_rol() <> 'tecnico' then
    return new;
  end if;
  if old.data->>'estado' <> 'Nuevo' then
    raise exception 'FIRMA: ese aviso ya fue revisado; solo un administrador lo puede cambiar';
  end if;
  if not public.solo_cambia(old.data, new.data, array['estado','otId','motivo','revisadoPorId','revisadoPorNombre','revisadoEl']) then
    raise exception 'FIRMA: lo que reportó el operario no se puede modificar';
  end if;
  if new.data->>'revisadoPorId' is distinct from auth.uid()::text then
    raise exception 'FIRMA: la revisión del aviso tiene que quedar a tu nombre';
  end if;
  return new;
end $$;
drop trigger if exists reglas_avisos on public.docs;
create trigger reglas_avisos before update on public.docs
  for each row execute function public.reglas_avisos();
