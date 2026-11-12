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
