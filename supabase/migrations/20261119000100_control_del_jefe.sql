-- =====================================================================
-- App de mantenimiento · 12 · El jefe de mantenimiento aprueba todo (decisión del 19/11/2026)
--   · Compras: las aprueba o rechaza solo el jefe. Lo que pide el propio jefe queda aprobado.
--   · Préstamos entre empresas: los pide y los aprueba el jefe (quedan aprobados al pedirlos).
--   · Prioridad de las órdenes: la confirma o cambia el jefe.
--   · Dirección: ve informes, pendientes y el registro de cambios, sin aprobar nada.
-- Se puede correr más de una vez.
-- =====================================================================

-- Compras: aprobar o rechazar (solo el jefe)
create or replace function public.resolver_pedido(p_pedido uuid, p_aprobar boolean, p_respuesta text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.pedidos_compra;
begin
  if not public.es('jefe') then perform public._error('Los pedidos de compra los aprueba el jefe de mantenimiento.'); end if;
  select * into c from public.pedidos_compra where id = p_pedido for update;
  if c.id is null or not public.mi_empresa(c.empresa_id) then perform public._error('No existe el pedido o no tenés acceso.'); end if;
  if c.estado <> 'pendiente' then perform public._error('El pedido ya fue resuelto.'); end if;
  if not p_aprobar and coalesce(btrim(p_respuesta), '') = '' then perform public._error('Indicá el motivo del rechazo.'); end if;
  perform public._aprueba(auth.uid());
  update public.pedidos_compra set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
    resuelto_por = auth.uid(), resuelto_en = now(), respuesta = p_respuesta where id = p_pedido;
end $$;

-- Lo que pide el jefe (directo o desde una orden) queda aprobado por él mismo
create or replace function public.pedido_del_jefe() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.es('jefe') and new.estado = 'pendiente' then
    new.estado := 'aprobado'; new.resuelto_por := auth.uid(); new.resuelto_en := now();
    perform public._aprueba(auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists b_del_jefe on public.pedidos_compra;
create trigger b_del_jefe before insert on public.pedidos_compra for each row execute function public.pedido_del_jefe();
select public._politica('crear', 'pedidos_compra', 'insert', null, 'public.es(''jefe'') and public.mi_empresa(empresa_id)');

-- Préstamos: los pide el jefe y quedan aprobados (después registra la salida y la vuelta)
create or replace function public.pedir_prestamo(p_equipo uuid, p_empresa_destino uuid, p_area uuid, p_ubicacion text, p_vuelta date, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.equipos; nid uuid;
begin
  if not public.es('jefe') then perform public._error('Los préstamos los decide el jefe de mantenimiento.'); end if;
  e := public._equipo(p_equipo);
  if p_empresa_destino = e.empresa_ubicacion_id then perform public._error('El equipo ya está en esa empresa.'); end if;
  if exists (select 1 from public.movimientos_equipo where equipo_id = p_equipo and estado in ('solicitado','aprobado','en_curso') and tipo in ('prestamo','reparacion_externa')) then
    perform public._error('El equipo ya tiene un préstamo o una reparación externa en trámite.');
  end if;
  perform public._aprueba(auth.uid());
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, empresa_destino_id, area_destino_id, ubicacion_destino, fecha_vuelta_prevista, motivo,
                                         resuelto_por, resuelto_en)
  values (p_equipo, 'prestamo', 'aprobado', e.empresa_ubicacion_id, p_empresa_destino, p_area, p_ubicacion, p_vuelta, p_motivo, auth.uid(), now()) returning id into nid;
  return nid;
end $$;
-- (por si quedó alguno «solicitado» de antes)
create or replace function public.resolver_prestamo(p_mov uuid, p_aprobar boolean, p_respuesta text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe') then perform public._error('Los préstamos entre empresas los aprueba el jefe de mantenimiento.'); end if;
  if not p_aprobar and coalesce(btrim(p_respuesta), '') = '' then perform public._error('Indicá el motivo del rechazo.'); end if;
  perform public._aprueba(auth.uid());
  update public.movimientos_equipo set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
    resuelto_por = auth.uid(), resuelto_en = now(), respuesta = p_respuesta
    where id = p_mov and tipo = 'prestamo' and estado = 'solicitado';
  if not found then perform public._error('El préstamo no existe o ya fue resuelto.'); end if;
end $$;

-- Prioridad de las órdenes: la confirma o cambia el jefe
create or replace function public.orden_prioridad(p_orden uuid, p_prioridad text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe') then perform public._error('La prioridad la confirma o cambia el jefe de mantenimiento.'); end if;
  if p_prioridad not in ('urgente','alta','media','baja') then perform public._error('Prioridad desconocida.'); end if;
  if not exists (select 1 from public.ordenes o where o.id = p_orden and public.veo_equipo(o.equipo_id)) then perform public._error('No existe la orden o no tenés acceso.'); end if;
  perform public._transicion(); perform public._aprueba(auth.uid());
  update public.ordenes set prioridad = p_prioridad, prioridad_por = auth.uid(), prioridad_en = now() where id = p_orden;
end $$;

-- Avisos: las compras por aprobar le llegan al jefe
create or replace function public.avisar_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public._sin_avisos() then return null; end if;
  if tg_op = 'INSERT' and new.estado = 'pendiente' then
    perform public._avisar(array(select public._destinatarios(array['jefe'], array[new.empresa_id], new.creado_por)), 'compra_pendiente',
      'Compra por aprobar: PC-' || lpad(new.numero::text, 4, '0'),
      new.descripcion || coalesce(' · $ ' || to_char(new.monto_estimado, 'FM999G999G999D00'), '') || coalesce(' · pidió ' || public._nombre(new.creado_por), ''), '/compras');
  elsif tg_op = 'UPDATE' and new.estado in ('aprobado','rechazado') and old.estado = 'pendiente' and new.creado_por is distinct from auth.uid() then
    perform public._avisar(array[new.creado_por], 'compra_resuelta',
      case when new.estado = 'aprobado' then 'Compra aprobada: ' else 'Compra rechazada: ' end || 'PC-' || lpad(new.numero::text, 4, '0'),
      new.descripcion || coalesce(' — ' || new.respuesta, ''), '/compras');
  end if;
  return null;
end $$;
