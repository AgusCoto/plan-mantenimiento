-- =====================================================================
-- App de mantenimiento · Último paso · Permisos de ejecución de las funciones
-- Lo interno no se puede llamar desde la app; lo público, solo con sesión iniciada.
-- (Va al final para alcanzar a todas las funciones de las migraciones anteriores.)
-- =====================================================================
do $$
declare f record;
  publicas text[] := array['mi_perfil','es','es_mantenimiento','mi_empresa','activo','veo_equipo','veo_orden','trabajo_en','puedo_adjuntar',
    'orden_estado','orden_prioridad','descartar_reporte','pedir_repuesto','resolver_pedido','recibir_pedido','pedir_prestamo',
    'resolver_prestamo','mover_equipo','reparacion_externa','reubicar_equipo','baja_equipo','estado_equipo','cargar_horometro',
    'crear_usuario','editar_usuario','restablecer_clave','estado_usuario','cambiar_mi_clave','registrar_conflicto','prioridad_de',
    'guardar_tema','volver_a_tema','problemas_contraste','contraste'];
  -- Funciones de W-Main: no se tocan (W-Main sigue andando hasta que se publique la app nueva)
  w_main text[] := array['_empresa_de_codigo','asignar_numero_ot','borrar_codigo_operario','doc_update','estado_avisos_operario',
    'estado_codigos_operario','firma_propia','firmas_inmutables','mi_rol','nuevo_usuario','operario_ingresar','reglas_avisos',
    'reglas_tecnico','reportar_anomalia','set_codigo_operario','solo_cambia','verificar_firma_ot'];
begin
  for f in select p.oid::regprocedure as firma, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
             and p.proname <> all (w_main) loop
    execute format('revoke execute on function %s from public, anon', f.firma);
    if f.proname = any(publicas) then
      execute format('grant execute on function %s to authenticated', f.firma);
    else
      execute format('revoke execute on function %s from authenticated', f.firma);
    end if;
  end loop;
end $$;
