-- =====================================================================
-- App de mantenimiento · 10 · Avisos (notificaciones push)
-- Cada aviso se guarda en la tabla «avisos» (también se ven dentro de la app, en la campanita) y la
-- función de Supabase «avisos» los manda como notificación push a los celulares del destinatario.
-- La tabla tiene la columna «canales» para sumar WhatsApp más adelante sin cambiar la estructura.
--
-- Qué avisa y a quién (solo a quien tiene acceso a la empresa del equipo):
--   · Máquina parada (reporte con parada) → jefe, encargados y técnicos
--   · Reporte de falla nuevo (sin parada)  → jefe y encargados
--   · Orden asignada                       → el técnico asignado
--   · Pedido de compra por aprobar         → dirección; aprobado o rechazado → quien lo pidió
--   · Préstamo por aprobar                 → dirección; aprobado o rechazado → quien lo pidió
--   · Orden vencida (todos los días)       → el asignado y los encargados
--   · Resumen del día (todos los días)     → jefe y dirección
-- =====================================================================

-- ---------- Avisos ----------
create table if not exists public.avisos (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.usuarios(id),
  tipo        text not null,
  titulo      text not null,
  cuerpo      text,
  url         text,
  canales     text[] not null default '{push}',
  creado_en   timestamptz not null default now(),
  leido_en    timestamptz,
  enviado_en  timestamptz,
  tomado_en   timestamptz,
  intentos    int not null default 0,
  error       text
);
create index if not exists avisos_usuario on public.avisos (usuario_id, id desc);
create index if not exists avisos_pendientes on public.avisos (id) where enviado_en is null;
alter table public.avisos enable row level security;
select public._politica('ver', 'avisos', 'select', 'usuario_id = auth.uid()');

-- ---------- Celulares suscriptos a las notificaciones push ----------
create table if not exists public.push_suscripciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  agente      text,
  creado_en   timestamptz not null default now(),
  ultimo_envio timestamptz,
  fallos      int not null default 0
);
alter table public.push_suscripciones enable row level security;
select public._politica('ver', 'push_suscripciones', 'select', 'usuario_id = auth.uid()');

-- Datos para llamar a la función de envío desde la base (los completa supabase/avisos-activar.sql).
-- Sin políticas: nadie lo lee desde la app.
create table if not exists public.servidor (
  clave text primary key,
  valor text not null
);
alter table public.servidor enable row level security;

-- Suscribir este celular (si ya estaba a nombre de otro usuario, pasa al actual)
create or replace function public.suscribir_push(p_endpoint text, p_p256dh text, p_auth text, p_agente text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.activo() then perform public._error('Usuario no activo.'); end if;
  if coalesce(p_endpoint, '') !~ '^https://' then perform public._error('Suscripción inválida.'); end if;
  delete from public.push_suscripciones where endpoint = p_endpoint;
  insert into public.push_suscripciones (usuario_id, endpoint, p256dh, auth, agente) values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_agente, 200));
end $$;
create or replace function public.desuscribir_push(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_suscripciones where endpoint = p_endpoint and usuario_id = auth.uid();
$$;
create or replace function public.marcar_avisos_leidos(p_hasta bigint default null) returns void
language sql security definer set search_path = public as $$
  update public.avisos set leido_en = now() where usuario_id = auth.uid() and leido_en is null and (p_hasta is null or id <= p_hasta);
$$;

-- ---------- Destinatarios ----------
-- Usuarios activos con alguno de esos perfiles y acceso a alguna de esas empresas (el jefe accede a todas)
create or replace function public._destinatarios(p_perfiles text[], p_empresas uuid[], p_salvo uuid default null) returns setof uuid
language sql stable security definer set search_path = public as $$
  select u.id from public.usuarios u
  where u.activo and u.perfil = any(p_perfiles) and u.id is distinct from p_salvo
    and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id = any(p_empresas)))
