-- =====================================================================
-- Gestión de Planta · Datos de ejemplo (OPCIONAL)
-- Equipos de las 4 empresas, órdenes, preventivos, reportes de operarios y dos semanas de
-- producción, ventas y compras, más una cuenta de ejemplo por perfil para probar la app.
-- Todo queda marcado como ejemplo: se borra desde el Tablero (gerente de mantenimiento →
-- «Borrar datos de ejemplo») o ejecutando supabase/borrar-datos-ejemplo.sql.
--
-- Cuentas de ejemplo (contraseña: ejemplo-1234):
--   ej-mantenimiento (código 1111) · ej-tecnico · ej-produccion (código 2222)
--   ej-administracion · ej-direccion (código 3333) · ej-operario (Inyectora)
-- =====================================================================
do $ej$
declare
  gm uuid; tec uuid; gp uuid; adm uuid; dir uuid; op uuid; op2 uuid;
  r1 uuid; r2 uuid; r3 uuid; o1 uuid; o2 uuid; o3 uuid; p1 uuid; p2 uuid; p3 uuid;
  dia date; k text; f numeric;
begin
  if exists (select 1 from public.cuentas where usuario = 'ej-mantenimiento') then
    raise notice 'Los datos de ejemplo ya estaban cargados.';
    return;
  end if;
  perform set_config('planta.carga_masiva', '1', true);

  gm  := public._crear_cuenta('ej-mantenimiento', 'Carlos Medina (ejemplo)',  'gm',  null,  'ejemplo-1234', '1111', true);
  tec := public._crear_cuenta('ej-tecnico',       'Diego Ríos (ejemplo)',     'tec', null,  'ejemplo-1234', null,   true);
  gp  := public._crear_cuenta('ej-produccion',    'Marcela Sosa (ejemplo)',   'gp',  null,  'ejemplo-1234', '2222', true);
  adm := public._crear_cuenta('ej-administracion','Lucía Ferreyra (ejemplo)', 'adm', null,  'ejemplo-1234', null,   true);
  dir := public._crear_cuenta('ej-direccion',     'Roberto Alonso (ejemplo)', 'dir', null,  'ejemplo-1234', '3333', true);
  op  := public._crear_cuenta('ej-operario',      'Juan Gómez (ejemplo)',     'op',  'INY', 'ejemplo-1234', null,   true);
  op2 := public._crear_cuenta('ej-operaria-sal',  'Sofía Paz (ejemplo)',      'op',  'SAL', 'ejemplo-1234', null,   true);

  insert into public.equipos (codigo, empresa, area, tipo, nombre, marca, modelo, ubicacion, estado, alta, autorizo_id, ejemplo, creado_por, creado) values
    ('INY-PRO-INY-001','INY','PRO','INY','Inyectora 280 t línea bidones','Haitian','MA2800','Nave 1, sector inyección','operativo', current_date - 400, gm, true, gm, now() - interval '400 days'),
    ('INY-PRO-SOP-001','INY','PRO','SOP','Sopladora botellas 1 L','Jomar','EBM-65','Nave 1, sector soplado','reparacion', current_date - 380, gm, true, gm, now() - interval '380 days'),
    ('INY-SER-COM-001','INY','SER','COM','Compresor de tornillo 30 HP','Atlas Copco','GA22','Sala de compresores','operativo', current_date - 500, gm, true, gm, now() - interval '500 days'),
    ('INY-SER-CHI-001','INY','SER','CHI','Chiller moldes 20 TR','Frigel','RCD-200','Exterior nave 1','operativo', current_date - 300, gm, true, gm, now() - interval '300 days'),
    ('LIM-PRO-MEZ-001','LIM','PRO','MEZ','Mezclador detergente 3000 L','Inox Sur','MX-3000','Planta líquidos','operativo', current_date - 250, gm, true, gm, now() - interval '250 days'),
    ('LIM-PRO-ENV-001','LIM','PRO','ENV','Envasadora lavandina 1 L','Envasa','EL-12','Línea 2','detenido', current_date - 240, gm, true, gm, now() - interval '240 days'),
    ('PIN-PRO-DIS-001','PIN','PRO','DIS','Dispersora 75 HP','Netzsch','DS-75','Sala de dispersión','operativo', current_date - 200, gm, true, gm, now() - interval '200 days'),
    ('PIN-LOG-APL-001','PIN','LOG','APL','Apilador eléctrico 1,5 t','Toyota','SPE150','Depósito producto terminado','operativo', current_date - 180, gm, true, gm, now() - interval '180 days'),
    ('SAL-PRO-MEZ-001','SAL','PRO','MEZ','Marmita con agitador 500 L','Inoxpa','MA-500','Cocina de salsas','operativo', current_date - 150, gm, true, gm, now() - interval '150 days'),
    ('SAL-PRO-ENV-001','SAL','PRO','ENV','Envasadora de sachets','Bossar','BMS-1600','Línea de envasado','operativo', current_date - 140, gm, true, gm, now() - interval '140 days'),
    ('SAL-SER-CAL-001','SAL','SER','CAL','Caldera humotubular 2 t/h','Fontanet','FHB-2000','Sala de calderas','operativo', current_date - 600, gm, true, gm, now() - interval '600 days');

  -- Reportes de operarios
  insert into public.reportes (equipo, tipo, detenida, descripcion, operario_id, operario_nombre, empresa, estado, ts, ejemplo)
    values ('LIM-PRO-ENV-001', 'No arranca', true, 'Al encender la línea salta la térmica del motor de la cinta. Probé dos veces.', op, 'Juan Gómez (ejemplo)', 'INY', 'nuevo', now() - interval '3 hours', true)
    returning id into r1;
  insert into public.reportes (equipo, tipo, detenida, descripcion, operario_id, operario_nombre, empresa, estado, ts, ejemplo)
    values ('SAL-PRO-ENV-001', 'Ruido', false, 'Chirrido en el rodillo sellador desde el cambio de bobina.', op2, 'Sofía Paz (ejemplo)', 'SAL', 'analisis', now() - interval '1 day', true)
    returning id into r2;
  insert into public.reportes (equipo, tipo, detenida, descripcion, operario_id, operario_nombre, empresa, estado, ts, ejemplo)
    values ('INY-PRO-SOP-001', 'Pérdida / fuga', true, 'Pierde aceite hidráulico debajo del cierre del molde; se formó un charco.', op, 'Juan Gómez (ejemplo)', 'INY', 'nuevo', now() - interval '2 days', true)
    returning id into r3;

  -- Órdenes de trabajo
  insert into public.ordenes (equipo, titulo, descripcion, tipo, prioridad, vence, asignado, estado, reporte_id, ejemplo, creado_por, creado)
    values ('INY-PRO-SOP-001', 'Pérdida de aceite hidráulico — revisar y corregir', 'Revisar sellos del cilindro de cierre. Preparar kit de sellos y 20 L de aceite ISO 46.', 'correctiva', 'alta', current_date + 1, 'Diego Ríos (ejemplo)', 'curso', r3, true, gm, now() - interval '40 hours')
    returning id into o1;
  insert into public.ordenes (equipo, titulo, descripcion, tipo, prioridad, vence, asignado, estado, ejemplo, creado_por, creado)
    values ('INY-SER-COM-001', 'Cambio de filtros de aire y aceite (4000 h)', 'Preventivo por horas. Kit de filtros en pañol.', 'preventiva', 'media', current_date + 4, 'Diego Ríos (ejemplo)', 'abierta', true, gm, now() - interval '1 day')
    returning id into o2;
  insert into public.ordenes (equipo, titulo, descripcion, tipo, prioridad, vence, asignado, estado, cerrada, cerrada_por, cerrada_por_nombre, ejemplo, creado_por, creado)
    values ('PIN-PRO-DIS-001', 'Vibración en el eje — balancear disco', 'Desbalanceo del disco dispersor.', 'correctiva', 'media', current_date - 6, 'Diego Ríos (ejemplo)', 'cerrada', now() - interval '5 days', gm, 'Carlos Medina (ejemplo)', true, gm, now() - interval '8 days')
    returning id into o3;
  insert into public.fichas (orden_id, tecnico_id, tecnico_nombre, fecha, trabajo, horas, parada, repuestos, resultado, ejemplo) values
    (o1, tec, 'Diego Ríos (ejemplo)', now() - interval '20 hours', 'Se desarmó el cilindro de cierre: sello principal cortado. Falta el kit, pedido a proveedor.', 2, 4, null, 'pendiente', true),
    (o3, tec, 'Diego Ríos (ejemplo)', now() - interval '6 days', 'Se balanceó el disco y se ajustaron los bulones del motor. Vibración dentro de rango.', 3.5, 4, 'Bulones M16 x4', 'terminado', true);
  update public.equipos set estado = 'reparacion' where codigo = 'INY-PRO-SOP-001';

  -- Preventivos (uno vencido, uno próximo)
  insert into public.preventivos (equipo, tarea, frecuencia, ultima, responsable, ejemplo) values
    ('INY-PRO-INY-001', 'Cambio de aceite hidráulico y filtro', 180, current_date - 190, 'Diego Ríos (ejemplo)', true) returning id into p1;
  insert into public.preventivos (equipo, tarea, frecuencia, ultima, responsable, ejemplo) values
    ('SAL-SER-CAL-001', 'Purga de fondo y control de nivel de agua', 7, current_date - 4, 'Diego Ríos (ejemplo)', true) returning id into p2;
  insert into public.preventivos (equipo, tarea, frecuencia, ultima, responsable, ejemplo) values
    ('INY-SER-CHI-001', 'Limpieza de condensador', 30, current_date - 10, 'Contratista Frío Sur', true) returning id into p3;
  insert into public.preventivos (equipo, tarea, frecuencia, ultima, responsable, ejemplo) values
    ('PIN-LOG-APL-001', 'Revisión de batería y bornes', 15, current_date - 9, 'Diego Ríos (ejemplo)', true);
  insert into public.preventivo_ejecuciones (preventivo_id, tecnico_id, tecnico_nombre, fecha, horas, obs, ejemplo) values
    (p2, tec, 'Diego Ríos (ejemplo)', (current_date - 4) + time '09:30', 0.5, 'Agua limpia, nivel correcto.', true),
    (p3, tec, 'Diego Ríos (ejemplo)', (current_date - 10) + time '11:00', 1.5, 'Condensador con pelusa, se lavó con agua a presión.', true);

  -- Dos semanas de producción, ventas y compras
  for dia in select generate_series(current_date - 13, current_date, interval '1 day')::date loop
    continue when extract(isodow from dia) = 7;
    foreach k in array array['INY','LIM','PIN','SAL'] loop
      f := 0.85 + random() * 0.3;
      insert into public.movimientos (tipo, empresa, fecha, producto, cantidad, turno, operario_id, operario_nombre, estado, ts, ejemplo)
      select 'produccion', k, dia, p.nombre, round(case k when 'INY' then 1800 when 'LIM' then 2400 when 'PIN' then 160 else 3000 end * f / 2),
             (array['Mañana','Tarde'])[1 + (p.orden % 2)], case when k = 'SAL' then op2 else op end,
             case when k = 'SAL' then 'Sofía Paz (ejemplo)' else 'Juan Gómez (ejemplo)' end,
             case when dia < current_date - 2 then 'revisado' else 'pendiente' end, dia + time '15:00', true
      from public.productos p where p.empresa = k and p.orden <= 2;
    end loop;
    if extract(isodow from dia) in (2, 4) then
      insert into public.movimientos (tipo, empresa, fecha, producto, cantidad, monto, contraparte, operario_id, operario_nombre, estado, ts, ejemplo) values
        ('venta', 'LIM', dia, 'Lavandina 1 L', 1200, 1200 * 950, 'Distribuidora Norte', op, 'Juan Gómez (ejemplo)', 'revisado', dia + time '16:00', true),
        ('venta', 'SAL', dia, 'Mayonesa 250 g', 2400, 2400 * 1100, 'Supermercados del Centro', op2, 'Sofía Paz (ejemplo)', 'pendiente', dia + time '16:30', true),
        ('compra', 'INY', dia, 'Polietileno de alta densidad (bolsas de 25 kg)', 40, 40 * 52000, 'Petroquímica Sur', op, 'Juan Gómez (ejemplo)', 'pendiente', dia + time '10:00', true);
    end if;
  end loop;
  update public.movimientos set estado = 'observado', nota = 'El parte de turno dice otra cantidad: revisar.', revisor_id = gp
    where id = (select id from public.movimientos where ejemplo and tipo = 'produccion' and empresa = 'PIN' order by fecha desc limit 1);

  insert into public.auditoria (operacion, tabla, resumen) values ('alta', 'config', 'Cargó los datos de ejemplo');
  raise notice 'Datos de ejemplo cargados.';
end $ej$;
