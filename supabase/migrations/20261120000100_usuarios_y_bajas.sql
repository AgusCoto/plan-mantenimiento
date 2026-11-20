-- =====================================================================
-- App de mantenimiento · 13 · Cambiar el usuario de ingreso e informe de baja de equipos (20/11/2026)
--   · El jefe puede cambiar el usuario con el que ingresa cualquier persona (también el suyo).
--   · La baja de un equipo guarda fecha, motivo detallado, destino, quién lo retira y el valor de
--     venta o recupero, para el informe de baja.
-- Se puede correr más de una vez.
-- =====================================================================

-- Cambiar el usuario de ingreso (la contraseña sigue siendo la misma)
create or replace function public.cambiar_usuario(p_id uuid, p_usuario text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare u text := lower(btrim(coalesce(p_usuario, ''))); viejo text;
begin
  if not public.es('jefe') then perform public._error('Los usuarios los administra el jefe de mantenimiento.'); end if;
  if u !~ '^[a-z0-9._-]{3,30}$' then perform public._error('El usuario tiene que tener de 3 a 30 letras minúsculas, números, punto o guion.'); end if;
  select usuario into viejo from public.usuarios where id = p_id;
  if viejo is null then perform public._error('No existe el usuario.'); end if;
  if viejo = u then return; end if;
  if exists (select 1 from public.usuarios where usuario = u) or exists (select 1 from auth.users where email = public._email_de(u) and id <> p_id) then
    perform public._error('Ese usuario ya existe. Elegí otro.');
  end if;
  update public.usuarios set usuario = u where id = p_id;
  update auth.users set email = public._email_de(u), updated_at = now() where id = p_id;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', public._email_de(u)), updated_at = now()
    where user_id = p_id and provider = 'email';
end $$;
revoke execute on function public.cambiar_usuario(uuid, text) from public, anon;
grant execute on function public.cambiar_usuario(uuid, text) to authenticated;

-- Datos de la baja para el informe
alter table public.movimientos_equipo add column if not exists receptor text;          -- quién retira el equipo (comprador, chatarrero…)
alter table public.movimientos_equipo add column if not exists valor_recupero numeric(14,2) check (valor_recupero is null or valor_recupero >= 0);

drop function if exists public.baja_equipo(uuid, text, text);
create or replace function public.baja_equipo(p_equipo uuid, p_motivo text, p_destino text, p_fecha date default null,
  p_receptor text default null, p_valor numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.equipos; nid uuid;
begin
  if not public.es('jefe') then perform public._error('Las bajas las hace el jefe de mantenimiento.'); end if;
  e := public._equipo(p_equipo);
  if length(btrim(coalesce(p_motivo, ''))) < 10 then perform public._error('Explicá el motivo de la baja (al menos 10 caracteres): queda en el informe.'); end if;
  if not exists (select 1 from public.listas where lista = 'destino_baja' and clave = p_destino) then perform public._error('Elegí el destino: venta, desguace o chatarra.'); end if;
  if p_fecha is not null and p_fecha > current_date then perform public._error('La fecha de baja no puede ser futura.'); end if;
  if exists (select 1 from public.ordenes where equipo_id = p_equipo and estado not in ('cerrada','anulada')) then
    perform public._error('El equipo tiene órdenes abiertas: cerralas o anulalas antes de darlo de baja.');
  end if;
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, area_origen_id, ubicacion_origen, motivo, destino_baja, fecha_salida,
                                         receptor, valor_recupero, resuelto_por, resuelto_en)
  values (p_equipo, 'baja', 'cerrado', e.empresa_ubicacion_id, e.area_id, e.ubicacion, btrim(p_motivo), p_destino, coalesce(p_fecha, current_date),
          nullif(btrim(p_receptor), ''), p_valor, auth.uid(), now())
  returning id into nid;
  perform public._transicion();
  update public.equipos set estado = 'baja' where id = p_equipo;
  return nid;
end $$;
revoke execute on function public.baja_equipo(uuid, text, text, date, text, numeric) from public, anon;
grant execute on function public.baja_equipo(uuid, text, text, date, text, numeric) to authenticated;
