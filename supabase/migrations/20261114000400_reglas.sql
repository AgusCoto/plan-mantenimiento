-- =====================================================================
-- App de mantenimiento · 4 · Reglas: estados de órdenes, compras y movimientos de equipos
-- Los cambios de estado pasan siempre por estas funciones, que controlan quién puede hacer cada
-- paso. Un trigger impide cambiar estados "a mano" desde la app.
-- =====================================================================

-- Marca que el cambio lo hace una función autorizada (dura solo la transacción)
create or replace function public._transicion() returns void
language sql as $$ select set_config('planta.transicion', '1', true) $$;
create or replace function public._en_transicion() returns boolean
language sql stable as $$ select auth.uid() is null or coalesce(current_setting('planta.transicion', true), '') = '1' $$;
-- Deja asentado quién aprobó (lo lee el registro de cambios)
create or replace function public._aprueba(u uuid) returns void
language sql as $$ select set_config('planta.aprobo_id', coalesce(u::text, ''), true) $$;
create or replace function public._nombre(u uuid) returns text
language sql stable security definer set search_path = public as $$ select nombre from public.usuarios where id = u $$;
create or replace function public._error(msg text) returns void
language plpgsql as $$ begin raise exception '%', msg using errcode = '42501'; end $$;

-- ¿Veo este equipo? (por la empresa dueña o la empresa donde está)
create or replace function public.veo_equipo(eq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipos e where e.id = eq and (public.mi_empresa(e.empresa_duena_id) or public.mi_empresa(e.empresa_ubicacion_id)))
$$;

-- ¿Puede esta persona trabajar en este equipo? (para asignarle órdenes)
create or replace function public._puede_trabajar(u uuid, eq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios us join public.equipos e on e.id = eq
    where us.id = u and us.activo and (us.perfil = 'jefe' or (us.perfil in ('tecnico','encargado') and exists (
      select 1 from public.usuario_empresas ue where ue.usuario_id = u and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)))))
$$;

-- ---------- Equipos: estado y ubicación solo cambian por funciones (dejan el movimiento registrado) ----------
create or replace function public.guardia_equipo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public._en_transicion() and (
       new.estado is distinct from old.estado or new.empresa_ubicacion_id is distinct from old.empresa_ubicacion_id
    or new.area_id is distinct from old.area_id or new.ubicacion is distinct from old.ubicacion) then
    raise exception 'El estado y la ubicación del equipo se cambian con un movimiento (reubicación, préstamo, reparación externa o baja).' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists c_guardia on public.equipos;
create trigger c_guardia before update on public.equipos for each row execute function public.guardia_equipo();

-- Un reporte con la máquina parada la deja «detenida» al instante
create or replace function public.reporte_detiene() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.operario_id := auth.uid();
    new.estado := 'nuevo'; new.orden_id := null; new.motivo_descarte := null;
  end if;
  return new;
end $$;
drop trigger if exists b_reporte on public.reportes_falla;
create trigger b_reporte before insert on public.reportes_falla for each row execute function public.reporte_detiene();

create or replace function public.reporte_parada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parada then
    perform public._transicion();
    update public.equipos set estado = 'detenido' where id = new.equipo_id and estado = 'operativo';
  end if;
  return null;
end $$;
drop trigger if exists c_reporte on public.reportes_falla;
create trigger c_reporte after insert on public.reportes_falla for each row execute function public.reporte_parada();

-- ---------- Órdenes ----------
create or replace function public.orden_nueva() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.equipos; r public.reportes_falla;
begin
  select * into e from public.equipos where id = new.equipo_id;
  if e.estado = 'baja' and not (auth.uid() is null and current_setting('planta.carga_masiva', true) = '1') then
    raise exception 'El equipo % está dado de baja.', e.codigo;
  end if;
  if new.reporte_id is not null then
    select * into r from public.reportes_falla where id = new.reporte_id;
    if r.estado <> 'nuevo' then raise exception 'Ese reporte ya fue atendido.'; end if;
    new.parada := r.parada;
  end if;
  new.empresa_cargo_id := e.empresa_duena_id;          -- las reparaciones se cargan a la empresa dueña
  new.requiere_verificacion := e.criticidad = 'alta';   -- producción verifica solo en equipos críticos
  new.prioridad_calculada := public.prioridad_de(e.criticidad, new.parada);
  if auth.uid() is not null then
    if new.asignado_a is not null and not public._puede_trabajar(new.asignado_a, new.equipo_id) then
      raise exception 'Esa persona no puede trabajar en este equipo (no es de mantenimiento o no tiene acceso a su empresa).';
    end if;
    new.prioridad := new.prioridad_calculada; new.prioridad_por := null; new.prioridad_en := null;
    new.estado := case when new.asignado_a is not null or new.contratista_id is not null then 'asignada' else 'abierta' end;
    new.terminada_en := null; new.cerrada_en := null;
  end if;
  return new;