$$;
create or replace function public._avisar(p_usuarios uuid[], p_tipo text, p_titulo text, p_cuerpo text, p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_usuarios is null or cardinality(p_usuarios) = 0 then return; end if;
  insert into public.avisos (usuario_id, tipo, titulo, cuerpo, url)
  select distinct u, p_tipo, left(p_titulo, 120), left(p_cuerpo, 400), p_url from unnest(p_usuarios) u where u is not null;
end $$;
-- Las cargas masivas (migración de W-Main, datos de ejemplo) no avisan
create or replace function public._sin_avisos() returns boolean
language sql stable as $$ select auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' $$;
create or replace function public._empresas_eq(eq uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array[empresa_duena_id, empresa_ubicacion_id] from public.equipos where id = eq
$$;
create or replace function public._ot(n int) returns text language sql immutable as $$ select 'OT-' || lpad(n::text, 4, '0') $$;

-- ---------- Disparadores ----------
create or replace function public.avisar_reporte() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.equipos; falla text;
begin
  if public._sin_avisos() then return null; end if;
  select * into e from public.equipos where id = new.equipo_id;
  select nombre into falla from public.listas where lista = 'tipo_falla' and clave = new.tipo_falla;
  perform public._avisar(array(select public._destinatarios(
      case when new.parada then array['jefe','encargado','tecnico'] else array['jefe','encargado'] end, array[e.empresa_duena_id, e.empresa_ubicacion_id], new.operario_id)),
    case when new.parada then 'maquina_parada' else 'reporte_nuevo' end,
    case when new.parada then 'Máquina parada: ' || e.codigo else 'Reporte de falla: ' || e.codigo end,
    coalesce(falla, new.tipo_falla) || ' · ' || e.nombre || coalesce(' · ' || public._nombre(new.operario_id), '') || coalesce(' — «' || left(new.texto, 120) || '»', ''),
    '/reportes');
  return null;
end $$;
drop trigger if exists d_avisar on public.reportes_falla;
create trigger d_avisar after insert on public.reportes_falla for each row execute function public.avisar_reporte();

create or replace function public.avisar_orden() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.equipos;
begin
  if public._sin_avisos() or new.asignado_a is null or new.asignado_a = auth.uid() then return null; end if;
  if tg_op = 'UPDATE' and new.asignado_a is not distinct from old.asignado_a then return null; end if;
  select * into e from public.equipos where id = new.equipo_id;
  perform public._avisar(array[new.asignado_a], 'orden_asignada', 'Te asignaron la ' || public._ot(new.numero) || ' (' || new.prioridad || ')',
    new.titulo || ' · ' || e.codigo || ' ' || e.nombre || case when new.parada then ' · máquina parada' else '' end, '/ordenes/' || new.id);
  return null;
end $$;
drop trigger if exists d_avisar on public.ordenes;
create trigger d_avisar after insert or update of asignado_a on public.ordenes for each row execute function public.avisar_orden();

create or replace function public.avisar_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public._sin_avisos() then return null; end if;
  if tg_op = 'INSERT' and new.estado = 'pendiente' then
    perform public._avisar(array(select public._destinatarios(array['direccion'], array[new.empresa_id], new.creado_por)), 'compra_pendiente',
      'Compra por aprobar: PC-' || lpad(new.numero::text, 4, '0'),
      new.descripcion || coalesce(' · $ ' || to_char(new.monto_estimado, 'FM999G999G999D00'), '') || coalesce(' · pidió ' || public._nombre(new.creado_por), ''), '/compras');
  elsif tg_op = 'UPDATE' and new.estado in ('aprobado','rechazado') and old.estado = 'pendiente' and new.creado_por is distinct from auth.uid() then
    perform public._avisar(array[new.creado_por], 'compra_resuelta',
      case when new.estado = 'aprobado' then 'Compra aprobada: ' else 'Compra rechazada: ' end || 'PC-' || lpad(new.numero::text, 4, '0'),
      new.descripcion || coalesce(' — ' || new.respuesta, ''), '/compras');
  end if;
  return null;
end $$;
drop trigger if exists d_avisar on public.pedidos_compra;
create trigger d_avisar after insert or update of estado on public.pedidos_compra for each row execute function public.avisar_pedido();

create or replace function public.avisar_movimiento() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.equipos; destino text;
begin
  if public._sin_avisos() or new.tipo <> 'prestamo' then return null; end if;
  select * into e from public.equipos where id = new.equipo_id;
  select nombre into destino from public.empresas where id = new.empresa_destino_id;
  if tg_op = 'INSERT' and new.estado = 'solicitado' then
    perform public._avisar(array(select public._destinatarios(array['direccion'], array[e.empresa_duena_id, new.empresa_destino_id], new.creado_por)), 'prestamo_pendiente',
      'Préstamo por aprobar: ' || e.codigo, e.nombre || ' → ' || coalesce(destino, '') || coalesce(' · ' || new.motivo, ''), '/movimientos');
  elsif tg_op = 'UPDATE' and new.estado in ('aprobado','rechazado') and old.estado = 'solicitado' and new.creado_por is distinct from auth.uid() then
    perform public._avisar(array[new.creado_por], 'prestamo_resuelto',
      case when new.estado = 'aprobado' then 'Préstamo aprobado: ' else 'Préstamo rechazado: ' end || e.codigo, coalesce(destino, '') || coalesce(' — ' || new.respuesta, ''), '/movimientos');
  end if;
  return null;
end $$;
drop trigger if exists d_avisar on public.movimientos_equipo;
create trigger d_avisar after insert or update of estado on public.movimientos_equipo for each row execute function public.avisar_movimiento();

-- ---------- Avisos diarios: órdenes vencidas y resumen del día ----------
create or replace function public.avisos_diarios() returns int
language plpgsql security definer set search_path = public as $$
declare o record; n int := 0; u record; hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  abiertas int; paradas int; reportes int; compras int; prestamos int; vencidas int;
begin
  -- Órdenes vencidas (una vez por día cada una)
  for o in select x.*, e.codigo, e.empresa_duena_id, e.empresa_ubicacion_id from public.ordenes x join public.equipos e on e.id = x.equipo_id
           where x.vence < hoy and x.estado in ('abierta','asignada','esperando_repuesto','en_curso') loop
    perform public._avisar(array(select public._destinatarios(array['encargado'], array[o.empresa_duena_id, o.empresa_ubicacion_id])) || o.asignado_a,
      'orden_vencida', 'Orden vencida: ' || public._ot(o.numero), o.titulo || ' · ' || o.codigo || ' · venció el ' || to_char(o.vence, 'DD/MM/YYYY'), '/ordenes/' || o.id);
    n := n + 1;
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
    select count(*) into prestamos from public.movimientos_equipo m where m.estado = 'solicitado';
    perform public._avisar(array[u.id], 'resumen_diario', 'Resumen del día · ' || to_char(hoy, 'DD/MM'),
      abiertas || ' órdenes pendientes' || case when vencidas > 0 then ' (' || vencidas || ' vencidas)' else '' end
      || ' · ' || paradas || ' máquinas paradas · ' || reportes || ' reportes sin atender · ' || compras || ' compras' || case when u.perfil = 'direccion' then ' y ' || prestamos || ' préstamos' else '' end || ' por aprobar',
      '/');
  end loop;
  return n;
end $$;

-- ---------- Envío: la base llama a la función «avisos» apenas hay algo para mandar ----------
-- (si pg_net no está o no se configuró la dirección, los avisos quedan en la app y se mandan con el reintento)
create or replace function public._llamar_envio() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_clave text;
begin
  select s.valor into v_url from public.servidor s where s.clave = 'url_funcion_avisos';
  select s.valor into v_clave from public.servidor s where s.clave = 'clave_publica';
  if v_url is null or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') then return; end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer '' || $2, ''apikey'', $2), timeout_milliseconds := 10000)'
    using v_url, coalesce(v_clave, '');
exception when others then
  raise warning 'No se pudo llamar a la función de avisos: %', sqlerrm;   -- nunca frena la carga
end $$;
create or replace function public.avisos_enviar() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public._llamar_envio(); return null; end $$;
drop trigger if exists z_enviar on public.avisos;
create trigger z_enviar after insert on public.avisos for each statement execute function public.avisos_enviar();
-- Reintento: si quedó algo sin mandar (por ejemplo, la función estaba caída)
create or replace function public.reenviar_avisos() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.avisos where enviado_en is null and intentos < 5 and creado_en > now() - interval '2 days') then
    perform public._llamar_envio();
  end if;
end $$;

-- La función de envío toma los avisos de a tandas (sin mandar dos veces lo mismo si corre dos veces)
create or replace function public.tomar_avisos(p_cantidad int default 100) returns setof public.avisos
language sql security definer set search_path = public as $$
  update public.avisos set tomado_en = now(), intentos = intentos + 1
  where id in (select id from public.avisos
               where enviado_en is null and intentos < 5 and creado_en > now() - interval '2 days'
                 and (tomado_en is null or tomado_en < now() - interval '2 minutes')
               order by id limit p_cantidad for update skip locked)
  returning *;
$$;
create or replace function public.resultado_aviso(p_id bigint, p_enviado boolean, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.avisos set enviado_en = case when p_enviado then now() end, error = p_error, tomado_en = null where id = p_id;
$$;

-- ---------- Tareas programadas (pg_cron): avisos diarios a las 8 (hora argentina) y reintentos ----------
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron no disponible: los avisos diarios se activan con supabase/avisos-activar.sql'; end;
  begin create extension if not exists pg_net; exception when others then raise notice 'pg_net no disponible'; end;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'cron' and p.proname = 'schedule') then
    perform cron.schedule('avisos-diarios', '0 11 * * *', 'select public.avisos_diarios()');   -- 11 UTC = 8 de Argentina
    perform cron.schedule('avisos-reintento', '*/5 * * * *', 'select public.reenviar_avisos()');
  end if;
exception when others then raise notice 'No se pudieron programar los avisos: %', sqlerrm;
end $$;

-- Tiempo real: la campanita de la app se actualiza sola
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.avisos; exception when duplicate_object then null; end;
  end if;
end $$;
