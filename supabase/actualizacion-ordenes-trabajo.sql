-- =====================================================================
-- Actualización: órdenes de trabajo numeradas y cambios firmados
-- Pegar en Supabase → SQL Editor → New query → Run (una sola vez).
-- Se puede volver a ejecutar sin problemas.
-- =====================================================================

-- 1) Número de orden de trabajo ascendente (OT-000001, OT-000002, …).
--    Lo asigna la base al crear cada orden, así nunca se repite aunque
--    se carguen dos al mismo tiempo desde distintas computadoras.
create sequence if not exists public.ot_numero_seq;

create or replace function public.asignar_numero_ot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.col = 'ots' and (new.data->>'numero') is null then
    new.data := new.data || jsonb_build_object('numero', nextval('public.ot_numero_seq'));
  end if;
  return new;
end $$;

drop trigger if exists ot_numero on public.docs;
create trigger ot_numero before insert on public.docs
  for each row execute function public.asignar_numero_ot();

-- Numera las órdenes que ya existían, por fecha de reporte.
do $$
declare r record;
begin
  for r in select id from public.docs
           where col = 'ots' and (data->>'numero') is null
           order by data->>'reportado', id
  loop
    update public.docs set data = data || jsonb_build_object('numero', nextval('public.ot_numero_seq'))
     where col = 'ots' and id = r.id;
  end loop;
end $$;

-- 2) Toda modificación de una orden tiene que ir firmada: el programa agrega
--    al historial quién hizo el cambio, y la base verifica que esa persona
--    sea la que inició sesión con su contraseña para ese cambio.
create or replace function public.verificar_firma_ot() returns trigger
language plpgsql set search_path = public as $$
declare
  n_old int := coalesce(jsonb_array_length(old.data->'historial'), 0);
  n_new int := coalesce(jsonb_array_length(new.data->'historial'), 0);
begin
  if new.col <> 'ots' or auth.uid() is null then
    return new;  -- otras colecciones, o cambios hechos a mano desde el panel de Supabase
  end if;
  if n_new <= n_old then
    raise exception 'FIRMA: el cambio de la orden de trabajo tiene que estar firmado por un técnico';
  end if;
  if (new.data->'historial'->(n_new - 1)->>'porId') is distinct from auth.uid()::text then
    raise exception 'FIRMA: la firma no corresponde al usuario que hizo el cambio';
  end if;
  if new.data->>'numero' is distinct from old.data->>'numero' then
    raise exception 'FIRMA: el número de orden de trabajo no se puede cambiar';
  end if;
  return new;
end $$;

drop trigger if exists ot_firma on public.docs;
create trigger ot_firma before update on public.docs
  for each row execute function public.verificar_firma_ot();
