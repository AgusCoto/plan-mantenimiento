-- =====================================================================
-- App de mantenimiento · 15 · Plan de preventivos y nombres de W-Main (20/11/2026)
--   · Preventivos: tareas por equipo cada N días, semanas, meses, años u horas de uso.
--     Estado: vencida, próxima, al día o sin datos. El jefe arma y cambia el plan; el jefe y el
--     encargado generan la orden (o registran que se hizo). Al terminar la orden, la tarea queda al día.
--   · Avisos diarios: también los preventivos vencidos (al jefe y a los encargados de la empresa).
--   · Nombres: la app pasa a llamarse W-Main y el perfil del jefe, «Gerente de mantenimiento».
-- Se puede correr más de una vez.
-- =====================================================================

-- ---------- Tareas preventivas ----------
create table if not exists public.preventivos (
  id           uuid primary key default gen_random_uuid(),
  equipo_id    uuid not null references public.equipos(id) on delete cascade,   -- solo se borra junto con los datos de ejemplo
  titulo       text not null check (length(btrim(titulo)) between 2 and 200),
  descripcion  text,                                   -- pasos, puntos a revisar
  frecuencia   int not null check (frecuencia between 1 and 100000),
  unidad       text not null check (unidad in ('dias','semanas','meses','anios','horas')),
  aviso_dias   int not null default 7 check (aviso_dias between 0 and 365),        -- cuántos días antes pasa a «próxima»
  aviso_horas  numeric(10,1) not null default 50 check (aviso_horas >= 0),          -- ídem, para las tareas por horas de uso
  ultima_fecha date,                                   -- la última vez que se hizo
  ultima_horas numeric(12,1),                          -- horómetro de esa vez (tareas por horas)
  asignado_a   uuid references public.usuarios(id),
  activo       boolean not null default true,
  ejemplo      boolean not null default false
);
select public._control('public.preventivos');
create index if not exists preventivos_equipo on public.preventivos (equipo_id);
alter table public.ordenes add column if not exists preventivo_id uuid references public.preventivos(id);

-- Estado de la tarea (lo mismo calcula la app)
create or replace function public.preventivo_estado(p public.preventivos, horometro numeric) returns text
language sql stable as $$
  select case
    when p.unidad = 'horas' then
      case when p.ultima_horas is null or horometro is null then 'sin_datos'
           when horometro >= p.ultima_horas + p.frecuencia then 'vencida'
           when horometro >= p.ultima_horas + p.frecuencia - p.aviso_horas then 'proxima'
           else 'al_dia' end
    else
      case when p.ultima_fecha is null then 'sin_datos'
           when current_date > (p.ultima_fecha + (p.frecuencia || ' ' || case p.unidad when 'dias' then 'days' when 'semanas' then 'weeks' when 'meses' then 'months' else 'years' end)::interval)::date then 'vencida'
           when current_date >= (p.ultima_fecha + (p.frecuencia || ' ' || case p.unidad when 'dias' then 'days' when 'semanas' then 'weeks' when 'meses' then 'months' else 'years' end)::interval)::date - p.aviso_dias then 'proxima'
           else 'al_dia' end
  end
$$;

alter table public.preventivos enable row level security;
select public._politica('ver', 'preventivos', 'select', 'public.es(''jefe'',''encargado'',''tecnico'',''direccion'') and public.veo_equipo(equipo_id)');
select public._politica('crear', 'preventivos', 'insert', null, 'public.es(''jefe'') and public.veo_equipo(equipo_id)');
select public._politica('modificar', 'preventivos', 'update', 'public.es(''jefe'')', 'public.es(''jefe'')');

-- Las tareas no se borran: se quitan del plan (activo = false)
drop trigger if exists no_borrar on public.preventivos;
create trigger no_borrar before delete on public.preventivos for each row execute function public.no_se_borra();