end $$;
drop trigger if exists b_nueva on public.ordenes;
create trigger b_nueva before insert on public.ordenes for each row execute function public.orden_nueva();

create or replace function public.orden_desde_reporte() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reporte_id is not null then
    update public.reportes_falla set estado = 'en_orden', orden_id = new.id where id = new.reporte_id;
  end if;
  if new.parada then
    perform public._transicion();
    update public.equipos set estado = 'en_reparacion' where id = new.equipo_id and estado in ('operativo','detenido');
  end if;
  return null;
end $$;
drop trigger if exists c_desde_reporte on public.ordenes;
create trigger c_desde_reporte after insert on public.ordenes for each row execute function public.orden_desde_reporte();

-- Edición directa (jefe y encargado): título, descripción, tipo, vencimiento, asignación.
-- Estado, prioridad y fechas de cierre solo por funciones. Asignar una orden abierta la pasa a «asignada».
create or replace function public.guardia_orden() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.asignado_a is distinct from old.asignado_a and new.asignado_a is not null and auth.uid() is not null
     and not public._puede_trabajar(new.asignado_a, new.equipo_id) then
    raise exception 'Esa persona no puede trabajar en este equipo (no es de mantenimiento o no tiene acceso a su empresa).';
  end if;
  if not public._en_transicion() then
    if (new.estado, new.prioridad, new.prioridad_por, new.prioridad_calculada, new.empresa_cargo_id, new.requiere_verificacion,
        new.terminada_en, new.cerrada_en, new.equipo_id, new.reporte_id, new.parada)
       is distinct from
       (old.estado, old.prioridad, old.prioridad_por, old.prioridad_calculada, old.empresa_cargo_id, old.requiere_verificacion,
        old.terminada_en, old.cerrada_en, old.equipo_id, old.reporte_id, old.parada) then
      raise exception 'El estado y la prioridad de la orden se cambian con las acciones de la orden.' using errcode = '42501';
    end if;
    if old.estado in ('cerrada','anulada') then
      raise exception 'La orden está %: no se puede modificar.', old.estado using errcode = '42501';
    end if;
    if old.estado = 'abierta' and (new.asignado_a is not null or new.contratista_id is not null) then
      new.estado := 'asignada';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists c_guardia on public.ordenes;
create trigger c_guardia before update on public.ordenes for each row execute function public.guardia_orden();

-- Si ninguna otra orden activa tiene la máquina parada, el equipo vuelve a «operativo»
create or replace function public._liberar_equipo(eq uuid, salvo uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ordenes where equipo_id = eq and id <> salvo and parada
                 and estado not in ('terminada','verificada','cerrada','anulada')) then
    perform public._transicion();
    update public.equipos set estado = 'operativo' where id = eq and estado in ('detenido','en_reparacion');
  end if;
end $$;

