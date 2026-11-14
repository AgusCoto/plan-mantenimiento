-- =====================================================================
-- App de mantenimiento · 6 · Registro de cambios
-- Lo llenan triggers: quién, cuándo, qué cambió (valor anterior y nuevo) y quién aprobó.
-- También los ingresos y los conflictos de sincronización. Nadie lo puede editar ni borrar.
-- =====================================================================
create table if not exists public.registro_cambios (
  id           bigint generated always as identity primary key,
  ts           timestamptz not null default now(),
  usuario_id   uuid,
  nombre       text not null default 'Sistema',
  perfil       text,
  operacion    text not null check (operacion in ('alta','modificacion','baja','ingreso','conflicto')),
  tabla        text not null,
  registro     text,
  resumen      text not null,
  cambios      jsonb,
  aprobo_id    uuid,
  aprobo_nombre text
);
create index if not exists registro_ts on public.registro_cambios (ts desc);
create index if not exists registro_tabla on public.registro_cambios (tabla, registro);
create index if not exists registro_usuario on public.registro_cambios (usuario_id, ts desc);

create or replace function public.registro_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception 'El registro de cambios no se puede modificar ni borrar.' using errcode = '42501';
end $$;
drop trigger if exists inmutable on public.registro_cambios;
create trigger inmutable before update or delete on public.registro_cambios for each row execute function public.registro_inmutable();
drop trigger if exists inmutable_truncate on public.registro_cambios;
create trigger inmutable_truncate before truncate on public.registro_cambios for each statement execute function public.registro_inmutable();
revoke update, delete, truncate on public.registro_cambios from anon, authenticated, service_role;

