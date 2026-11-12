-- =====================================================================
-- Gestión de Planta · 6/6 · Archivos (Storage), tiempo real y datos de ejemplo
-- =====================================================================

-- ---------- Buckets privados ----------
-- reportes/<id del operario>/<archivo>: fotos (JPEG comprimido en el celular) y videos MP4 / MOV del iPhone.
-- manuales/<código del equipo>/<archivo>.pdf  (el bucket ya existía en W-Main: se reutiliza).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reportes', 'reportes', false, 50 * 1024 * 1024,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manuales', 'manuales', false, 20 * 1024 * 1024, array['application/pdf'])
on conflict (id) do update set public = false;

drop policy if exists planta_reportes_subir on storage.objects;
create policy planta_reportes_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'reportes' and public.tiene_rol('op') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists planta_reportes_ver on storage.objects;
create policy planta_reportes_ver on storage.objects for select to authenticated
  using (bucket_id = 'reportes' and (public.es_gestion() or (storage.foldername(name))[1] = auth.uid()::text));

drop policy if exists planta_manuales_ver on storage.objects;
create policy planta_manuales_ver on storage.objects for select to authenticated
  using (bucket_id = 'manuales' and public.es_gestion());
drop policy if exists planta_manuales_subir on storage.objects;
create policy planta_manuales_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'manuales' and public.tiene_rol('gm'));
drop policy if exists planta_manuales_borrar on storage.objects;
create policy planta_manuales_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'manuales' and public.tiene_rol('gm'));

-- Cambiar el límite de video (MB). Se usa desde el SQL Editor, por ejemplo: select public.limite_video(100);
-- Ojo: el plan gratuito de Supabase no acepta archivos de más de 50 MB aunque el límite sea mayor.
create or replace function public.limite_video(mb int) returns text
language plpgsql security definer set search_path = public as $$
begin
  if mb < 1 or mb > 5000 then raise exception 'Indicá un límite entre 1 y 5000 MB.'; end if;
  update public.config set valor = to_jsonb(mb) where clave = 'limite_video_mb';
  update storage.buckets set file_size_limit = greatest(mb, coalesce((select (valor)::int from public.config where clave = 'limite_foto_mb'), 15)) * 1024 * 1024
    where id = 'reportes';
  return 'Límite de video: ' || mb || ' MB';
end $$;
revoke execute on function public.limite_video(int) from public, anon, authenticated;

-- ---------- Crear un reporte con sus fotos y videos en un solo paso ----------
create or replace function public.crear_reporte(p_equipo text, p_tipo text, p_detenida boolean, p_descripcion text, p_adjuntos jsonb default '[]')
returns uuid language plpgsql set search_path = public as $$
declare rid uuid; x jsonb;
begin
  insert into public.reportes (equipo, tipo, detenida, descripcion) values (p_equipo, p_tipo, coalesce(p_detenida, false), p_descripcion)
    returning id into rid;
  for x in select * from jsonb_array_elements(coalesce(p_adjuntos, '[]'::jsonb)) loop
    insert into public.adjuntos (reporte_id, ruta, tipo, mime, bytes)
    values (rid, x->>'ruta', x->>'tipo', x->>'mime', (x->>'bytes')::bigint);
  end loop;
  return rid;
end $$;
revoke execute on function public.crear_reporte(text, text, boolean, text, jsonb) from public, anon;
grant execute on function public.crear_reporte(text, text, boolean, text, jsonb) to authenticated;

-- ---------- Datos de ejemplo ----------
-- Borra todo lo marcado como ejemplo y desactiva las cuentas de ejemplo. Lo real queda.
create or replace function public.borrar_datos_ejemplo() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare n int := 0; m int;
begin
  if not public.tiene_rol('gm') then raise exception 'Solo el gerente de mantenimiento puede borrar los datos de ejemplo.' using errcode = '42501'; end if;
  if (select ejemplo from public.cuentas where id = auth.uid()) then
    raise exception 'Estás usando una cuenta de ejemplo. Creá tu propia cuenta, entrá con ella y después borrá los datos de ejemplo.';
  end if;
  delete from public.movimientos where ejemplo; get diagnostics m = row_count; n := n + m;
  delete from public.adjuntos where ejemplo;
  update public.ordenes set reporte_id = null where ejemplo or reporte_id in (select id from public.reportes where ejemplo);
  delete from public.reportes where ejemplo; get diagnostics m = row_count; n := n + m;
  delete from public.preventivos where ejemplo; get diagnostics m = row_count; n := n + m;
  delete from public.ordenes where ejemplo; get diagnostics m = row_count; n := n + m;
  delete from public.manuales where ejemplo;
  delete from public.equipos e where e.ejemplo
    and not exists (select 1 from public.ordenes o where o.equipo = e.codigo)
    and not exists (select 1 from public.reportes r where r.equipo = e.codigo)
    and not exists (select 1 from public.movimientos v where v.equipo = e.codigo);
  get diagnostics m = row_count; n := n + m;
  update public.cuentas set activo = false where ejemplo and activo;
  update auth.users set banned_until = '2999-12-31'::timestamptz where id in (select id from public.cuentas where ejemplo);
  return jsonb_build_object('ok', true, 'borrados', n);
end $$;
revoke execute on function public.borrar_datos_ejemplo() from public, anon;
grant execute on function public.borrar_datos_ejemplo() to authenticated;

-- ---------- Tiempo real: la app se actualiza sola cuando otro carga algo ----------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Sin publicación supabase_realtime: la app se actualiza al recargar.';
    return;
  end if;
  foreach t in array array['empresas','cuentas','equipos','equipo_eventos','manuales','ordenes','fichas','preventivos',
                           'preventivo_ejecuciones','reportes','adjuntos','movimientos'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Funciones auxiliares sin acceso desde la app
revoke execute on function public._nombre_cuenta(uuid) from public, anon, authenticated;
revoke execute on function public.rol_actual(), public.tiene_rol(text[]), public.es_gestion(), public._solo_cambian(jsonb, jsonb, text[]),
  public.reubicar_equipo(text, text, text, text, text), public.estado_equipo(text, text, text) from public, anon;
grant execute on function public.rol_actual(), public.tiene_rol(text[]), public.es_gestion(), public._solo_cambian(jsonb, jsonb, text[]),
  public.reubicar_equipo(text, text, text, text, text), public.estado_equipo(text, text, text) to authenticated;