-- Registrar que se hizo (sin orden, por ejemplo al cargar el plan): jefe o encargado
create or replace function public.preventivo_hecho(p_id uuid, p_fecha date default null, p_horas numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.preventivos; h numeric;
begin
  if not public.es('jefe','encargado') then perform public._error('Lo registra el jefe o el encargado.'); end if;
  select * into p from public.preventivos where id = p_id;
  if p.id is null or not public.veo_equipo(p.equipo_id) then perform public._error('No existe la tarea o no tenés acceso.'); end if;
  if coalesce(p_fecha, current_date) > current_date then perform public._error('La fecha no puede ser futura.'); end if;
  select horometro into h from public.equipos where id = p.equipo_id;
  update public.preventivos set ultima_fecha = coalesce(p_fecha, current_date), ultima_horas = coalesce(p_horas, h, ultima_horas) where id = p_id;
end $$;
revoke execute on function public.preventivo_hecho(uuid, date, numeric) from public, anon;
grant execute on function public.preventivo_hecho(uuid, date, numeric) to authenticated;

-- Una orden por tarea a la vez; la orden queda como preventiva
create or replace function public.orden_de_preventivo() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.preventivos;
begin
  if new.preventivo_id is null then return new; end if;
  select * into p from public.preventivos where id = new.preventivo_id;
  if p.id is null or p.equipo_id <> new.equipo_id then raise exception 'La tarea preventiva no corresponde a ese equipo.'; end if;
  if exists (select 1 from public.ordenes where preventivo_id = new.preventivo_id and estado in ('abierta','asignada','esperando_repuesto','en_curso')) then
    raise exception 'Esa tarea preventiva ya tiene una orden abierta.';
  end if;
  new.tipo := 'preventiva';
  return new;
end $$;
drop trigger if exists a_preventivo on public.ordenes;
create trigger a_preventivo before insert on public.ordenes for each row execute function public.orden_de_preventivo();

-- Al terminarse la orden, la tarea queda al día (fecha y horómetro de ese momento)
create or replace function public.preventivo_al_terminar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.preventivo_id is not null and new.estado in ('terminada','verificada','cerrada') and old.estado not in ('terminada','verificada','cerrada') then
    update public.preventivos set ultima_fecha = coalesce(new.terminada_en, now())::date,
      ultima_horas = coalesce((select horometro from public.equipos where id = new.equipo_id), ultima_horas)
      where id = new.preventivo_id;
  end if;
  return null;
end $$;
drop trigger if exists d_preventivo on public.ordenes;
create trigger d_preventivo after update of estado on public.ordenes for each row execute function public.preventivo_al_terminar();

-- Registro de cambios y tiempo real
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
    when 'preventivos'        then 'la tarea preventiva «' || (r->>'titulo') || '» de ' || coalesce((select codigo from public.equipos where id = (r->>'equipo_id')::uuid), '?')
    else tabla end
$$;
drop trigger if exists z_registrar on public.preventivos;
create trigger z_registrar after insert or update or delete on public.preventivos for each row execute function public.registrar('id');
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.preventivos; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------- Avisos diarios: también los preventivos vencidos ----------
create or replace function public.avisos_diarios() returns int
language plpgsql security definer set search_path = public as $$
declare o record; n int := 0; u record; hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  abiertas int; paradas int; reportes int; compras int; vencidas int; prev int;
begin
  -- Órdenes vencidas (una vez por día cada una)
  for o in select x.*, e.codigo, e.empresa_duena_id, e.empresa_ubicacion_id from public.ordenes x join public.equipos e on e.id = x.equipo_id
           where x.vence < hoy and x.estado in ('abierta','asignada','esperando_repuesto','en_curso') loop
    perform public._avisar(array(select public._destinatarios(array['encargado'], array[o.empresa_duena_id, o.empresa_ubicacion_id])) || o.asignado_a,
      'orden_vencida', 'Orden vencida: ' || public._ot(o.numero), o.titulo || ' · ' || o.codigo || ' · venció el ' || to_char(o.vence, 'DD/MM/YYYY'), '/ordenes/' || o.id);
    n := n + 1;
  end loop;
  -- Preventivos vencidos sin orden abierta: un aviso por persona con la cantidad
  for u in select id, perfil from public.usuarios where activo and perfil in ('jefe','encargado') loop
    select count(*) into prev from public.preventivos p join public.equipos e on e.id = p.equipo_id
      where p.activo and e.estado <> 'baja' and public.preventivo_estado(p, e.horometro) = 'vencida'
        and not exists (select 1 from public.ordenes x where x.preventivo_id = p.id and x.estado in ('abierta','asignada','esperando_repuesto','en_curso'))
        and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)));
    if prev > 0 then
      perform public._avisar(array[u.id], 'preventivos_vencidos', prev || case when prev = 1 then ' preventivo vencido' else ' preventivos vencidos' end,
        'Generá las órdenes desde Preventivos.', '/preventivos');
    end if;
  end loop;
  -- Resumen del día, con lo de las empresas de cada uno
  for u in select id, perfil from public.usuarios where activo and perfil in ('jefe','direccion') loop
    select count(*) filter (where x.estado in ('abierta','asignada','esperando_repuesto','en_curso')),
           count(*) filter (where x.estado in ('abierta','asignada','esperando_repuesto','en_curso') and x.vence < hoy)
      into abiertas, vencidas
      from public.ordenes x join public.equipos e on e.id = x.equipo_id
      where u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id));
    select count(*) into paradas from public.equipos e where e.estado in ('detenido','en_reparacion')
      and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)));
    select count(*) into reportes from public.reportes_falla r join public.equipos e on e.id = r.equipo_id where r.estado = 'nuevo'
      and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)));
    select count(*) into compras from public.pedidos_compra p where p.estado = 'pendiente'
      and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id = p.empresa_id));
    select count(*) into prev from public.preventivos p join public.equipos e on e.id = p.equipo_id
      where p.activo and e.estado <> 'baja' and public.preventivo_estado(p, e.horometro) = 'vencida'
        and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)));
    perform public._avisar(array[u.id], 'resumen_diario', 'Resumen del día · ' || to_char(hoy, 'DD/MM'),
      abiertas || ' órdenes pendientes' || case when vencidas > 0 then ' (' || vencidas || ' vencidas)' else '' end
      || ' · ' || prev || ' preventivos vencidos · ' || paradas || ' máquinas paradas · ' || reportes || ' reportes sin atender · ' || compras || ' compras por aprobar',
      '/');
  end loop;
  return n;
end $$;

-- ---------- Nombres de W-Main en la apariencia activa ----------
-- Solo si sigue con el nombre de fábrica «Mantenimiento» (si ya lo cambiaste en Apariencia, no se toca).
-- Queda como una versión nueva: se puede volver atrás desde Apariencia → Versiones.
do $$
declare t public.temas; v int; nuevo jsonb;
begin
  select * into t from public.temas where activo;
  if t.id is null or coalesce(t.tokens->'marca'->>'nombre', '') <> 'Mantenimiento' then return; end if;
  nuevo := jsonb_set(t.tokens, '{marca,nombre}', '"W-Main"');
  nuevo := jsonb_set(nuevo, '{vocabulario}', coalesce(nuevo->'vocabulario', '{}'::jsonb) || '{"jefe": "Gerente de mantenimiento"}'::jsonb);
  perform pg_advisory_xact_lock(hashtext('temas'));
  select coalesce(max(version), 0) + 1 into v from public.temas;
  update public.temas set activo = false where activo;
  insert into public.temas (version, nombre, tokens, activo, nota) values (v, 'W-Main', nuevo, true, 'Nombre W-Main y perfil «Gerente de mantenimiento» (fusión con W-Main)');
end $$;
