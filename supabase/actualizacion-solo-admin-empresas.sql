-- Actualización: solo un administrador puede modificar empresas, áreas y tipos.
-- Pegar en Supabase → SQL Editor → New query → Run (una sola vez).
drop policy if exists docs_crear on public.docs;
create policy docs_crear on public.docs for insert to authenticated
  with check (public.mi_rol() = 'admin' or (public.mi_rol() = 'tecnico' and col <> 'config'));
drop policy if exists docs_modificar on public.docs;
create policy docs_modificar on public.docs for update to authenticated
  using (public.mi_rol() = 'admin' or (public.mi_rol() = 'tecnico' and col <> 'config'))
  with check (public.mi_rol() = 'admin' or (public.mi_rol() = 'tecnico' and col <> 'config'));
