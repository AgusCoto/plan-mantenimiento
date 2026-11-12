-- =====================================================================
-- Gestión de Planta · 3/6 · Reglas de negocio (triggers) y permisos por rol (RLS)
-- Los permisos se cumplen acá, en la base: ocultar un botón en la app no alcanza.
-- =====================================================================

-- true si entre a y b solo cambiaron las columnas permitidas (y los sellos)
create or replace function public._solo_cambian(a jsonb, b jsonb, permitidas text[]) returns boolean
language sql immutable as $$
  select not exists (
    select 1 from jsonb_each(a) x
    where not (x.key = any(permitidas || array['creado_por','creado','modificado_por','modificado']))
      and (b -> x.key) is distinct from x.value)
$$;

create or replace function public._nombre_cuenta(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select nombre from public.cuentas where id = u
$$;

-- ---------- Autoría: quien carga una ficha, un reporte o un movimiento es quien está conectado ----------
create or replace function public.autoria_tecnico() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.tecnico_id := auth.uid(); end if;
  new.tecnico_nombre := coalesce(public._nombre_cuenta(new.tecnico_id), new.tecnico_nombre);
  return new;
end $$;
drop trigger if exists b_autoria on public.fichas;
create trigger b_autoria before insert on public.fichas for each row execute function public.autoria_tecnico();
drop trigger if exists b_autoria on public.preventivo_ejecuciones;
create trigger b_autoria before insert on public.preventivo_ejecuciones for each row execute function public.autoria_tecnico();

create or replace function public.autoria_operario() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.cuentas;
begin
  if auth.uid() is not null then
    new.operario_id := auth.uid();
    select * into c from public.cuentas where id = auth.uid();
    new.operario_nombre := c.nombre;
    new.ts := now();
    if tg_table_name = 'reportes' then
      new.empresa := coalesce(c.empresa, new.empresa);
      new.estado := 'nuevo'; new.nota := null; new.orden_id := null;
    else
      new.estado := 'pendiente'; new.nota := null; new.revisor_id := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists b_autoria on public.reportes;
create trigger b_autoria before insert on public.reportes for each row execute function public.autoria_operario();
drop trigger if exists b_autoria on public.movimientos;
create trigger b_autoria before insert on public.movimientos for each row execute function public.autoria_operario();

-- Producción revisa u observa: solo cambia estado, nota y revisor (queda a su nombre)
create or replace function public.revision_movimiento() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not public._solo_cambian(to_jsonb(old), to_jsonb(new), array['estado','nota','revisor_id']) then
    raise exception 'Solo se puede revisar u observar el registro; los datos los carga el operario.' using errcode = '42501';
  end if;
  new.revisor_id := auth.uid();
  return new;
end $$;
drop trigger if exists b_revision on public.movimientos;
create trigger b_revision before update on public.movimientos for each row execute function public.revision_movimiento();

-- ---------- Órdenes ----------
create or replace function public.reglas_orden() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('ordenes.numero'));
    if auth.uid() is not null or new.numero is null then
      select coalesce(max(numero), 0) + 1 into new.numero from public.ordenes;
    end if;
  elsif new.numero is distinct from old.numero then
    raise exception 'El número de la orden no se puede cambiar.' using errcode = '42501';
  end if;
  if new.estado = 'cerrada' and (tg_op = 'INSERT' or old.estado <> 'cerrada') then
    new.cerrada := case when auth.uid() is null and new.cerrada is not null then new.cerrada else now() end;
    new.cerrada_por := coalesce(auth.uid(), new.cerrada_por);
    new.cerrada_por_nombre := coalesce(public._nombre_cuenta(auth.uid()), new.cerrada_por_nombre);
  elsif new.estado <> 'cerrada' then
    new.cerrada := null; new.cerrada_por := null; new.cerrada_por_nombre := null;
  elsif tg_op = 'UPDATE' then
    new.cerrada := old.cerrada; new.cerrada_por := old.cerrada_por; new.cerrada_por_nombre := old.cerrada_por_nombre;
  end if;
  return new;