-- Cambios de estado de la orden
create or replace function public.orden_estado(p_orden uuid, p_estado text, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.ordenes; yo uuid := auth.uid(); p text := public.mi_perfil();
  responsable boolean;
begin
  select * into o from public.ordenes where id = p_orden for update;
  if o.id is null or not public.veo_equipo(o.equipo_id) then perform public._error('No existe la orden o no tenés acceso.'); end if;
  responsable := p in ('jefe','encargado') or (p = 'tecnico' and o.asignado_a = yo);
  perform public._transicion();
  if p_estado = 'en_curso' then
    if o.estado in ('abierta','asignada','esperando_repuesto') then
      if not responsable then perform public._error('Solo el técnico asignado, el encargado o el jefe pueden empezar el trabajo.'); end if;
    elsif o.estado in ('terminada','verificada','cerrada') then
      if p <> 'jefe' then perform public._error('Solo el jefe de mantenimiento puede reabrir una orden.'); end if;
    else perform public._error('La orden no puede pasar a «en curso» desde «' || o.estado || '».');
    end if;
    update public.ordenes set estado = 'en_curso', terminada_en = null, cerrada_en = null,
      asignado_a = coalesce(asignado_a, case when p = 'tecnico' then yo end) where id = p_orden;
  elsif p_estado = 'esperando_repuesto' then
    if o.estado not in ('abierta','asignada','en_curso') or not responsable then
      perform public._error('No podés marcar esta orden como «esperando repuesto».');
    end if;
    update public.ordenes set estado = 'esperando_repuesto' where id = p_orden;
  elsif p_estado = 'cerrada' then
    if p not in ('jefe','encargado') then perform public._error('Solo el jefe o el encargado cierran órdenes.'); end if;
    if o.estado = 'terminada' and o.requiere_verificacion then
      perform public._error('Equipo crítico: falta la verificación de producción (firma del supervisor en la ficha de cierre).');
    end if;
    if o.estado not in ('terminada','verificada') then perform public._error('La orden tiene que estar terminada para cerrarla.'); end if;
    update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = p_orden;
  elsif p_estado = 'anulada' then
    if p <> 'jefe' then perform public._error('Solo el jefe de mantenimiento anula órdenes.'); end if;
    if coalesce(btrim(p_motivo), '') = '' then perform public._error('Indicá el motivo de la anulación.'); end if;
    if o.estado = 'cerrada' then perform public._error('Una orden cerrada no se anula.'); end if;
    update public.ordenes set estado = 'anulada', motivo_anulacion = p_motivo where id = p_orden;
    if o.reporte_id is not null then update public.reportes_falla set estado = 'nuevo', orden_id = null where id = o.reporte_id; end if;
    perform public._liberar_equipo(o.equipo_id, o.id);
  else
    perform public._error('Ese cambio de estado se hace con la ficha de cierre o no existe.');
  end if;
end $$;

-- Dirección confirma o cambia la prioridad
create or replace function public.orden_prioridad(p_orden uuid, p_prioridad text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es('direccion') then perform public._error('La prioridad la confirma o cambia dirección.'); end if;
  if p_prioridad not in ('urgente','alta','media','baja') then perform public._error('Prioridad desconocida.'); end if;
  if not exists (select 1 from public.ordenes o where o.id = p_orden and public.veo_equipo(o.equipo_id)) then perform public._error('No existe la orden o no tenés acceso.'); end if;
  perform public._transicion(); perform public._aprueba(auth.uid());
  update public.ordenes set prioridad = p_prioridad, prioridad_por = auth.uid(), prioridad_en = now() where id = p_orden;
end $$;

-- Fichas: a nombre de quien la carga (o del contratista, si la carga el jefe). La de cierre termina la orden.
create or replace function public.ficha_nueva() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.ordenes;
begin
  if auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' then return new; end if;
  select * into o from public.ordenes where id = new.orden_id for update;
  if o.estado in ('terminada','verificada','cerrada','anulada') then
    raise exception 'La orden ya está %: no se cargan más fichas.', o.estado using errcode = '42501';
  end if;
  if auth.uid() is not null then
    if new.contratista_id is not null then
      if not public.es('jefe') then raise exception 'El trabajo de un contratista lo carga el jefe de mantenimiento.' using errcode = '42501'; end if;
      new.tecnico_id := null;
    else
      new.tecnico_id := auth.uid();
    end if;
  end if;
  if new.es_cierre then
    if new.causa is null then raise exception 'Indicá la causa de la falla.'; end if;
    if o.requiere_verificacion and (coalesce(btrim(new.supervisor_nombre), '') = '' or new.firma_ruta is null) then
      raise exception 'Equipo crítico: el supervisor de producción tiene que firmar el cierre.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists b_ficha on public.fichas;
create trigger b_ficha before insert on public.fichas for each row execute function public.ficha_nueva();

create or replace function public.ficha_mueve_orden() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.ordenes;
begin
  if auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' then return null; end if;
  select * into o from public.ordenes where id = new.orden_id;
  perform public._transicion();
  if new.es_cierre then
    update public.ordenes set estado = case when o.requiere_verificacion then 'verificada' else 'terminada' end, terminada_en = now()
      where id = new.orden_id;
    perform public._liberar_equipo(o.equipo_id, o.id);
  elsif o.estado in ('abierta','asignada') then
    update public.ordenes set estado = 'en_curso' where id = new.orden_id;
  end if;
  return null;
end $$;
drop trigger if exists c_ficha on public.fichas;
create trigger c_ficha after insert on public.fichas for each row execute function public.ficha_mueve_orden();

-- Descartar un reporte (jefe o encargado)
create or replace function public.descartar_reporte(p_reporte uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe','encargado') then perform public._error('Solo el jefe o el encargado descartan reportes.'); end if;
  if coalesce(btrim(p_motivo), '') = '' then perform public._error('Indicá el motivo.'); end if;
  update public.reportes_falla set estado = 'descartado', motivo_descarte = p_motivo
    where id = p_reporte and estado = 'nuevo' and public.veo_equipo(equipo_id);
  if not found then perform public._error('El reporte no existe o ya fue atendido.'); end if;
end $$;

-- ---------- Compras ----------
-- Pedir un repuesto desde una orden: la orden pasa a «esperando repuesto».
create or replace function public.pedir_repuesto(p_orden uuid, p_descripcion text, p_cantidad numeric default 1, p_monto numeric default null, p_proveedor uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare o public.ordenes; nid uuid; p text := public.mi_perfil();
begin
  select * into o from public.ordenes where id = p_orden;
  if o.id is null or not public.veo_equipo(o.equipo_id) then perform public._error('No existe la orden o no tenés acceso.'); end if;
  if not (p in ('jefe','encargado') or (p = 'tecnico' and o.asignado_a = auth.uid())) then
    perform public._error('Solo el técnico asignado, el encargado o el jefe piden repuestos.');
  end if;
  if o.estado in ('terminada','verificada','cerrada','anulada') then perform public._error('La orden ya está terminada.'); end if;
  insert into public.pedidos_compra (orden_id, equipo_id, empresa_id, descripcion, cantidad, monto_estimado, proveedor_id)
  values (p_orden, o.equipo_id, o.empresa_cargo_id, p_descripcion, coalesce(p_cantidad, 1), p_monto, p_proveedor) returning id into nid;
  perform public._transicion();
  update public.ordenes set estado = 'esperando_repuesto' where id = p_orden and estado <> 'esperando_repuesto';
  return nid;
end $$;

-- Aprobar o rechazar: dirección siempre; el jefe, si el monto está por debajo del tope configurado.
create or replace function public.resolver_pedido(p_pedido uuid, p_aprobar boolean, p_respuesta text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.pedidos_compra; tope numeric;
begin
  select * into c from public.pedidos_compra where id = p_pedido for update;
  if c.id is null or not public.mi_empresa(c.empresa_id) then perform public._error('No existe el pedido o no tenés acceso.'); end if;
  if c.estado <> 'pendiente' then perform public._error('El pedido ya fue resuelto.'); end if;
  select nullif(valor, 'null'::jsonb)::text::numeric into tope from public.config where clave = 'compras_tope_jefe';
  if not (public.es('direccion') or (public.es('jefe') and tope is not null and coalesce(c.monto_estimado, 0) <= tope)) then
    perform public._error(case when public.es('jefe') then 'Este pedido lo aprueba dirección (supera el tope del jefe o no hay tope configurado).'
                               else 'Los pedidos de compra los aprueba dirección.' end);
  end if;
  if not p_aprobar and coalesce(btrim(p_respuesta), '') = '' then perform public._error('Indicá el motivo del rechazo.'); end if;
  perform public._aprueba(auth.uid());
  update public.pedidos_compra set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
    resuelto_por = auth.uid(), resuelto_en = now(), respuesta = p_respuesta where id = p_pedido;
end $$;

-- Llegó el repuesto: si la orden no espera nada más, vuelve a «en curso».
create or replace function public.recibir_pedido(p_pedido uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.pedidos_compra;
begin
  if not public.es('jefe','encargado') then perform public._error('Solo el jefe o el encargado registran la recepción.'); end if;
  select * into c from public.pedidos_compra where id = p_pedido for update;
  if c.estado <> 'aprobado' then perform public._error('Solo se recibe un pedido aprobado.'); end if;
  update public.pedidos_compra set estado = 'recibido' where id = p_pedido;
  if c.orden_id is not null and not exists (select 1 from public.pedidos_compra where orden_id = c.orden_id and estado in ('pendiente','aprobado')) then
    perform public._transicion();
    update public.ordenes set estado = 'en_curso' where id = c.orden_id and estado = 'esperando_repuesto';
  end if;
end $$;

-- ---------- Movimientos de equipos ----------
create or replace function public._equipo(eq uuid) returns public.equipos
language plpgsql security definer set search_path = public as $$
declare e public.equipos;
begin
  select * into e from public.equipos where id = eq for update;
  if e.id is null then perform public._error('No existe el equipo.'); end if;
  if e.estado = 'baja' then perform public._error('El equipo ' || e.codigo || ' está dado de baja.'); end if;
  return e;
end $$;

-- Préstamo entre empresas: lo pide el jefe…
create or replace function public.pedir_prestamo(p_equipo uuid, p_empresa_destino uuid, p_area uuid, p_ubicacion text, p_vuelta date, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.equipos; nid uuid;
begin
  if not public.es('jefe') then perform public._error('Los préstamos los pide el jefe de mantenimiento.'); end if;
  e := public._equipo(p_equipo);
  if p_empresa_destino = e.empresa_ubicacion_id then perform public._error('El equipo ya está en esa empresa.'); end if;
  if exists (select 1 from public.movimientos_equipo where equipo_id = p_equipo and estado in ('solicitado','aprobado','en_curso') and tipo in ('prestamo','reparacion_externa')) then
    perform public._error('El equipo ya tiene un préstamo o una reparación externa en trámite.');
  end if;
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, empresa_destino_id, area_destino_id, ubicacion_destino, fecha_vuelta_prevista, motivo)
  values (p_equipo, 'prestamo', 'solicitado', e.empresa_ubicacion_id, p_empresa_destino, p_area, p_ubicacion, p_vuelta, p_motivo) returning id into nid;
  return nid;
end $$;

-- …y lo aprueba o rechaza dirección
create or replace function public.resolver_prestamo(p_mov uuid, p_aprobar boolean, p_respuesta text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es('direccion') then perform public._error('Los préstamos entre empresas los aprueba dirección.'); end if;
  if not p_aprobar and coalesce(btrim(p_respuesta), '') = '' then perform public._error('Indicá el motivo del rechazo.'); end if;
  perform public._aprueba(auth.uid());
  update public.movimientos_equipo set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
    resuelto_por = auth.uid(), resuelto_en = now(), respuesta = p_respuesta
    where id = p_mov and tipo = 'prestamo' and estado = 'solicitado';
  if not found then perform public._error('El préstamo no existe o ya fue resuelto.'); end if;
end $$;

-- El jefe registra que el equipo salió (préstamo aprobado) o volvió (préstamo o reparación externa)
create or replace function public.mover_equipo(p_mov uuid, p_accion text, p_fecha date default current_date, p_datos jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare m public.movimientos_equipo; e public.equipos;
begin
  if not public.es('jefe') then perform public._error('Solo el jefe de mantenimiento registra la salida y la vuelta de equipos.'); end if;
  select * into m from public.movimientos_equipo where id = p_mov for update;
  if m.id is null then perform public._error('No existe el movimiento.'); end if;
  select * into e from public.equipos where id = m.equipo_id for update;
  perform public._transicion();
  if p_accion = 'salida' and m.tipo = 'prestamo' and m.estado = 'aprobado' then
    update public.movimientos_equipo set estado = 'en_curso', fecha_salida = p_fecha,
      area_origen_id = e.area_id, ubicacion_origen = e.ubicacion where id = p_mov;
    update public.equipos set empresa_ubicacion_id = m.empresa_destino_id, area_id = coalesce(m.area_destino_id, area_id),
      ubicacion = coalesce(m.ubicacion_destino, ubicacion) where id = m.equipo_id;
  elsif p_accion = 'vuelta' and m.estado = 'en_curso' and m.tipo = 'prestamo' then
    update public.movimientos_equipo set estado = 'cerrado', fecha_vuelta = p_fecha where id = p_mov;
    update public.equipos set empresa_ubicacion_id = m.empresa_origen_id,
      area_id = coalesce((p_datos->>'area_id')::uuid, m.area_origen_id), ubicacion = coalesce(p_datos->>'ubicacion', m.ubicacion_origen) where id = m.equipo_id;
  elsif p_accion = 'vuelta' and m.estado = 'en_curso' and m.tipo = 'reparacion_externa' then
    update public.movimientos_equipo set estado = 'cerrado', fecha_vuelta = p_fecha,
      remito = coalesce(p_datos->>'remito', remito), garantia_hasta = coalesce((p_datos->>'garantia_hasta')::date, garantia_hasta),
      presupuesto = coalesce((p_datos->>'costo')::numeric, presupuesto) where id = p_mov;
    update public.equipos set estado = 'operativo' where id = m.equipo_id;
  else
    perform public._error('Ese paso no corresponde al estado del movimiento.');
  end if;
end $$;

-- Mandar a reparar afuera (el jefe; queda en curso desde la salida)
create or replace function public.reparacion_externa(p_equipo uuid, p_proveedor uuid, p_salida date, p_vuelta date, p_presupuesto numeric, p_remito text, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.equipos; nid uuid;
begin
  if not public.es('jefe') then perform public._error('Mandar a reparar afuera lo decide el jefe de mantenimiento.'); end if;
  e := public._equipo(p_equipo);
  if exists (select 1 from public.movimientos_equipo where equipo_id = p_equipo and estado in ('solicitado','aprobado','en_curso') and tipo in ('prestamo','reparacion_externa')) then
    perform public._error('El equipo ya tiene un préstamo o una reparación externa en trámite.');
  end if;
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, proveedor_id, fecha_salida, fecha_vuelta_prevista, presupuesto, remito, motivo)
  values (p_equipo, 'reparacion_externa', 'en_curso', e.empresa_ubicacion_id, p_proveedor, coalesce(p_salida, current_date), p_vuelta, p_presupuesto, p_remito, p_motivo)
  returning id into nid;
  perform public._transicion();
  update public.equipos set estado = 'reparacion_externa' where id = p_equipo;
  return nid;
end $$;

-- Reubicar dentro de la empresa donde está (área y lugar)
create or replace function public.reubicar_equipo(p_equipo uuid, p_area uuid, p_ubicacion text, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare e public.equipos;
begin
  if not public.es('jefe') then perform public._error('Las reubicaciones las hace el jefe de mantenimiento.'); end if;
  e := public._equipo(p_equipo);
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, empresa_destino_id, area_destino_id, ubicacion_destino, motivo, fecha_salida)
  values (p_equipo, 'reubicacion', 'cerrado', e.empresa_ubicacion_id, e.empresa_ubicacion_id, p_area, p_ubicacion, p_motivo, current_date);
  perform public._transicion();
  update public.equipos set area_id = p_area, ubicacion = nullif(btrim(p_ubicacion), '') where id = p_equipo;
end $$;

-- Baja: motivo y destino (venta, desguace o chatarra). El equipo queda con su historial.
create or replace function public.baja_equipo(p_equipo uuid, p_motivo text, p_destino text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.equipos;
begin
  if not public.es('jefe') then perform public._error('Las bajas las hace el jefe de mantenimiento.'); end if;
  e := public._equipo(p_equipo);
  if coalesce(btrim(p_motivo), '') = '' then perform public._error('Indicá el motivo de la baja.'); end if;
  if not exists (select 1 from public.listas where lista = 'destino_baja' and clave = p_destino) then perform public._error('Elegí el destino: venta, desguace o chatarra.'); end if;
  if exists (select 1 from public.ordenes where equipo_id = p_equipo and estado not in ('cerrada','anulada')) then
    perform public._error('El equipo tiene órdenes abiertas: cerralas o anulalas antes de darlo de baja.');
  end if;
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, motivo, destino_baja, fecha_salida)
  values (p_equipo, 'baja', 'cerrado', e.empresa_ubicacion_id, p_motivo, p_destino, current_date);
  perform public._transicion();
  update public.equipos set estado = 'baja' where id = p_equipo;
end $$;

-- Detener o volver a operativo a mano (jefe o encargado), por ejemplo tras una revisión
create or replace function public.estado_equipo(p_equipo uuid, p_estado text, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe','encargado') then perform public._error('Solo el jefe o el encargado cambian el estado de un equipo.'); end if;
  if p_estado not in ('operativo','detenido') then perform public._error('Desde acá solo se marca «operativo» o «detenido».'); end if;
  perform public._equipo(p_equipo);
  perform public._transicion();
  perform set_config('planta.motivo', coalesce(p_motivo, ''), true);
  update public.equipos set estado = p_estado where id = p_equipo and estado in ('operativo','detenido','en_reparacion');
end $$;

-- Horómetro (lo lee y lo carga el personal de mantenimiento)
create or replace function public.cargar_horometro(p_equipo uuid, p_valor numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_mantenimiento() or not public.veo_equipo(p_equipo) then perform public._error('No podés cargar el horómetro de ese equipo.'); end if;
  if p_valor < 0 then perform public._error('El horómetro no puede ser negativo.'); end if;
  update public.equipos set horometro = p_valor, horometro_fecha = current_date where id = p_equipo;
end $$;
