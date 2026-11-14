-- =====================================================================
-- App de mantenimiento · 11 · Datos de ejemplo (se cargan y se borran desde el SQL Editor de Supabase)
--   Cargar:  select public.cargar_datos_ejemplo('una-clave-para-los-usuarios-de-ejemplo');
--   Borrar:  select public.borrar_datos_ejemplo();
-- Todo lo de ejemplo queda marcado (columna «ejemplo») y los usuarios empiezan con «ej.».
-- Desde la app no se pueden llamar.
-- =====================================================================

create or replace function public.cargar_datos_ejemplo(p_clave text) returns text
language plpgsql security definer set search_path = public as $$
declare
  emp jsonb := (select jsonb_object_agg(sigla, id) from public.empresas);
  ar jsonb := (select jsonb_object_agg(nombre, id) from public.areas);
  u jsonb := '{}'; eq jsonb := '{}'; pr jsonb := '{}';
  r record; v uuid; o uuid; rep uuid; ped uuid; f uuid;
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  agente text := (select c->'opciones'->>0 from public.tipos_equipo t, jsonb_array_elements(t.campos) c where t.sigla = 'MAT' and c->>'clave' = 'agente');
begin
  if auth.uid() is not null then perform public._error('Los datos de ejemplo se cargan desde el SQL Editor de Supabase.'); end if;
  if exists (select 1 from public.equipos where ejemplo) or exists (select 1 from public.usuarios where ejemplo) then
    perform public._error('Los datos de ejemplo ya están cargados. Para cargarlos de nuevo, primero: select public.borrar_datos_ejemplo();');
  end if;
  if length(coalesce(p_clave, '')) < 8 then perform public._error('Elegí una clave de al menos 8 caracteres para los usuarios de ejemplo.'); end if;
  if emp->>'INY' is null or emp->>'LIM' is null or emp->>'PIN' is null or emp->>'SAL' is null then
    perform public._error('Faltan las empresas INY, LIM, PIN o SAL (los datos de ejemplo las usan).');
  end if;
  perform set_config('planta.carga_masiva', '1', true);   -- sin avisos ni registro de cada fila

  -- Usuarios (ingresan con la clave elegida)
  for r in select * from (values
      ('ej.encargado', 'Marta Gil (ejemplo)', 'encargado', array['INY','LIM']),
      ('ej.tecnico1', 'Diego Ríos (ejemplo)', 'tecnico', array['INY','LIM']),
      ('ej.tecnico2', 'Lucas Paz (ejemplo)', 'tecnico', array['PIN','SAL']),
      ('ej.operario1', 'Juan Gómez (ejemplo)', 'operario', array['INY']),
      ('ej.operario2', 'Rosa Benítez (ejemplo)', 'operario', array['SAL']),
      ('ej.direccion', 'Roberto Alonso (ejemplo)', 'direccion', array['INY','LIM','PIN','SAL'])) x(usuario, nombre, perfil, empresas) loop
    v := public._crear_usuario(r.usuario, r.nombre, r.perfil, p_clave, null, array(select (emp->>s)::uuid from unnest(r.empresas) s), true);
    u := u || jsonb_build_object(r.usuario, v);
  end loop;

  -- Proveedores y talleres
  for r in select * from (values ('bob', 'Bobinados Sur (ejemplo)', 'Motores eléctricos', '11 4555-1200'), ('hid', 'Hidráulica Norte (ejemplo)', 'Hidráulica y autoelevadores', '11 4777-3300'),
                                 ('fri', 'Frío Industrial SRL (ejemplo)', 'Refrigeración', '11 4321-8800'), ('ele', 'Electro Ramos (ejemplo)', 'Electricidad y tableros', '11 4612-0909')) x(k, nombre, rubro, tel) loop
    insert into public.proveedores (nombre, rubro, telefono, ejemplo) values (r.nombre, r.rubro, r.tel, true) returning id into v;
    pr := pr || jsonb_build_object(r.k, v);
  end loop;

  -- Equipos de las cuatro empresas (el código lo genera la base)
  for r in select * from (values
      ('iny1', 'INY', 'INY', 'Inyectora 280 t', 'Haitian', 'MA2800', 'alta', 'Producción', 'Nave 1, línea 1', '{"fuerza_cierre": 280}', 18450.0),
      ('iny2', 'INY', 'INY', 'Inyectora 450 t', 'Engel', 'Victory 450', 'alta', 'Producción', 'Nave 1, línea 2', '{"fuerza_cierre": 450}', 22310.0),
      ('sop1', 'INY', 'SOP', 'Sopladora PET 4 cavidades', 'Sidel', 'SBO 4', 'media', 'Producción', 'Nave 2', '{}', null),
      ('com1', 'INY', 'COM', 'Compresor a tornillo 30 HP', 'Atlas Copco', 'GA22', 'alta', 'Servicios', 'Sala de compresores', '{"presion": 8}', 31020.0),
      ('chi1', 'INY', 'CHI', 'Chiller 40 TR', 'Frigel', 'RSY 40', 'media', 'Servicios', 'Techo nave 1', '{}', null),
      ('mat1', 'INY', 'MAT', 'Matafuego ABC 10 kg (nave 1)', 'Georgia', null, 'baja', 'Producción', 'Columna 4', null, null),
      ('mez1', 'LIM', 'MEZ', 'Mezclador 2000 l', 'Inoxpa', null, 'alta', 'Producción', 'Sala de mezclas', '{}', null),
      ('env1', 'LIM', 'ENV', 'Envasadora lineal 4 picos', 'Tecnopack', 'EL-4', 'alta', 'Producción', 'Línea de envasado', '{}', null),
      ('apl1', 'LIM', 'APL', 'Apilador eléctrico 1,5 t', 'Toyota', 'SPE15', 'media', 'Depósito / logística', 'Depósito de producto terminado', '{"capacidad": 1500}', null),
      ('bom1', 'LIM', 'BOM', 'Bomba centrífuga 5 HP', 'Grundfos', 'CR 10', 'media', 'Producción', 'Sala de mezclas', '{}', null),
      ('dis1', 'PIN', 'MEZ', 'Dispersora 30 HP', 'Netzsch', null, 'alta', 'Producción', 'Planta de base agua', '{}', 9870.0),
      ('mol1', 'PIN', 'MEZ', 'Molino de perlas 50 l', 'Netzsch', 'LME 50', 'alta', 'Producción', 'Planta de base solvente', '{}', null),
      ('lat1', 'PIN', 'ENV', 'Envasadora de latas', 'Fillpack', null, 'media', 'Producción', 'Envasado', '{}', null),
      ('aut1', 'PIN', 'AUT', 'Autoelevador 2,5 t', 'Yale', 'GLP25', 'media', 'Depósito / logística', 'Depósito de materias primas', '{"capacidad": 2500}', 6120.0),
      ('tab1', 'PIN', 'TAB', 'Tablero general de baja tensión', 'Schneider', null, 'alta', 'Servicios', 'Sala de tableros', '{}', null),
      ('cal1', 'SAL', 'CAL', 'Caldera humotubular 2 t/h', 'Fontanet', null, 'alta', 'Servicios', 'Sala de calderas', '{}', 15400.0),
      ('mar1', 'SAL', 'MEZ', 'Marmita con agitador 1000 l', 'Inoxpa', null, 'alta', 'Producción', 'Cocina', '{}', null),
      ('doy1', 'SAL', 'ENV', 'Envasadora de doypack', 'Volpak', 'SI-280', 'alta', 'Producción', 'Envasado', '{}', null),
      ('cam1', 'SAL', 'CHI', 'Cámara de frío de producto terminado', 'Frío Industrial', null, 'media', 'Depósito / logística', 'Expedición', '{}', null),
      ('lob1', 'SAL', 'BOM', 'Bomba lobular', 'Alfa Laval', 'SRU 2', 'media', 'Producción', 'Cocina', '{}', null)
    ) x(k, e, tipo, nombre, marca, modelo, crit, area, lugar, campos, horas) loop
    insert into public.equipos (empresa_duena_id, tipo, nombre, marca, modelo, criticidad, area_id, ubicacion, campos, horometro, horometro_fecha, ejemplo, codigo, numero, creado_en)
    values ((emp->>r.e)::uuid, r.tipo, r.nombre, r.marca, r.modelo, r.crit, (ar->>r.area)::uuid, r.lugar,
            coalesce(r.campos::jsonb, jsonb_build_object('vencimiento', to_char(hoy + 20, 'YYYY-MM-DD'), 'agente', agente)),
            r.horas, case when r.horas is not null then hoy - 3 end, true, '', null, now() - interval '60 days')
    returning id into v;
    eq := eq || jsonb_build_object(r.k, v);
  end loop;

  -- 1. Máquina parada sin atender (SAL): reporte de la operaria
  insert into public.reportes_falla (equipo_id, tipo_falla, parada, texto, operario_id, hecho_en, ejemplo, creado_por, creado_en)
  values ((eq->>'doy1')::uuid, 'no_arranca', true, 'Se detuvo en medio del lote y no vuelve a arrancar', (u->>'ej.operario2')::uuid, now() - interval '25 minutes', true, (u->>'ej.operario2')::uuid, now() - interval '25 minutes');
  -- 2. Reporte sin parada (INY)
  insert into public.reportes_falla (equipo_id, tipo_falla, parada, texto, operario_id, hecho_en, ejemplo, creado_por, creado_en)
  values ((eq->>'com1')::uuid, 'ruido', false, 'Ruido metálico al arrancar', (u->>'ej.operario1')::uuid, now() - interval '2 hours', true, (u->>'ej.operario1')::uuid, now() - interval '2 hours');

  -- 3. Orden urgente en curso, desde un reporte con la máquina parada (INY)
  insert into public.reportes_falla (equipo_id, tipo_falla, parada, texto, operario_id, hecho_en, ejemplo, creado_por, creado_en)
  values ((eq->>'iny2')::uuid, 'perdida_aceite', true, 'Pierde aceite por el cilindro de cierre', (u->>'ej.operario1')::uuid, now() - interval '5 hours', true, (u->>'ej.operario1')::uuid, now() - interval '5 hours')
  returning id into rep;
  insert into public.ordenes (equipo_id, reporte_id, titulo, descripcion, estado, parada, asignado_a, ejemplo, creado_por, creado_en)
  values ((eq->>'iny2')::uuid, rep, 'Pérdida de aceite en el cilindro de cierre', 'Revisar sellos del cilindro y nivel del tanque', 'en_curso', true, (u->>'ej.tecnico1')::uuid, true, (u->>'ej.encargado')::uuid, now() - interval '4 hours 40 minutes')
  returning id into o;
  insert into public.fichas (orden_id, tecnico_id, trabajo, horas, horas_parada, ejemplo, creado_por, hecho_en, creado_en)
  values (o, (u->>'ej.tecnico1')::uuid, 'Desarme de la tapa del cilindro: sello principal cortado. Se pide el kit de sellos al pañol.', 1.5, 1.5, true, (u->>'ej.tecnico1')::uuid, now() - interval '3 hours', now() - interval '3 hours');

  -- 4. Orden esperando repuesto, con compra por aprobar (PIN)
  insert into public.ordenes (equipo_id, titulo, descripcion, tipo, estado, asignado_a, vence, ejemplo, creado_por, creado_en)
  values ((eq->>'dis1')::uuid, 'Vibración en el eje de la dispersora', 'Rodamiento inferior con juego', 'correctiva', 'esperando_repuesto', (u->>'ej.tecnico2')::uuid, hoy + 5, true, (u->>'ej.tecnico2')::uuid, now() - interval '2 days')
  returning id into o;
  insert into public.fichas (orden_id, tecnico_id, trabajo, horas, ejemplo, creado_por, hecho_en, creado_en)
  values (o, (u->>'ej.tecnico2')::uuid, 'Diagnóstico: rodamiento 6312 2RS con juego. Hay que cambiarlo.', 2, true, (u->>'ej.tecnico2')::uuid, now() - interval '2 days', now() - interval '2 days');
  insert into public.pedidos_compra (orden_id, equipo_id, empresa_id, descripcion, cantidad, monto_estimado, proveedor_id, estado, ejemplo, creado_por, creado_en)
  values (o, (eq->>'dis1')::uuid, (emp->>'PIN')::uuid, 'Rodamiento 6312 2RS + retén', 2, 180000, (pr->>'ele')::uuid, 'pendiente', true, (u->>'ej.tecnico2')::uuid, now() - interval '2 days');

  -- 5. Preventivo asignado que vence pronto (LIM) y 6. una orden vencida (SAL)
  insert into public.ordenes (equipo_id, titulo, tipo, estado, asignado_a, vence, ejemplo, creado_por, creado_en)
  values ((eq->>'mez1')::uuid, 'Cambio de aceite del reductor del agitador', 'preventiva', 'asignada', (u->>'ej.tecnico1')::uuid, hoy + 3, true, (u->>'ej.encargado')::uuid, now() - interval '6 days'),
         ((eq->>'cal1')::uuid, 'Revisión del quemador y limpieza de tubos', 'preventiva', 'asignada', (u->>'ej.tecnico2')::uuid, hoy - 2, true, (u->>'ej.encargado')::uuid, now() - interval '12 days');

  -- 7. Orden terminada, falta cerrarla (LIM)
  insert into public.ordenes (equipo_id, titulo, estado, asignado_a, terminada_en, ejemplo, creado_por, creado_en)
  values ((eq->>'bom1')::uuid, 'Pérdida por el sello mecánico', 'terminada', (u->>'ej.tecnico1')::uuid, now() - interval '1 day', true, (u->>'ej.encargado')::uuid, now() - interval '2 days')
  returning id into o;
  insert into public.fichas (orden_id, tecnico_id, es_cierre, trabajo, horas, horas_parada, causa, ejemplo, creado_por, hecho_en, creado_en)
  values (o, (u->>'ej.tecnico1')::uuid, true, 'Cambio de sello mecánico y prueba con agua', 2.5, 3, 'desgaste', true, (u->>'ej.tecnico1')::uuid, now() - interval '1 day', now() - interval '1 day');
  insert into public.costos_orden (orden_id, tipo, descripcion, cantidad, costo_unitario, ejemplo, creado_por)
  values (o, 'repuesto', 'Sello mecánico 25 mm', 1, 64000, true, (u->>'ej.tecnico1')::uuid);

  -- 8. Historia cerrada completa en un equipo crítico (INY): reporte, fichas, compra recibida y verificación de producción
  insert into public.reportes_falla (equipo_id, tipo_falla, parada, texto, operario_id, hecho_en, ejemplo, creado_por, creado_en)
  values ((eq->>'iny1')::uuid, 'temperatura', true, 'Alarma de temperatura del aceite hidráulico', (u->>'ej.operario1')::uuid, now() - interval '12 days', true, (u->>'ej.operario1')::uuid, now() - interval '12 days')
  returning id into rep;
  insert into public.ordenes (equipo_id, reporte_id, titulo, estado, parada, asignado_a, terminada_en, cerrada_en, prioridad_por, prioridad_en, ejemplo, creado_por, creado_en)
  values ((eq->>'iny1')::uuid, rep, 'Temperatura alta del aceite hidráulico', 'cerrada', true, (u->>'ej.tecnico1')::uuid, now() - interval '10 days', now() - interval '9 days',
          (u->>'ej.direccion')::uuid, now() - interval '12 days', true, (u->>'ej.encargado')::uuid, now() - interval '12 days')
  returning id into o;
  insert into public.fichas (orden_id, tecnico_id, trabajo, horas, horas_parada, ejemplo, creado_por, hecho_en, creado_en)
  values (o, (u->>'ej.tecnico1')::uuid, 'Intercambiador de calor tapado. Se pide el kit de limpieza.', 1, 2, true, (u->>'ej.tecnico1')::uuid, now() - interval '12 days', now() - interval '12 days');
  insert into public.pedidos_compra (orden_id, equipo_id, empresa_id, descripcion, cantidad, monto_estimado, estado, resuelto_por, resuelto_en, respuesta, ejemplo, creado_por, creado_en)
  values (o, (eq->>'iny1')::uuid, (emp->>'INY')::uuid, 'Kit de limpieza química para intercambiador', 1, 95000, 'recibido', (u->>'ej.direccion')::uuid, now() - interval '11 days', 'Ok, urgente', true, (u->>'ej.tecnico1')::uuid, now() - interval '12 days');
  insert into public.fichas (orden_id, tecnico_id, es_cierre, trabajo, horas, horas_parada, causa, supervisor_nombre, ejemplo, creado_por, hecho_en, creado_en)
  values (o, (u->>'ej.tecnico1')::uuid, true, 'Limpieza química del intercambiador y cambio de filtro de retorno. Temperatura normal en 45 °C.', 3, 6, 'falta_preventivo', 'Carla Méndez', true, (u->>'ej.tecnico1')::uuid, now() - interval '10 days', now() - interval '10 days');
  insert into public.costos_orden (orden_id, tipo, descripcion, cantidad, costo_unitario, ejemplo, creado_por)
  values (o, 'repuesto', 'Kit de limpieza química', 1, 91500, true, (u->>'ej.tecnico1')::uuid),
         (o, 'repuesto', 'Filtro de retorno hidráulico', 1, 38000, true, (u->>'ej.tecnico1')::uuid);

  -- Estados de los equipos que quedaron parados por los reportes históricos
  perform public._transicion();
  update public.equipos set estado = 'operativo' where id in ((eq->>'iny1')::uuid);
  update public.equipos set estado = 'detenido' where id = (eq->>'doy1')::uuid;
  update public.equipos set estado = 'en_reparacion' where id = (eq->>'iny2')::uuid;

  -- 9. Movimientos: préstamo en curso (LIM → INY), reparación externa (PIN) y un préstamo por aprobar (PIN → SAL)
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, area_origen_id, ubicacion_origen, empresa_destino_id, area_destino_id, ubicacion_destino,
         motivo, fecha_salida, fecha_vuelta_prevista, resuelto_por, resuelto_en, ejemplo, creado_en)
  values ((eq->>'apl1')::uuid, 'prestamo', 'en_curso', (emp->>'LIM')::uuid, (ar->>'Depósito / logística')::uuid, 'Depósito de producto terminado', (emp->>'INY')::uuid,
          (ar->>'Depósito / logística')::uuid, 'Depósito de INY', 'Pico de despachos en INY', hoy - 6, hoy + 15, (u->>'ej.direccion')::uuid, now() - interval '7 days', true, now() - interval '8 days');
  update public.equipos set empresa_ubicacion_id = (emp->>'INY')::uuid, ubicacion = 'Depósito de INY' where id = (eq->>'apl1')::uuid;
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, proveedor_id, fecha_salida, fecha_vuelta_prevista, presupuesto, remito, motivo, ejemplo, creado_en)
  values ((eq->>'aut1')::uuid, 'reparacion_externa', 'en_curso', (emp->>'PIN')::uuid, (pr->>'hid')::uuid, hoy - 4, hoy + 6, 420000, 'R-0002-00045123', 'Pérdida en el cilindro de elevación', true, now() - interval '4 days');
  update public.equipos set estado = 'reparacion_externa' where id = (eq->>'aut1')::uuid;
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, empresa_destino_id, ubicacion_destino, motivo, fecha_vuelta_prevista, ejemplo, creado_en)
  values ((eq->>'lat1')::uuid, 'prestamo', 'solicitado', (emp->>'PIN')::uuid, (emp->>'SAL')::uuid, 'Envasado', 'Prueba de envasado de aderezos en lata', hoy + 30, true, now() - interval '3 hours');

  insert into public.registro_cambios (usuario_id, nombre, perfil, operacion, tabla, registro, resumen)
  values (null, 'SQL Editor', null, 'alta', 'datos_ejemplo', null, 'Cargó los datos de ejemplo: 6 usuarios «ej.», 4 proveedores, 20 equipos, órdenes, reportes, compras y movimientos');

  return 'Datos de ejemplo cargados. Usuarios (contraseña: la que elegiste): ej.encargado, ej.tecnico1, ej.tecnico2, ej.operario1, ej.operario2, ej.direccion. '
      || 'Se borran con: select public.borrar_datos_ejemplo();';