end $$;
drop trigger if exists b_reglas on public.ordenes;
create trigger b_reglas before insert or update on public.ordenes for each row execute function public.reglas_orden();

-- Una OT creada desde un reporte deja el reporte como "OT generada"
create or replace function public.orden_desde_reporte() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reporte_id is not null then
    update public.reportes set estado = 'ot', orden_id = new.id where id = new.reporte_id;
  end if;
  return new;
end $$;
drop trigger if exists c_desde_reporte on public.ordenes;
create trigger c_desde_reporte after insert on public.ordenes for each row execute function public.orden_desde_reporte();

-- La ficha del técnico mueve la orden: "En curso" o, si terminó, "Para revisar"
create or replace function public.ficha_mueve_orden() returns trigger
language plpgsql security definer set search_path = public as $$
declare est text;
begin
  if auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' then return new; end if;
  select estado into est from public.ordenes where id = new.orden_id for update;
  if est = 'cerrada' then
    raise exception 'La orden está cerrada: pedile al gerente que la reabra.' using errcode = '42501';
  end if;
  update public.ordenes set estado = case when new.resultado = 'terminado' then 'revisar' else 'curso' end where id = new.orden_id;
  return new;
end $$;
drop trigger if exists c_mueve_orden on public.fichas;
create trigger c_mueve_orden after insert on public.fichas for each row execute function public.ficha_mueve_orden();

-- Registrar un preventivo actualiza la última realización
create or replace function public.ejecucion_actualiza_preventivo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.preventivos set ultima = greatest(coalesce(ultima, (new.fecha)::date), (new.fecha)::date) where id = new.preventivo_id;
  return new;
end $$;
drop trigger if exists c_actualiza on public.preventivo_ejecuciones;
create trigger c_actualiza after insert on public.preventivo_ejecuciones for each row execute function public.ejecucion_actualiza_preventivo();

-- ---------- Equipos: el código no cambia; los movimientos quedan en su historial ----------
create or replace function public.reglas_equipo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.codigo is distinct from old.codigo then
    raise exception 'El código del equipo no se puede cambiar (la etiqueta QR depende de él).' using errcode = '42501';
  end if;
  if auth.uid() is not null and (new.alta is distinct from old.alta or new.autorizo_id is distinct from old.autorizo_id) then
    raise exception 'La fecha de alta y quién la autorizó no se pueden cambiar.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists b_reglas on public.equipos;
create trigger b_reglas before update on public.equipos for each row execute function public.reglas_equipo();

create or replace function public.historial_equipo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  quien text := coalesce(public._nombre_cuenta(auth.uid()), 'Sistema');
  motivo text := nullif(current_setting('planta.motivo', true), '');
  e_ant text; e_nue text;
begin
  if tg_op = 'INSERT' then
    insert into public.equipo_eventos (equipo, texto, ejemplo) values (new.codigo,
      'Alta del equipo · ' || quien || coalesce(' (autorizó ' || public._nombre_cuenta(new.autorizo_id) || ')', ''), new.ejemplo);
    return new;
  end if;
  if (new.empresa, new.area, coalesce(new.ubicacion,'')) is distinct from (old.empresa, old.area, coalesce(old.ubicacion,'')) then
    select nombre into e_ant from public.empresas where sigla = old.empresa;
    select nombre into e_nue from public.empresas where sigla = new.empresa;
    insert into public.equipo_eventos (equipo, texto, ejemplo) values (new.codigo,
      'Reubicado de ' || e_ant || ' / ' || coalesce(nullif(old.ubicacion,''),'—') || ' a ' || e_nue || ' / ' || coalesce(nullif(new.ubicacion,''),'—')
      || coalesce(' (' || motivo || ')', '') || ' · ' || quien, new.ejemplo);
  end if;
  if new.estado is distinct from old.estado then
    insert into public.equipo_eventos (equipo, texto, ejemplo) values (new.codigo,
      case new.estado when 'baja' then 'Baja' when 'operativo' then case when old.estado = 'baja' then 'Equipo reactivado' else 'Operativo' end
        when 'detenido' then 'Detenido' else 'En reparación' end
      || coalesce(': ' || motivo, '') || ' · ' || quien, new.ejemplo);
  end if;
  return new;
