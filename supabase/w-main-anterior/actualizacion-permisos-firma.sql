-- =====================================================================
-- Actualización: permisos por rol y firma digital
-- Pegar en Supabase → SQL Editor → New query → Run (una sola vez).
-- Se puede volver a ejecutar sin problemas.
--
-- Roles:
--   Administrador (gerente de mantenimiento): acceso total.
--   Técnico: reporta fallas, genera órdenes, las avanza y las finaliza con su
--     firma. Puede corregir datos básicos de SUS órdenes y SUS registros, siempre
--     identificándose; cada cambio queda guardado (antes → después, quién y cuándo).
--     No puede anular órdenes, cambiar el técnico asignado, ni modificar tareas
--     del plan, equipos (salvo horómetro y estado), configuración ni usuarios.
--   Directivo (rol 'lectura'): solo consulta.
-- =====================================================================

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
