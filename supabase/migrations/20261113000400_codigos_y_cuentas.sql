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
  update auth.users set banned_until = case when p_activo then null else 'infinity'::timestamptz end where id = p_cuenta;
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