end $$;
drop trigger if exists c_historial on public.equipos;
create trigger c_historial after insert or update on public.equipos for each row execute function public.historial_equipo();

-- Reubicar y cambiar de estado con motivo (los permisos los controla RLS: solo el gerente de mantenimiento)
create or replace function public.reubicar_equipo(p_codigo text, p_empresa text, p_area text, p_ubicacion text, p_motivo text default null)
returns void language plpgsql set search_path = public as $$
begin
  perform set_config('planta.motivo', coalesce(p_motivo, ''), true);
  update public.equipos set empresa = p_empresa, area = p_area, ubicacion = nullif(btrim(p_ubicacion), '') where codigo = p_codigo;
  if not found then raise exception 'No tenés permiso para reubicar este equipo, o no existe.' using errcode = '42501'; end if;
end $$;

create or replace function public.estado_equipo(p_codigo text, p_estado text, p_motivo text default null)
returns void language plpgsql set search_path = public as $$
begin
  if p_estado = 'baja' and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indicá el motivo de la baja.';
  end if;
  perform set_config('planta.motivo', coalesce(p_motivo, ''), true);
  update public.equipos set estado = p_estado where codigo = p_codigo;
  if not found then raise exception 'No tenés permiso para cambiar el estado de este equipo, o no existe.' using errcode = '42501'; end if;
end $$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.empresas               enable row level security;
alter table public.areas                  enable row level security;
alter table public.tipos_equipo           enable row level security;
alter table public.productos              enable row level security;
alter table public.config                 enable row level security;
alter table public.cuentas                enable row level security;
alter table public.codigos_acceso         enable row level security;  -- sin políticas: nadie la lee
alter table public.intentos_codigo        enable row level security;  -- sin políticas
alter table public.equipos                enable row level security;
alter table public.equipo_alias           enable row level security;
alter table public.equipo_eventos         enable row level security;
alter table public.manuales               enable row level security;
alter table public.ordenes                enable row level security;
alter table public.fichas                 enable row level security;
alter table public.preventivos            enable row level security;
alter table public.preventivo_ejecuciones enable row level security;
alter table public.reportes               enable row level security;
alter table public.adjuntos               enable row level security;
alter table public.movimientos            enable row level security;

-- Vuelve a crear una política (para poder ejecutar el archivo más de una vez)
create or replace function public._politica(nombre text, tabla text, cmd text, usando text, chequeo text default null) returns void
language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', nombre, tabla);
  execute format('create policy %I on public.%I for %s to authenticated %s %s', nombre, tabla, cmd,
    case when usando is null then '' else 'using (' || usando || ')' end,
    case when chequeo is null then '' else 'with check (' || chequeo || ')' end);
end $$;

-- Catálogos: los ve cualquier cuenta activa. Cambiar el nombre de una empresa: renombrar_empresa() con código.
select public._politica('ver', 'empresas',     'select', 'public.rol_actual() is not null');
select public._politica('ver', 'areas',        'select', 'public.rol_actual() is not null');
select public._politica('ver', 'tipos_equipo', 'select', 'public.rol_actual() is not null');
select public._politica('ver', 'productos',    'select', 'public.rol_actual() is not null');
select public._politica('ver', 'config',       'select', 'public.rol_actual() is not null');

-- Cuentas: gestión ve todas; el operario solo la suya. Altas y cambios: funciones de cuentas.
select public._politica('ver', 'cuentas', 'select', 'public.es_gestion() or id = auth.uid()');

