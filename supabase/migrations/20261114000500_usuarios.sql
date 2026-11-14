-- =====================================================================
-- App de mantenimiento · 5 · Usuarios: alta, edición, contraseña, activar y desactivar
-- Los administra el jefe de mantenimiento. Se ingresa con USUARIO: en Supabase Auth se guarda
-- como usuario@cuentas.mantenimiento.app (nunca recibe correos).
-- =====================================================================
create or replace function public._email_de(usuario text) returns text
language sql immutable as $$ select lower(btrim(usuario)) || '@cuentas.mantenimiento.app' $$;

create or replace function public._crear_auth(p_id uuid, p_email text, p_clave text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if length(coalesce(p_clave, '')) < 8 then raise exception 'La contraseña tiene que tener al menos 8 caracteres.'; end if;
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

create or replace function public._empresas_de(p_usuario uuid, p_empresas uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.usuario_empresas where usuario_id = p_usuario;
  insert into public.usuario_empresas (usuario_id, empresa_id)
    select p_usuario, e from unnest(coalesce(p_empresas, '{}')) e where exists (select 1 from public.empresas where id = e)
    on conflict do nothing;
end $$;

create or replace function public._crear_usuario(p_usuario text, p_nombre text, p_perfil text, p_clave text,
  p_telefono text, p_empresas uuid[], p_ejemplo boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare u text := lower(btrim(coalesce(p_usuario, ''))); nid uuid := gen_random_uuid();
begin
  if u !~ '^[a-z0-9._-]{3,30}$' then raise exception 'El usuario tiene que tener de 3 a 30 letras minúsculas, números, punto o guion.'; end if;
  if exists (select 1 from public.usuarios where usuario = u) or exists (select 1 from auth.users where email = public._email_de(u)) then
    raise exception 'Ese usuario ya existe.';
  end if;
  if length(btrim(coalesce(p_nombre, ''))) < 2 then raise exception 'Escribí el nombre y apellido.'; end if;
  if p_perfil not in ('jefe','encargado','tecnico','operario','direccion') then raise exception 'Perfil desconocido.'; end if;
  if p_perfil <> 'jefe' and coalesce(array_length(p_empresas, 1), 0) = 0 then raise exception 'Elegí al menos una empresa.'; end if;
  perform public._crear_auth(nid, public._email_de(u), p_clave);
  insert into public.usuarios (id, usuario, nombre, perfil, telefono, ejemplo) values (nid, u, btrim(p_nombre), p_perfil, nullif(btrim(p_telefono), ''), p_ejemplo);
  perform public._empresas_de(nid, case when p_perfil = 'jefe' then array(select id from public.empresas) else p_empresas end);
  return nid;
end $$;

create or replace function public.crear_usuario(p_usuario text, p_nombre text, p_perfil text, p_clave text, p_telefono text, p_empresas uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe') then perform public._error('Los usuarios los crea el jefe de mantenimiento.'); end if;
  return public._crear_usuario(p_usuario, p_nombre, p_perfil, p_clave, p_telefono, p_empresas);
end $$;

create or replace function public.editar_usuario(p_id uuid, p_nombre text, p_perfil text, p_telefono text, p_empresas uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe') then perform public._error('Los usuarios los edita el jefe de mantenimiento.'); end if;
  if p_id = auth.uid() and p_perfil <> 'jefe' then perform public._error('No podés quitarte el perfil de jefe.'); end if;
  if p_perfil not in ('jefe','encargado','tecnico','operario','direccion') then perform public._error('Perfil desconocido.'); end if;
  if p_perfil <> 'jefe' and coalesce(array_length(p_empresas, 1), 0) = 0 then perform public._error('Elegí al menos una empresa.'); end if;
  update public.usuarios set nombre = btrim(p_nombre), perfil = p_perfil, telefono = nullif(btrim(p_telefono), '') where id = p_id;
  if not found then perform public._error('No existe el usuario.'); end if;
  perform public._empresas_de(p_id, case when p_perfil = 'jefe' then array(select id from public.empresas) else p_empresas end);
end $$;

create or replace function public.restablecer_clave(p_id uuid, p_clave text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.es('jefe') or p_id = auth.uid() then perform public._error('No podés cambiar la contraseña de ese usuario (la tuya se cambia en «Mi cuenta»).'); end if;
  if length(coalesce(p_clave, '')) < 8 then perform public._error('La contraseña tiene que tener al menos 8 caracteres.'); end if;
  update auth.users set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), updated_at = now() where id = p_id;
  delete from auth.sessions where user_id = p_id;
  update public.usuarios set modificado_en = now() where id = p_id;
end $$;

-- Desactivar o reactivar (los usuarios no se borran). Al desactivar se cierran sus sesiones.
create or replace function public.estado_usuario(p_id uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.es('jefe') or p_id = auth.uid() then perform public._error('No podés cambiar el estado de ese usuario.'); end if;
  update public.usuarios set activo = p_activo where id = p_id;
  if not found then perform public._error('No existe el usuario.'); end if;
  update auth.users set banned_until = case when p_activo then null else '2999-12-31'::timestamptz end where id = p_id;
  if not p_activo then delete from auth.sessions where user_id = p_id; end if;
end $$;

-- Mi cuenta: cambiar la propia contraseña confirmando la actual
create or replace function public.cambiar_mi_clave(p_actual text, p_nueva text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if public.mi_perfil() is null then perform public._error('Tu usuario no está activo.'); end if;
  if not exists (select 1 from auth.users where id = auth.uid() and encrypted_password = extensions.crypt(coalesce(p_actual, ''), encrypted_password)) then
    raise exception 'La contraseña actual no es correcta.';
  end if;
  if length(coalesce(p_nueva, '')) < 8 then raise exception 'La contraseña nueva tiene que tener al menos 8 caracteres.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_nueva, extensions.gen_salt('bf', 10)), updated_at = now() where id = auth.uid();
  update public.usuarios set modificado_en = now() where id = auth.uid();
end $$;

-- Primera cuenta del jefe de mantenimiento: una sola vez, desde el SQL Editor (supabase/primera-cuenta.sql)
create or replace function public.primera_cuenta_jefe(p_usuario text, p_nombre text, p_clave text, p_telefono text default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.usuarios where perfil = 'jefe' and activo and not ejemplo) then
    raise exception 'Ya hay un jefe de mantenimiento activo. Los demás usuarios se crean desde la app (Usuarios).';
  end if;
  perform public._crear_usuario(p_usuario, p_nombre, 'jefe', p_clave, p_telefono, null);
  if coalesce(p_telefono, '') <> '' then
    update public.config set valor = to_jsonb(p_telefono) where clave = 'telefono_mantenimiento' and valor = '""';
  end if;
  return 'Listo. Ingresá a la app con el usuario «' || lower(btrim(p_usuario)) || '».';
end $$;