end $$;

-- Borra todo lo marcado como ejemplo. Si mientras se probaba la app se cargaron cosas reales sobre datos de
-- ejemplo (por ejemplo, una orden en un equipo de ejemplo), se detiene y avisa: para borrarlas también,
-- se llama con p_tambien_lo_cargado_encima => true.
create or replace function public.borrar_datos_ejemplo(p_tambien_lo_cargado_encima boolean default false) returns text
language plpgsql security definer set search_path = public, auth as $$
declare reales int; n_eq int; n_us int; detalle text; t text;
begin
  if auth.uid() is not null then perform public._error('Los datos de ejemplo se borran desde el SQL Editor de Supabase.'); end if;
  create temp table b_us on commit drop as select id from public.usuarios where ejemplo;
  create temp table b_eq on commit drop as select id from public.equipos where ejemplo;
  create temp table b_rep on commit drop as select id, ejemplo from public.reportes_falla
    where ejemplo or equipo_id in (select id from b_eq) or operario_id in (select id from b_us) or creado_por in (select id from b_us);
  create temp table b_ord on commit drop as select id, ejemplo from public.ordenes
    where ejemplo or equipo_id in (select id from b_eq) or reporte_id in (select id from b_rep) or asignado_a in (select id from b_us) or prioridad_por in (select id from b_us) or creado_por in (select id from b_us);
  create temp table b_fic on commit drop as select id, ejemplo from public.fichas where ejemplo or orden_id in (select id from b_ord) or tecnico_id in (select id from b_us) or creado_por in (select id from b_us);
  create temp table b_cos on commit drop as select id, ejemplo from public.costos_orden where ejemplo or orden_id in (select id from b_ord) or creado_por in (select id from b_us);
  create temp table b_ped on commit drop as select id, ejemplo from public.pedidos_compra
    where ejemplo or orden_id in (select id from b_ord) or equipo_id in (select id from b_eq) or resuelto_por in (select id from b_us) or creado_por in (select id from b_us);
  create temp table b_mov on commit drop as select id, ejemplo from public.movimientos_equipo where ejemplo or equipo_id in (select id from b_eq) or resuelto_por in (select id from b_us) or creado_por in (select id from b_us);
  -- Lo real (no marcado como ejemplo) que quedaría colgado de datos de ejemplo
  select (select count(*) from b_rep where not ejemplo) + (select count(*) from b_ord where not ejemplo) + (select count(*) from b_fic where not ejemplo)
       + (select count(*) from b_cos where not ejemplo) + (select count(*) from b_ped where not ejemplo) + (select count(*) from b_mov where not ejemplo)
       + (select count(*) from public.documentos where equipo_id in (select id from b_eq))
    into reales;
  if reales > 0 and not p_tambien_lo_cargado_encima then
    select string_agg(x, ', ') into detalle from (
      select (select count(*) from b_rep where not ejemplo) || ' reportes' x union all select (select count(*) from b_ord where not ejemplo) || ' órdenes'
      union all select (select count(*) from b_fic where not ejemplo) || ' fichas' union all select (select count(*) from b_ped where not ejemplo) || ' pedidos de compra'
      union all select (select count(*) from b_mov where not ejemplo) || ' movimientos' union all select (select count(*) from public.documentos where equipo_id in (select id from b_eq)) || ' documentos') y
      where x !~ '^0 ';
    perform public._error('Hay ' || reales || ' registros cargados en la app sobre datos de ejemplo (' || detalle || '). '
      || 'Si también son de prueba, borralos junto con los de ejemplo: select public.borrar_datos_ejemplo(p_tambien_lo_cargado_encima => true);');
  end if;

  perform set_config('planta.carga_masiva', '1', true);
  perform set_config('planta.borrar_ejemplo', '1', true);
  delete from public.adjuntos where (tabla = 'reportes_falla' and registro_id in (select id from b_rep)) or (tabla = 'fichas' and registro_id in (select id from b_fic))
                                 or (tabla = 'costos_orden' and registro_id in (select id from b_cos)) or (tabla = 'movimientos_equipo' and registro_id in (select id from b_mov))
                                 or creado_por in (select id from b_us);
  delete from public.avisos where usuario_id in (select id from b_us);
  delete from public.fichas where id in (select id from b_fic);
  delete from public.costos_orden where id in (select id from b_cos);
  delete from public.pedidos_compra where id in (select id from b_ped);
  update public.reportes_falla set orden_id = null where id in (select id from b_rep) or orden_id in (select id from b_ord);
  delete from public.ordenes where id in (select id from b_ord);
  delete from public.reportes_falla where id in (select id from b_rep);
  delete from public.movimientos_equipo where id in (select id from b_mov);
  delete from public.documentos where equipo_id in (select id from b_eq);
  delete from public.equipo_alias where equipo_id in (select id from b_eq);
  select count(*) into n_eq from b_eq;
  delete from public.equipos where id in (select id from b_eq);
  delete from public.proveedores p where p.ejemplo
    and not exists (select 1 from public.equipos where proveedor_id = p.id) and not exists (select 1 from public.ordenes where contratista_id = p.id)
    and not exists (select 1 from public.fichas where contratista_id = p.id) and not exists (select 1 from public.costos_orden where proveedor_id = p.id)
    and not exists (select 1 from public.pedidos_compra where proveedor_id = p.id) and not exists (select 1 from public.movimientos_equipo where proveedor_id = p.id);
  -- Si un usuario de ejemplo modificó algo real (por ejemplo, editó una orden), solo se borra la referencia
  perform public._transicion();
  for t in select c.table_name from information_schema.columns c where c.table_schema = 'public' and c.column_name = 'modificado_por' and c.table_name <> 'registro_cambios' loop
    execute format('update public.%I set modificado_por = null where modificado_por in (select id from b_us)', t);
    execute format('update public.%I set creado_por = null where creado_por in (select id from b_us)', t);
  end loop;
  select count(*) into n_us from b_us;
  delete from public.usuarios where id in (select id from b_us);
  delete from auth.users where id in (select id from b_us);
  insert into public.registro_cambios (usuario_id, nombre, perfil, operacion, tabla, registro, resumen)
  values (null, 'SQL Editor', null, 'baja', 'datos_ejemplo', null, 'Borró los datos de ejemplo: ' || n_eq || ' equipos y ' || n_us || ' usuarios «ej.», con sus órdenes, reportes, compras y movimientos'
    || case when reales > 0 then ' (y ' || reales || ' registros cargados encima)' else '' end);
  return 'Datos de ejemplo borrados: ' || n_eq || ' equipos y ' || n_us || ' usuarios' || case when reales > 0 then ', y ' || reales || ' registros cargados encima' else '' end
    || '. Las fotos que se hayan subido mientras se probaba quedan en Storage (se pueden borrar desde Storage → adjuntos).';
end $$;