-- Equipos: los ven todos (el operario elige la máquina). Alta: alta_equipo() con código. Cambios: gerente de mantenimiento.
select public._politica('ver',       'equipos', 'select', 'public.rol_actual() is not null');
select public._politica('modificar', 'equipos', 'update', 'public.tiene_rol(''gm'')', 'public.tiene_rol(''gm'')');
select public._politica('ver', 'equipo_alias',   'select', 'public.rol_actual() is not null');
select public._politica('ver', 'equipo_eventos', 'select', 'public.es_gestion()');

select public._politica('ver',    'manuales', 'select', 'public.es_gestion()');
select public._politica('cargar', 'manuales', 'insert', null, 'public.tiene_rol(''gm'')');
select public._politica('quitar', 'manuales', 'delete', 'public.tiene_rol(''gm'')');

-- Órdenes: las ve toda la gestión; las crea y administra el gerente de mantenimiento.
select public._politica('ver',       'ordenes', 'select', 'public.es_gestion()');
select public._politica('crear',     'ordenes', 'insert', null, 'public.tiene_rol(''gm'')');
select public._politica('modificar', 'ordenes', 'update', 'public.tiene_rol(''gm'')', 'public.tiene_rol(''gm'')');

-- Fichas: las cargan técnicos y gerente de mantenimiento, siempre a su nombre. No se editan ni se borran.
select public._politica('ver',    'fichas', 'select', 'public.es_gestion()');
select public._politica('cargar', 'fichas', 'insert', null, 'public.tiene_rol(''gm'',''tec'') and tecnico_id = auth.uid()');

-- Preventivos: los programa el gerente de mantenimiento; los registran técnicos y gerente.
select public._politica('ver',       'preventivos', 'select', 'public.es_gestion()');
select public._politica('crear',     'preventivos', 'insert', null, 'public.tiene_rol(''gm'')');
select public._politica('modificar', 'preventivos', 'update', 'public.tiene_rol(''gm'')', 'public.tiene_rol(''gm'')');
select public._politica('quitar',    'preventivos', 'delete', 'public.tiene_rol(''gm'')');
select public._politica('ver',       'preventivo_ejecuciones', 'select', 'public.es_gestion()');
select public._politica('registrar', 'preventivo_ejecuciones', 'insert', null, 'public.tiene_rol(''gm'',''tec'') and tecnico_id = auth.uid()');

-- Reportes: los crea el operario (a su nombre) y ve los suyos; gestión los ve; el gerente de mantenimiento los atiende.
select public._politica('ver',       'reportes', 'select', 'public.es_gestion() or operario_id = auth.uid()');
select public._politica('crear',     'reportes', 'insert', null, 'public.tiene_rol(''op'') and operario_id = auth.uid()');
select public._politica('modificar', 'reportes', 'update', 'public.tiene_rol(''gm'')', 'public.tiene_rol(''gm'')');
select public._politica('ver',   'adjuntos', 'select', 'public.es_gestion() or exists (select 1 from public.reportes r where r.id = reporte_id and r.operario_id = auth.uid())');
select public._politica('crear', 'adjuntos', 'insert', null,
  'public.tiene_rol(''op'') and exists (select 1 from public.reportes r where r.id = reporte_id and r.operario_id = auth.uid() and r.creado > now() - interval ''1 day'') and split_part(ruta, ''/'', 1) = auth.uid()::text');

-- Movimientos: los carga el operario y ve los suyos; los ven mantenimiento, producción, administración y dirección;
-- solo producción los revisa u observa.
select public._politica('ver',     'movimientos', 'select', 'public.tiene_rol(''gm'',''gp'',''adm'',''dir'') or operario_id = auth.uid()');
select public._politica('crear',   'movimientos', 'insert', null, 'public.tiene_rol(''op'') and operario_id = auth.uid()');
select public._politica('revisar', 'movimientos', 'update', 'public.tiene_rol(''gp'')', 'public.tiene_rol(''gp'')');

grant execute on function public.reubicar_equipo(text, text, text, text, text) to authenticated;
grant execute on function public.estado_equipo(text, text, text) to authenticated;
revoke execute on function public._politica(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public._con_sellos(regclass) from public, anon, authenticated;
