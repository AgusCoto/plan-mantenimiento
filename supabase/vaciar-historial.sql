-- =====================================================================
-- VACIAR EL HISTORIAL  ·  ATENCIÓN: borra datos y no se puede deshacer.
-- Pegar en Supabase → SQL Editor → New query → Run.
--
-- Borra: todas las órdenes de trabajo, todos los registros del historial
-- (intervenciones, altas, traslados y bajas) y las conclusiones de los
-- informes mensuales. La numeración de órdenes vuelve a empezar en OT-000001.
--
-- NO borra: equipos, tareas del plan, checklists, manuales, configuración,
-- usuarios ni firmas digitales.
-- =====================================================================

begin;

delete from public.docs where col in ('ots', 'registros', 'informes');

-- Numeración de órdenes desde 1
alter sequence public.ot_numero_seq restart with 1;

-- Las tareas del plan quedan con su última fecha de realización tal como estaba.
-- Si también querés que vuelvan a quedar "sin datos", sacá los dos guiones
-- de la línea siguiente:
-- update public.docs set data = data - 'ultimaFecha' - 'ultimaHoras' where col = 'tareas';

-- Si también querés borrar los equipos y tareas DE EJEMPLO (los que empiezan con "EJEMPLO"),
-- sacá los guiones de las tres líneas siguientes:
-- delete from public.docs where col = 'tareas' and data->>'equipoId' in (select id from public.docs where col = 'equipos' and data->>'nombre' like 'EJEMPLO%');
-- delete from public.docs where col = 'checklists' and id in (select id from public.docs where col = 'equipos' and data->>'nombre' like 'EJEMPLO%');
-- delete from public.docs where col = 'equipos' and data->>'nombre' like 'EJEMPLO%';

commit;

select col as coleccion, count(*) as quedan from public.docs group by col order by col;
