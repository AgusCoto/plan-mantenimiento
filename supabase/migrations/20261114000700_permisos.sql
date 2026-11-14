-- =====================================================================
-- App de mantenimiento · 7 · Permisos por perfil y por empresa (Row Level Security)
-- Cada usuario ve solo lo de sus empresas (como dueña o donde está el equipo); el jefe, todo.
-- Lo que no figura acá está prohibido. Los cambios de estado van por las funciones de reglas.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['empresas','usuarios','usuario_empresas','areas','tipos_equipo','listas','config','temas',
    'preferencias_usuario','proveedores','equipos','equipo_alias','documentos','movimientos_equipo','reportes_falla',
    'ordenes','fichas','costos_orden','pedidos_compra','adjuntos','registro_cambios'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Usuario activo cualquiera
create or replace function public.activo() returns boolean
language sql stable security definer set search_path = public as $$ select public.mi_perfil() is not null $$;

-- ---------- Configuración y listas: las ven todos los usuarios activos; las cambia el jefe ----------
select public._politica('ver', 'empresas', 'select', 'public.activo()');
select public._politica('crear', 'empresas', 'insert', null, 'public.es(''jefe'')');
select public._politica('modificar', 'empresas', 'update', 'public.es(''jefe'')', 'public.es(''jefe'')');
do $$
declare t text;
begin
  foreach t in array array['areas','tipos_equipo','listas','config'] loop
    perform public._politica('ver', t, 'select', 'public.activo()');
    perform public._politica('crear', t, 'insert', null, 'public.es(''jefe'')');
    perform public._politica('modificar', t, 'update', 'public.es(''jefe'')', 'public.es(''jefe'')');
  end loop;
end $$;

-- ---------- Usuarios: mantenimiento y dirección ven a todos; el operario, solo a sí mismo ----------
select public._politica('ver', 'usuarios', 'select', 'public.es(''jefe'',''encargado'',''tecnico'',''direccion'') or id = auth.uid()');
select public._politica('ver', 'usuario_empresas', 'select', 'public.es(''jefe'') or usuario_id = auth.uid()');

-- ---------- Apariencia: el tema activo lo ve cualquiera (también la pantalla de ingreso); lo cambia el jefe ----------
select public._politica('ver_activo', 'temas', 'select', 'activo or de_fabrica', null, 'anon, authenticated');
select public._politica('ver_versiones', 'temas', 'select', 'public.es(''jefe'')');
select public._politica('propias', 'preferencias_usuario', 'all', 'usuario_id = auth.uid()', 'usuario_id = auth.uid() and public.activo()');

-- ---------- Proveedores ----------
select public._politica('ver', 'proveedores', 'select', 'public.es(''jefe'',''encargado'',''tecnico'',''direccion'')');
select public._politica('crear', 'proveedores', 'insert', null, 'public.es(''jefe'')');
select public._politica('modificar', 'proveedores', 'update', 'public.es(''jefe'')', 'public.es(''jefe'')');

-- ---------- Equipos: los ve quien tiene acceso a su empresa; altas y cambios, el jefe ----------
select public._politica('ver', 'equipos', 'select', 'public.mi_empresa(empresa_duena_id) or public.mi_empresa(empresa_ubicacion_id)');
select public._politica('crear', 'equipos', 'insert', null, 'public.es(''jefe'')');
select public._politica('modificar', 'equipos', 'update', 'public.es(''jefe'')', 'public.es(''jefe'')');
select public._politica('ver', 'equipo_alias', 'select', 'public.veo_equipo(equipo_id)');

-- Documentos y manuales: solo mantenimiento
select public._politica('ver', 'documentos', 'select', 'public.es_mantenimiento() and public.veo_equipo(equipo_id)');
select public._politica('crear', 'documentos', 'insert', null, 'public.es(''jefe'')');
select public._politica('modificar', 'documentos', 'update', 'public.es(''jefe'')', 'public.es(''jefe'')');

-- Movimientos: los ven mantenimiento y dirección; se crean y resuelven con funciones
select public._politica('ver', 'movimientos_equipo', 'select', 'public.es(''jefe'',''encargado'',''tecnico'',''direccion'') and public.veo_equipo(equipo_id)');

-- ---------- Reportes de falla: cualquier usuario activo reporta (a su nombre); el operario ve los suyos ----------
select public._politica('ver', 'reportes_falla', 'select',
  'operario_id = auth.uid() or (public.es(''jefe'',''encargado'',''tecnico'',''direccion'') and public.veo_equipo(equipo_id))');
select public._politica('crear', 'reportes_falla', 'insert', null, 'public.activo() and operario_id = auth.uid() and public.veo_equipo(equipo_id)');

-- ---------- Órdenes: las ven mantenimiento y dirección; las crean y editan el jefe y el encargado ----------
select public._politica('ver', 'ordenes', 'select', 'public.es(''jefe'',''encargado'',''tecnico'',''direccion'') and public.veo_equipo(equipo_id)');
select public._politica('crear', 'ordenes', 'insert', null, 'public.es(''jefe'',''encargado'') and public.veo_equipo(equipo_id)');
select public._politica('modificar', 'ordenes', 'update', 'public.es(''jefe'',''encargado'') and public.veo_equipo(equipo_id)', 'public.es(''jefe'',''encargado'')');

-- ¿Puedo trabajar en esta orden? (técnico asignado, encargado o jefe)
create or replace function public.trabajo_en(p_orden uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ordenes o where o.id = p_orden and public.veo_equipo(o.equipo_id)
    and (public.es('jefe','encargado') or (public.es('tecnico') and o.asignado_a = auth.uid())))
$$;
create or replace function public.veo_orden(p_orden uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ordenes o where o.id = p_orden and public.veo_equipo(o.equipo_id))
$$;

-- Fichas: las cargan el técnico asignado, el encargado o el jefe. No se editan ni se borran.
select public._politica('ver', 'fichas', 'select', 'public.es(''jefe'',''encargado'',''tecnico'',''direccion'') and public.veo_orden(orden_id)');
select public._politica('crear', 'fichas', 'insert', null, 'public.trabajo_en(orden_id)');

-- Costos: repuestos los carga quien trabaja en la orden; servicios externos y otros, el jefe
select public._politica('ver', 'costos_orden', 'select', 'public.es(''jefe'',''encargado'',''tecnico'',''direccion'') and public.veo_orden(orden_id)');
select public._politica('crear', 'costos_orden', 'insert', null, 'public.trabajo_en(orden_id) and (tipo = ''repuesto'' or public.es(''jefe''))');

-- Pedidos de compra: los ven mantenimiento y dirección; sin orden los carga el jefe; desde una orden, pedir_repuesto()
select public._politica('ver', 'pedidos_compra', 'select', 'public.es(''jefe'',''encargado'',''tecnico'',''direccion'') and public.mi_empresa(empresa_id)');
select public._politica('crear', 'pedidos_compra', 'insert', null, 'public.es(''jefe'') and public.mi_empresa(empresa_id) and estado = ''pendiente''');

-- Fotos y videos: los adjunta quien cargó el registro; los ven mantenimiento y dirección, y el autor
create or replace function public.puedo_adjuntar(p_tabla text, p_registro uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return case p_tabla
    when 'reportes_falla'     then exists (select 1 from public.reportes_falla where id = p_registro and operario_id = auth.uid())
    when 'fichas'             then exists (select 1 from public.fichas where id = p_registro and creado_por = auth.uid())
    when 'costos_orden'       then exists (select 1 from public.costos_orden where id = p_registro and creado_por = auth.uid())
    when 'movimientos_equipo' then public.es('jefe') and exists (select 1 from public.movimientos_equipo where id = p_registro)
    else false end;
end $$;
select public._politica('ver', 'adjuntos', 'select', 'creado_por = auth.uid() or public.es(''jefe'',''encargado'',''tecnico'',''direccion'')');
select public._politica('crear', 'adjuntos', 'insert', null, 'public.puedo_adjuntar(tabla, registro_id) and split_part(ruta, ''/'', 1) = auth.uid()::text');

-- Registro de cambios: el jefe y dirección
select public._politica('ver', 'registro_cambios', 'select', 'public.es(''jefe'',''direccion'')');

-- =====================================================================
-- Archivos (Storage)
--   adjuntos/<usuario>/…   fotos y videos de reportes y fichas (privado)
--   documentos/<equipo>/…  manuales, planos, PLC, fotos de chapa (privado, solo mantenimiento)
--   marca/…                logo e íconos de la app (público: se ven en la pantalla de ingreso)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('adjuntos', 'adjuntos', false, 50 * 1024 * 1024,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 25 * 1024 * 1024)
on conflict (id) do update set public = false;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', true, 2 * 1024 * 1024, array['image/png','image/svg+xml','image/jpeg','image/webp'])
on conflict (id) do update set public = true;

drop policy if exists mant_adjuntos_subir on storage.objects;
create policy mant_adjuntos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'adjuntos' and public.activo() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists mant_adjuntos_ver on storage.objects;
create policy mant_adjuntos_ver on storage.objects for select to authenticated
  using (bucket_id = 'adjuntos' and ((storage.foldername(name))[1] = auth.uid()::text or public.es('jefe','encargado','tecnico','direccion')));
drop policy if exists mant_documentos_ver on storage.objects;
create policy mant_documentos_ver on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and public.es_mantenimiento());
drop policy if exists mant_documentos_subir on storage.objects;
create policy mant_documentos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and public.es('jefe'));
drop policy if exists mant_marca_subir on storage.objects;
create policy mant_marca_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'marca' and public.es('jefe'));
drop policy if exists mant_marca_cambiar on storage.objects;
create policy mant_marca_cambiar on storage.objects for update to authenticated
  using (bucket_id = 'marca' and public.es('jefe'));

-- ---------- Tiempo real ----------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['empresas','usuarios','areas','tipos_equipo','listas','config','temas','equipos','documentos',
    'movimientos_equipo','reportes_falla','ordenes','fichas','costos_orden','pedidos_compra','adjuntos'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