-- Cómo se nombra cada registro
create or replace function public._etiqueta(tabla text, r jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case tabla
    when 'equipos'            then 'el equipo ' || (r->>'codigo') || ' «' || (r->>'nombre') || '»'
    when 'ordenes'            then 'la orden OT-' || lpad(r->>'numero', 4, '0') || ' «' || (r->>'titulo') || '»'
    when 'pedidos_compra'     then 'el pedido de compra PC-' || lpad(r->>'numero', 4, '0') || ' «' || (r->>'descripcion') || '»'
    when 'fichas'             then case when (r->>'es_cierre')::boolean then 'la ficha de cierre' else 'una ficha de trabajo' end || ' de la OT-'
                                   || coalesce((select lpad(numero::text, 4, '0') from public.ordenes where id = (r->>'orden_id')::uuid), '?')
    when 'costos_orden'       then 'el costo «' || (r->>'descripcion') || '» de la OT-' || coalesce((select lpad(numero::text, 4, '0') from public.ordenes where id = (r->>'orden_id')::uuid), '?')
    when 'reportes_falla'     then 'un reporte de falla en ' || coalesce((select codigo from public.equipos where id = (r->>'equipo_id')::uuid), '?')
    when 'movimientos_equipo' then case r->>'tipo' when 'prestamo' then 'el préstamo' when 'reparacion_externa' then 'la reparación externa'
                                   when 'baja' then 'la baja' else 'la reubicación' end || ' de ' || coalesce((select codigo from public.equipos where id = (r->>'equipo_id')::uuid), '?')
    when 'documentos'         then 'el documento «' || (r->>'nombre') || '» de ' || coalesce((select codigo from public.equipos where id = (r->>'equipo_id')::uuid), '?')
    when 'adjuntos'           then 'un archivo (' || (r->>'tipo') || ')'
    when 'usuarios'           then 'el usuario ' || (r->>'nombre') || ' (' || (r->>'usuario') || ')'
    when 'usuario_empresas'   then 'el acceso de ' || coalesce((select nombre from public.usuarios where id = (r->>'usuario_id')::uuid), '?')
                                   || ' a ' || coalesce((select sigla from public.empresas where id = (r->>'empresa_id')::uuid), '?')
    when 'empresas'           then 'la empresa ' || (r->>'sigla')
    when 'areas'              then 'el área «' || (r->>'nombre') || '»'
    when 'tipos_equipo'       then 'el tipo de equipo ' || (r->>'sigla') || ' «' || (r->>'nombre') || '»'
    when 'listas'             then 'la opción «' || (r->>'nombre') || '» de ' || replace(r->>'lista', '_', ' ')
    when 'proveedores'        then 'el proveedor «' || (r->>'nombre') || '»'
    when 'config'             then 'el parámetro ' || (r->>'clave')
    when 'temas'              then 'la apariencia (versión ' || (r->>'version') || ')'
    else tabla end
$$;

create or replace function public.registrar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a jsonb; b jsonb; dif jsonb := '{}'::jsonb; k text; op text; res text; apr uuid; u public.usuarios;
  ignorar text[] := array['creado_por','creado_en','modificado_por','modificado_en'];
  clave text := tg_argv[0];
begin
  -- Cargas masivas desde el SQL Editor (migración, datos de ejemplo): se anota un solo resumen aparte
  if auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' then return null; end if;
  if tg_op = 'INSERT' then
    b := to_jsonb(new) - ignorar; op := 'alta'; dif := b;
    res := case tg_table_name when 'reportes_falla' then 'Envió ' when 'fichas' then 'Cargó ' when 'costos_orden' then 'Cargó '
             when 'adjuntos' then 'Adjuntó ' when 'usuario_empresas' then 'Dio ' when 'temas' then 'Guardó '
             when 'movimientos_equipo' then 'Registró ' when 'pedidos_compra' then 'Pidió ' else 'Dio de alta ' end
           || public._etiqueta(tg_table_name, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    a := to_jsonb(old) - ignorar; b := to_jsonb(new) - ignorar;
    for k in select key from jsonb_each(b) loop
      if (a -> k) is distinct from (b -> k) then dif := dif || jsonb_build_object(k, jsonb_build_array(a -> k, b -> k)); end if;
    end loop;
    if dif = '{}'::jsonb then
      if tg_table_name = 'usuarios' then op := 'modificacion'; dif := null; res := 'Cambió la contraseña de ' || public._etiqueta(tg_table_name, b);
      else return null; end if;
    else
      op := 'modificacion';
      res := case
        when tg_table_name = 'usuarios' and dif ? 'activo' then case when (b->>'activo')::boolean then 'Activó ' else 'Desactivó ' end
        when tg_table_name = 'equipos' and dif ? 'estado' and b->>'estado' = 'baja' then 'Dio de baja '
        when tg_table_name = 'equipos' and (dif ? 'empresa_ubicacion_id' or dif ? 'area_id' or dif ? 'ubicacion') then 'Movió '
        when tg_table_name = 'equipos' and dif ? 'estado' then 'Cambió a «' || replace(b->>'estado', '_', ' ') || '» '
        when tg_table_name = 'ordenes' and dif ? 'prioridad' then 'Fijó la prioridad «' || (b->>'prioridad') || '» de '
        when tg_table_name = 'ordenes' and dif ? 'estado' then 'Pasó a «' || replace(b->>'estado', '_', ' ') || '» '
        when tg_table_name = 'pedidos_compra' and dif ? 'estado' then case b->>'estado' when 'aprobado' then 'Aprobó ' when 'rechazado' then 'Rechazó '
                                                                     when 'recibido' then 'Recibió ' else 'Modificó ' end
        when tg_table_name = 'movimientos_equipo' and dif ? 'estado' then case b->>'estado' when 'aprobado' then 'Aprobó ' when 'rechazado' then 'Rechazó '
                                                                     when 'en_curso' then 'Registró la salida en ' when 'cerrado' then 'Cerró ' else 'Modificó ' end
        when tg_table_name = 'reportes_falla' and dif ? 'estado' then case b->>'estado' when 'descartado' then 'Descartó ' else 'Pasó a orden ' end
        when tg_table_name = 'temas' and dif ? 'activo' and (b->>'activo')::boolean then 'Aplicó '
        else 'Modificó ' end
        || public._etiqueta(tg_table_name, to_jsonb(new));
    end if;
  else
    a := to_jsonb(old) - ignorar; op := 'baja'; dif := a;
    res := 'Quitó ' || public._etiqueta(tg_table_name, to_jsonb(old));
  end if;
  apr := nullif(current_setting('planta.aprobo_id', true), '')::uuid;
  select * into u from public.usuarios where id = auth.uid();
  insert into public.registro_cambios (usuario_id, nombre, perfil, operacion, tabla, registro, resumen, cambios, aprobo_id, aprobo_nombre)
  values (auth.uid(), coalesce(u.nombre, case when auth.uid() is null then 'Sistema' else 'Usuario sin perfil' end), u.perfil, op,
          tg_table_name, coalesce(b, a) ->> clave, res, dif, apr, public._nombre(apr));
  return null;
end $$;

do $$
declare t record;
begin
  for t in select * from (values
    ('empresas','id'), ('usuarios','id'), ('usuario_empresas','usuario_id'), ('areas','id'), ('tipos_equipo','sigla'),
    ('listas','clave'), ('config','clave'), ('temas','version'), ('proveedores','id'), ('equipos','codigo'), ('documentos','id'),
    ('movimientos_equipo','id'), ('reportes_falla','id'), ('ordenes','id'), ('fichas','id'), ('costos_orden','id'),
    ('pedidos_compra','id'), ('adjuntos','id')) as x(tabla, clave)
  loop
    execute format('drop trigger if exists z_registrar on public.%I', t.tabla);
    execute format('create trigger z_registrar after insert or update or delete on public.%I for each row execute function public.registrar(%L)', t.tabla, t.clave);
  end loop;
end $$;

-- Ingresos: cada inicio de sesión crea una fila en auth.sessions (no depende de la app)
create or replace function public.registrar_ingreso() returns trigger
language plpgsql security definer set search_path = public as $$
declare u public.usuarios;
begin
  select * into u from public.usuarios where id = new.user_id;
  insert into public.registro_cambios (usuario_id, nombre, perfil, operacion, tabla, registro, resumen)
  values (new.user_id, coalesce(u.nombre, 'Usuario sin perfil'), u.perfil, 'ingreso', 'sesion', new.user_id::text, 'Ingresó a la app');
  return null;
exception when others then
  return null;  -- un problema al anotar nunca impide el ingreso
end $$;
do $$ begin
  execute 'drop trigger if exists planta_ingreso on auth.sessions';
  execute 'create trigger planta_ingreso after insert on auth.sessions for each row execute function public.registrar_ingreso()';
exception when insufficient_privilege then
  raise notice 'AVISO: no se pudo crear el registro de ingresos en auth.sessions (permiso). El resto funciona igual.';
end $$;

-- Conflictos de sincronización (cargas sin señal): la app los informa y quedan registrados
create or replace function public.registrar_conflicto(p_tabla text, p_registro text, p_detalle jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u public.usuarios;
begin
  select * into u from public.usuarios where id = auth.uid() and activo;
  if u.id is null then perform public._error('Usuario no activo.'); end if;
  insert into public.registro_cambios (usuario_id, nombre, perfil, operacion, tabla, registro, resumen, cambios)
  values (u.id, u.nombre, u.perfil, 'conflicto', left(p_tabla, 40), left(p_registro, 80),
          'Conflicto al sincronizar ' || replace(left(p_tabla, 40), '_', ' ') || ': se guardó la última modificación', p_detalle);
end $$;
