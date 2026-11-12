-- =====================================================================
-- Gestión de Planta · Borrar los datos de ejemplo
-- Hace lo mismo que el botón «Borrar datos de ejemplo» del Tablero: borra todo lo marcado
-- como ejemplo y desactiva las cuentas de ejemplo. Lo que cargaron ustedes queda.
-- =====================================================================
do $$
declare n int;
begin
  perform set_config('planta.carga_masiva', '1', true);
  delete from public.movimientos where ejemplo;
  delete from public.adjuntos where ejemplo;
  update public.ordenes set reporte_id = null where ejemplo or reporte_id in (select id from public.reportes where ejemplo);
  delete from public.reportes where ejemplo;
  delete from public.preventivos where ejemplo;
  delete from public.ordenes where ejemplo;
  delete from public.manuales where ejemplo;
  delete from public.equipos e where e.ejemplo
    and not exists (select 1 from public.ordenes o where o.equipo = e.codigo)
    and not exists (select 1 from public.reportes r where r.equipo = e.codigo)
    and not exists (select 1 from public.movimientos v where v.equipo = e.codigo);
  update public.cuentas set activo = false where ejemplo and activo;
  update auth.users set banned_until = '2999-12-31'::timestamptz where id in (select id from public.cuentas where ejemplo);
  insert into public.auditoria (operacion, tabla, resumen) values ('baja', 'config', 'Borró los datos de ejemplo y desactivó las cuentas de ejemplo');
  raise notice 'Datos de ejemplo borrados.';
end $$;
