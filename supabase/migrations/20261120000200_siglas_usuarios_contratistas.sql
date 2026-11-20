-- =====================================================================
-- App de mantenimiento · 14 · Siglas, eliminar usuarios y contratistas cargados a mano (20/11/2026)
--   · La sigla de una empresa se puede cambiar si la empresa no tiene equipos activos (los dados de
--     baja conservan su código viejo). La numeración de los códigos sigue por sigla y tipo.
--   · Un usuario dado de baja se puede eliminar: si nunca cargó ni tuvo asignado nada se borra del todo;
--     si tiene historia, desaparece de la lista y libera su usuario, pero su nombre queda en el historial.
--   · El jefe y el encargado pueden cargar proveedores y contratistas nuevos (al crear una orden, etc.).
-- Se puede correr más de una vez.
-- =====================================================================

-- ---------- Siglas ----------
create or replace function public.sigla_fija() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sigla is distinct from old.sigla and exists (select 1 from public.equipos where empresa_duena_id = old.id and estado <> 'baja') then
    raise exception 'La sigla % ya está en códigos de equipos activos y no se puede cambiar. (Se puede cambiar cuando la empresa no tiene equipos activos.)', old.sigla using errcode = '42501';
  end if;
  return new;
end $$;

-- El código (SIGLA-TIPO-NNN) es único; el número ya no es único por empresa y tipo, porque al cambiar
-- la sigla los equipos nuevos vuelven a empezar en 001 (los dados de baja conservan su código viejo)
alter table public.equipos drop constraint if exists equipos_empresa_duena_id_tipo_numero_key;

-- Código del equipo: el número sigue por sigla y tipo (si la sigla cambió, los equipos nuevos empiezan en 001)
create or replace function public.codigo_equipo() returns trigger
language plpgsql security definer set search_path = public as $$
declare sig text;
begin
  if tg_op = 'INSERT' then
    select sigla into sig from public.empresas where id = new.empresa_duena_id;
    perform pg_advisory_xact_lock(hashtext('equipo:' || sig || ':' || new.tipo));
    if new.numero is null or auth.uid() is not null then
      select coalesce(max(numero), 0) + 1 into new.numero from public.equipos
        where codigo like sig || '-' || new.tipo || '-%';
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

-- ---------- Eliminar usuarios ----------
alter table public.usuarios add column if not exists eliminado boolean not null default false;

-- Los usuarios solo se borran con eliminar_usuario() (o con el borrado de los datos de ejemplo)
create or replace function public.no_se_borra() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null and current_setting('planta.borrar_ejemplo', true) = '1' then return old; end if;
  if tg_table_name = 'usuarios' and current_setting('planta.borrar_usuario', true) = old.id::text then return old; end if;
  raise exception 'Los registros de % no se borran: se dan de baja o se desactivan.', tg_table_name using errcode = '42501';
end $$;

create or replace function public.eliminar_usuario(p_id uuid) returns text
language plpgsql security definer set search_path = public, auth as $$
declare u public.usuarios; historia boolean; alias text;
begin
  if not public.es('jefe') then perform public._error('Los usuarios los elimina el jefe de mantenimiento.'); end if;
  if p_id = auth.uid() then perform public._error('No podés eliminarte a vos mismo.'); end if;
  select * into u from public.usuarios where id = p_id and not eliminado;
  if u.id is null then perform public._error('No existe el usuario.'); end if;
  if u.activo then perform public._error('Primero dalo de baja; después se puede eliminar.'); end if;
  if u.perfil = 'jefe' and not exists (select 1 from public.usuarios where perfil = 'jefe' and activo and id <> p_id) then
    perform public._error('Tiene que quedar al menos un jefe de mantenimiento activo.');
  end if;
  historia := exists (select 1 from public.reportes_falla where operario_id = p_id or creado_por = p_id)
    or exists (select 1 from public.ordenes where asignado_a = p_id or prioridad_por = p_id or creado_por = p_id)
    or exists (select 1 from public.fichas where tecnico_id = p_id or creado_por = p_id)
    or exists (select 1 from public.costos_orden where creado_por = p_id)
    or exists (select 1 from public.pedidos_compra where creado_por = p_id or resuelto_por = p_id)
    or exists (select 1 from public.movimientos_equipo where creado_por = p_id or resuelto_por = p_id)
    or exists (select 1 from public.adjuntos where creado_por = p_id)
    or exists (select 1 from public.documentos where creado_por = p_id)
    or exists (select 1 from public.equipos where creado_por = p_id);
  if not historia then
    begin
      delete from public.avisos where usuario_id = p_id;
      perform set_config('planta.borrar_usuario', p_id::text, true);
      delete from public.usuarios where id = p_id;
      delete from auth.users where id = p_id;
      perform set_config('planta.borrar_usuario', '', true);
      return 'borrado';
    exception when foreign_key_violation then
      null;   -- algo lo referencia: se archiva como abajo
    end;
  end if;
  -- Con historia: deja de figurar, no puede ingresar y libera su usuario; el nombre queda en el historial
  alias := 'eliminado.' || left(replace(p_id::text, '-', ''), 10);
  update public.usuarios set eliminado = true, activo = false, usuario = alias where id = p_id;
  update auth.users set email = public._email_de(alias), banned_until = '2999-12-31'::timestamptz, updated_at = now() where id = p_id;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', public._email_de(alias)) where user_id = p_id and provider = 'email';
  delete from auth.sessions where user_id = p_id;
  delete from public.push_suscripciones where usuario_id = p_id;
  delete from public.usuario_empresas where usuario_id = p_id;
  return 'archivado';
end $$;
revoke execute on function public.eliminar_usuario(uuid) from public, anon;
grant execute on function public.eliminar_usuario(uuid) to authenticated;

-- Un usuario eliminado no se reactiva
create or replace function public.estado_usuario(p_id uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.es('jefe') or p_id = auth.uid() then perform public._error('No podés cambiar el estado de ese usuario.'); end if;
  if p_activo and exists (select 1 from public.usuarios where id = p_id and eliminado) then perform public._error('Ese usuario fue eliminado: creá uno nuevo.'); end if;
  update public.usuarios set activo = p_activo where id = p_id;
  if not found then perform public._error('No existe el usuario.'); end if;
  update auth.users set banned_until = case when p_activo then null else '2999-12-31'::timestamptz end where id = p_id;
  if not p_activo then delete from auth.sessions where user_id = p_id; end if;
end $$;

-- ---------- Proveedores y contratistas: los cargan el jefe y el encargado ----------
select public._politica('crear', 'proveedores', 'insert', null, 'public.es(''jefe'',''encargado'')');
