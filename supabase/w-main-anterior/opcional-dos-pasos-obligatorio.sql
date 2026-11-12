-- =====================================================================
-- OPCIONAL · Exigir la verificación en dos pasos al administrador
-- Ejecutar SOLO después de que todos los administradores la hayan activado
-- (W-Main → Mi cuenta → Seguridad), porque si no, no van a poder borrar
-- ni cambiar roles hasta activarla.
--
-- Con esto, aunque alguien robe la contraseña de un administrador, sin el
-- código del celular no puede eliminar datos ni cambiar permisos.
-- =====================================================================
drop policy if exists docs_borrar on public.docs;
create policy docs_borrar on public.docs for delete to authenticated
  using (public.mi_rol() = 'admin' and (auth.jwt()->>'aal') = 'aal2');

drop policy if exists perfiles_admin on public.perfiles;
create policy perfiles_admin on public.perfiles for update to authenticated
  using (public.mi_rol() = 'admin' and (auth.jwt()->>'aal') = 'aal2')
  with check (public.mi_rol() = 'admin' and (auth.jwt()->>'aal') = 'aal2');

-- Para volver atrás:
-- drop policy if exists docs_borrar on public.docs;
-- create policy docs_borrar on public.docs for delete to authenticated using (public.mi_rol() = 'admin');
-- drop policy if exists perfiles_admin on public.perfiles;
-- create policy perfiles_admin on public.perfiles for update to authenticated using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');
