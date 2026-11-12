-- =====================================================================
-- Gestión de Planta · Migración de los datos de W-Main
-- Pasa a las tablas nuevas lo que ya estaba cargado en W-Main (tabla docs):
-- equipos, manuales, órdenes, preventivos e historial, avisos de operarios y cuentas.
--   · Siglas: IP → INY, LH → LIM, PH → PIN, AL → SAL (GR y cualquier otra → INY).
--   · Los códigos y etiquetas QR viejos siguen funcionando (tabla equipo_alias).
--   · Las cuentas de W-Main pasan a ingresar con USUARIO (el resumen muestra cuál le tocó a cada uno):
--       admin → gerente de mantenimiento · tecnico → técnico · lectura → dirección · pendiente → técnico desactivado.
--   · La tabla docs de W-Main NO se borra: queda como respaldo.
-- Se ejecuta una sola vez (si ya se migró, no hace nada). En un proyecto nuevo, sin W-Main, no hace nada.
-- =====================================================================

create or replace function public.migrar_w_main() returns text
language plpgsql security definer set search_path = public, extensions, auth as $mig$
declare
  d record; x jsonb; s text; n int;
  emp text; ar text; ti text; nro int; cod text; viejo text; partes text[];
  est text; uid uuid; usu text; base text; k int; rol text;
  eq_cod text; ot_id uuid; pv_id uuid;
  c_eq int := 0; c_man int := 0; c_ot int := 0; c_fi int := 0; c_pv int := 0; c_ej int := 0; c_ev int := 0; c_rep int := 0; c_adj int := 0; c_cu int := 0;
  cuentas_txt text := '';
  areas_wm jsonb := '{"INY":"Inyección","SOP":"Soplado","MOL":"Molienda / recuperado","ELA":"Elaboración / mezcla","ENV":"Envasado / llenado","EMP":"Etiquetado y empaque","DEP":"Depósito / logística","SER":"Servicios generales (aire, agua, vapor, energía)","LAB":"Calidad / laboratorio","EFL":"Efluentes","EDI":"Edilicio","TAL":"Taller / pañol de mantenimiento"}';
  tipos_wm jsonb := '{"INY":"Inyectora","SOP":"Sopladora","MOL":"Molino","MDE":"Molde / matriz","CHI":"Chiller / enfriador","COM":"Compresor","SEC":"Secador / deshumidificador","MEZ":"Mezclador / agitador","DIS":"Dispersor","MAR":"Marmita / reactor","BOM":"Bomba","LLE":"Llenadora / envasadora","TAP":"Tapadora","ETQ":"Etiquetadora","CIN":"Cinta transportadora","TAN":"Tanque / recipiente","CAL":"Caldera","INT":"Intercambiador / pasteurizador","TAB":"Tablero eléctrico","MOT":"Motor eléctrico / motorreductor","API":"Apiladora","AUT":"Autoelevador / zorra","HER":"Herramienta eléctrica","SOL":"Soldadora","GEN":"Grupo electrógeno","BAL":"Balanza","EXT":"Extracción / ventilación","ROB":"Robot / manipulador","OTR":"Otro"}';
  cfg jsonb;
begin
  if to_regclass('public.docs') is null then
    return 'No hay datos de W-Main en este proyecto: no hay nada para migrar.';
  end if;
  if exists (select 1 from public.config where clave = 'migracion_w_main') then
    return 'Los datos de W-Main ya se migraron el ' || (select valor->>'fecha' from public.config where clave = 'migracion_w_main') || '. No se hizo nada.';
  end if;
  perform set_config('planta.carga_masiva', '1', true);

  create temp table _emp (sigla_vieja text primary key, nuevo text) on commit drop;
  insert into _emp values ('IP','INY'), ('LH','LIM'), ('PH','PIN'), ('AL','SAL'), ('INY','INY'), ('LIM','LIM'), ('PIN','PIN'), ('SAL','SAL');
  create temp table _eq (doc text primary key, codigo text) on commit drop;
  create temp table _ot (doc text primary key, id uuid, registro text) on commit drop;
  create temp table _pv (doc text primary key, id uuid) on commit drop;

  -- Nombres de áreas y tipos que se usaban en W-Main (incluye los configurados)
  select data into cfg from public.docs where col = 'config' and id = 'codigos';
  if cfg ? 'areasLista' then select areas_wm || coalesce(jsonb_object_agg(e->>'c', e->>'d'), '{}') into areas_wm from jsonb_array_elements(cfg->'areasLista') e where e->>'c' is not null; end if;
  if cfg ? 'tiposLista' then select tipos_wm || coalesce(jsonb_object_agg(e->>'c', e->>'d'), '{}') into tipos_wm from jsonb_array_elements(cfg->'tiposLista') e where e->>'c' is not null; end if;

  -- ---------- Cuentas (primero, para poder relacionar autores) ----------
  if to_regclass('public.perfiles') is not null then
    for d in select p.id, p.nombre, p.rol, u.email from public.perfiles p join auth.users u on u.id = p.id
             where not exists (select 1 from public.cuentas c where c.id = p.id) order by p.creado loop
      base := lower(regexp_replace(split_part(coalesce(d.email, 'usuario'), '@', 1), '[^A-Za-z0-9._-]', '', 'g'));
      if length(base) < 3 then base := rpad(base, 3, '0'); end if;
      base := left(base, 26); usu := base; k := 1;
      while exists (select 1 from public.cuentas where usuario = usu) or exists (select 1 from auth.users where email = public._email_de(usu) and id <> d.id) loop
        k := k + 1; usu := base || k;
      end loop;
      rol := case d.rol when 'admin' then 'gm' when 'lectura' then 'dir' else 'tec' end;
      insert into public.cuentas (id, usuario, nombre, rol, activo, email_anterior)
      values (d.id, usu, coalesce(nullif(btrim(d.nombre), ''), usu), rol, d.rol <> 'pendiente', d.email);
      update auth.users set email = public._email_de(usu), updated_at = now() where id = d.id;
      update auth.identities set identity_data = identity_data || jsonb_build_object('email', public._email_de(usu))
        where user_id = d.id and provider = 'email';
      if d.rol = 'pendiente' then update auth.users set banned_until = '2999-12-31'::timestamptz where id = d.id; end if;
      c_cu := c_cu + 1;
      cuentas_txt := cuentas_txt || E'\n   · ' || coalesce(d.email, '?') || ' → usuario «' || usu || '» (' ||
        case rol when 'gm' then 'Gerente de mantenimiento' when 'dir' then 'Dirección' else 'Técnico' end ||
        case when d.rol = 'pendiente' then ', desactivada' else '' end || ')';
    end loop;
  end if;
  -- Las cuentas nuevas ya no crean perfiles de W-Main
  drop trigger if exists al_crear_usuario on auth.users;

  -- ---------- Equipos ----------
  for d in select id, data from public.docs where col = 'equipos' order by coalesce(data->>'creado', ''), id loop
    viejo := upper(coalesce(d.data->>'codigo', ''));
    partes := regexp_match(viejo, '^([A-Z]{2,3})-([A-Z]{3})-([A-Z]{3})-([0-9]+)$');
    emp := coalesce((select nuevo from _emp where sigla_vieja = upper(coalesce(d.data->>'empresa', ''))),
                    (select nuevo from _emp where sigla_vieja = partes[1]), 'INY');
    ar := upper(coalesce(partes[2], d.data->>'area', ''));
    ti := upper(coalesce(partes[3], d.data->>'tipo', ''));
    if ar !~ '^[A-Z]{3}$' then ar := 'SER'; end if;
    if ti !~ '^[A-Z]{3}$' then ti := 'OTR'; end if;
    insert into public.areas (codigo, nombre, orden) values (ar, coalesce(areas_wm->>ar, ar), 50) on conflict do nothing;
    insert into public.tipos_equipo (codigo, nombre, orden) values (ti, coalesce(tipos_wm->>ti, ti), 50) on conflict do nothing;
    nro := coalesce(nullif(partes[4], '')::int, case when d.data->>'numero' ~ '^[0-9]+$' then (d.data->>'numero')::int end, 1);
    cod := emp || '-' || ar || '-' || ti || '-' || lpad(nro::text, 3, '0');
    while exists (select 1 from public.equipos where codigo = cod) loop
      nro := nro + 1; cod := emp || '-' || ar || '-' || ti || '-' || lpad(nro::text, 3, '0');
    end loop;
    est := case
      when d.data->>'estado' = 'Baja' then 'baja'
      when coalesce(d.data->>'estadoOp', '') ~* 'repara' then 'reparacion'
      when coalesce(d.data->>'estadoOp', '') ~* 'detenid|fuera' then 'detenido'
      else 'operativo' end;
    insert into public.equipos (codigo, empresa, area, tipo, nombre, marca, modelo, ubicacion, notas, estado, alta, ejemplo, creado, modificado)
    values (cod, emp, ar, ti, left(coalesce(nullif(btrim(d.data->>'nombre'), ''), cod), 120),
            nullif(d.data->>'marca', ''), nullif(d.data->>'modelo', ''), nullif(d.data->>'ubicacion', ''),
            nullif(concat_ws(E'\n', nullif(d.data->>'notas', ''), 'Serie: ' || nullif(d.data->>'serie', ''), 'Criticidad: ' || nullif(d.data->>'criticidad', '')), ''),
            est, coalesce((left(d.data->>'creado', 10))::date, current_date), coalesce(d.data->>'nombre', '') ~* '^ejemplo',
            coalesce((d.data->>'creado')::timestamptz, now()), now());
    insert into _eq values (d.id, cod);
    for s in select distinct upper(v) from (select d.id as v union all select viejo union all select d.data->>'idActivo'
                                            union all select jsonb_array_elements_text(coalesce(d.data->'codigosAnteriores', '[]'))) a
             where coalesce(v, '') <> '' loop
      if s <> cod then insert into public.equipo_alias values (s, cod) on conflict do nothing; end if;
    end loop;
    insert into public.equipo_alias values (d.id, cod) on conflict do nothing;  -- id interno, tal cual
    insert into public.equipo_eventos (equipo, fecha, texto) values (cod, now(), 'Migrado desde W-Main' || coalesce(' (código anterior ' || nullif(viejo, '') || ')', ''));
    c_eq := c_eq + 1;
  end loop;

  -- ---------- Manuales (los PDF ya están en el bucket "manuales") ----------
  for d in select id, data from public.docs where col = 'manuales' loop
    for s in select jsonb_array_elements_text(coalesce(d.data->'equipoIds', jsonb_build_array(d.data->>'equipoId'))) loop
      eq_cod := (select codigo from _eq where doc = s);
      if eq_cod is not null and (d.data->>'assetId' is not null or nullif(d.data->>'url', '') is not null) then
        insert into public.manuales (equipo, nombre, bucket, ruta, url, fecha, creado)
        values (eq_cod, coalesce(nullif(d.data->>'titulo', ''), d.data->>'nombreArchivo', 'Manual'),
                case when d.data->>'assetId' is not null then 'manuales' end, d.data->>'assetId', nullif(d.data->>'url', ''),
                coalesce(left(d.data->>'creado', 10)::date, current_date), coalesce((d.data->>'creado')::timestamptz, now()));
        c_man := c_man + 1;
      end if;
    end loop;
  end loop;

  -- ---------- Órdenes (las anuladas no se pasan) ----------
  for d in select id, data from public.docs where col = 'ots' and coalesce(data->>'estado', '') <> 'Anulada'
           order by case when data->>'numero' ~ '^[0-9]+$' then (data->>'numero')::int end nulls last, data->>'reportado' loop
    eq_cod := (select codigo from _eq where doc = d.data->>'equipoId');
    continue when eq_cod is null;
    nro := case when d.data->>'numero' ~ '^[0-9]+$' then (d.data->>'numero')::int end;
    if nro is not null and exists (select 1 from public.ordenes where numero = nro) then nro := null; end if;
    insert into public.ordenes (numero, equipo, titulo, descripcion, tipo, prioridad, vence, asignado, estado, cerrada, cerrada_por_nombre, ejemplo, creado, modificado)
    values (nro, eq_cod,
            left(coalesce(nullif(btrim(d.data->>'desc'), ''), d.data->>'tareaNombre', 'Orden de W-Main'), 200),
            nullif(concat_ws(E'\n', d.data->>'desc', 'Motivo de la urgencia: ' || nullif(d.data->>'porQue', ''), 'Notas: ' || nullif(d.data->>'notas', '')), ''),
            case when d.data->>'tipo' = 'preventivo' then 'preventiva' else 'correctiva' end,
            case coalesce(d.data->>'urgManual', d.data->>'urg') when 'U1' then 'alta' when 'U2' then 'alta' when 'U4' then 'baja' else 'media' end,
            case when d.data->>'vence' ~ '^\d{4}-\d{2}-\d{2}' then left(d.data->>'vence', 10)::date end,
            nullif(coalesce(nullif(d.data->>'tecnicoNombre', ''), d.data->>'asignado'), ''),
            case d.data->>'estado' when 'Cerrada' then 'cerrada' when 'Abierta' then 'abierta' else 'curso' end,
            case when d.data->>'estado' = 'Cerrada' then coalesce((d.data->>'cierre')::timestamptz, now()) end,
            case when d.data->>'estado' = 'Cerrada' then nullif(d.data->>'tecnicoNombre', '') end,
            coalesce(d.data->>'desc', '') ~* '^ejemplo',
            coalesce((d.data->>'reportado')::timestamptz, (d.data->>'creado')::timestamptz, now()), now())
    returning id into ot_id;
    insert into _ot values (d.id, ot_id, d.data->>'registroId');
    c_ot := c_ot + 1;
  end loop;

  -- ---------- Preventivos (tareas del plan) ----------
  for d in select id, data from public.docs where col = 'tareas' loop
    eq_cod := (select codigo from _eq where doc = d.data->>'equipoId');
    continue when eq_cod is null;
    nro := case
      when coalesce(d.data->>'modo', 'tiempo') = 'horas' and d.data->>'cadaHoras' ~ '^[0-9.]+$' then
        greatest(1, ceil((d.data->>'cadaHoras')::numeric / greatest(coalesce((select (x2.data->>'horasDia')::numeric from public.docs x2 where x2.col = 'equipos' and x2.id = d.data->>'equipoId' and x2.data->>'horasDia' ~ '^[0-9.]+$'), 8), 1)))::int
      when d.data->>'cadaValor' ~ '^[0-9.]+$' then
        greatest(1, round((d.data->>'cadaValor')::numeric * case d.data->>'cadaUnidad' when 'semanas' then 7 when 'meses' then 30 when 'anios' then 365 else 1 end))::int
      else 30 end;
    insert into public.preventivos (equipo, tarea, frecuencia, ultima, responsable, ejemplo, creado, modificado)
    values (eq_cod, left(coalesce(nullif(d.data->>'nombre', ''), 'Tarea de W-Main'), 300)
                    || case when coalesce(d.data->>'modo', 'tiempo') = 'horas' then ' (cada ' || (d.data->>'cadaHoras') || ' h de uso)' else '' end,
            least(nro, 3650), case when d.data->>'ultimaFecha' ~ '^\d{4}-\d{2}-\d{2}' then left(d.data->>'ultimaFecha', 10)::date end,
            nullif(d.data->>'responsable', ''), (select ejemplo from public.equipos where codigo = eq_cod),
            coalesce((d.data->>'creado')::timestamptz, now()), now())
    returning id into pv_id;
    insert into _pv values (d.id, pv_id);
    c_pv := c_pv + 1;
  end loop;

  -- ---------- Registros: realizaciones de preventivos, fichas de órdenes o historial del equipo ----------
  for d in select id, data from public.docs where col = 'registros' order by data->>'fecha', id loop
    eq_cod := (select codigo from _eq where doc = d.data->>'equipoId');
    continue when eq_cod is null;
    s := nullif(coalesce(nullif(d.data->>'firmaNombre', ''), nullif(d.data->>'tecnico', ''), d.data->>'porNombre'), '');
    pv_id := (select id from _pv where doc = d.data->>'tareaId');
    ot_id := coalesce((select id from _ot where doc = d.data->>'otId'), (select id from _ot where registro = d.id));
    if ot_id is not null then
      insert into public.fichas (orden_id, tecnico_id, tecnico_nombre, fecha, trabajo, horas, parada, repuestos, resultado, creado, modificado)
      values (ot_id, null, coalesce(s, 'W-Main'),
              coalesce((d.data->>'fecha')::date + time '12:00', now()),
              coalesce(nullif(concat_ws(' · ', 'Causa: ' || nullif(d.data->>'causa', ''), nullif(d.data->>'solucion', ''), nullif(d.data->>'obs', '')), ''), d.data->>'tareaNombre', 'Trabajo registrado en W-Main'),
              least(coalesce(case when d.data->>'duracion' ~ '^[0-9.]+$' then (d.data->>'duracion')::numeric end, 0), 1000),
              least(coalesce(case when d.data->>'parada' ~ '^[0-9.]+$' then (d.data->>'parada')::numeric end, 0), 1000),
              nullif(d.data->>'repuestos', ''),
              case when coalesce(d.data->>'resultado', '') ~* 'resuelt|ok|termin' then 'terminado' else 'pendiente' end,
              coalesce((d.data->>'creado')::timestamptz, now()), now());
      c_fi := c_fi + 1;
    elsif pv_id is not null then
      insert into public.preventivo_ejecuciones (preventivo_id, tecnico_id, tecnico_nombre, fecha, horas, obs, creado, modificado)
      values (pv_id, null, coalesce(s, 'W-Main'), coalesce((d.data->>'fecha')::date + time '12:00', now()),
              least(coalesce(case when d.data->>'duracion' ~ '^[0-9.]+$' then (d.data->>'duracion')::numeric end, 0), 1000),
              nullif(concat_ws(' · ', nullif(d.data->>'obs', ''), nullif(d.data->>'resultado', '')), ''),
              coalesce((d.data->>'creado')::timestamptz, now()), now());
      c_ej := c_ej + 1;
    else
      insert into public.equipo_eventos (equipo, fecha, texto)
      values (eq_cod, coalesce((d.data->>'fecha')::date + time '12:00', now()),
              left(concat_ws(' · ', coalesce(nullif(d.data->>'tipo', ''), 'Registro') || ': ' || coalesce(d.data->>'tareaNombre', ''),
                             nullif(d.data->>'obs', ''), nullif(d.data->>'resultado', ''), s), 1000));
      c_ev := c_ev + 1;
    end if;
  end loop;

  -- ---------- Avisos de operarios → reportes ----------
  for d in select id, data from public.docs where col = 'avisos' order by data->>'fecha' loop
    eq_cod := (select codigo from _eq where doc = d.data->>'equipoId');
    continue when eq_cod is null;
    s := coalesce(d.data->'sintomas'->>0, '');
    insert into public.reportes (equipo, tipo, detenida, descripcion, operario_id, operario_nombre, empresa, estado, nota, orden_id, ts, creado, modificado)
    values (eq_cod,
            case when s ~* 'ruido' then 'Ruido' when s ~* 'vibra' then 'Vibración' when s ~* 'olor|humo' then 'Olor a quemado'
                 when s ~* 'pérdida|perdida' then 'Pérdida / fuga' when s ~* 'recalent' then 'Temperatura alta'
                 when s ~* 'arranca' then 'No arranca' when s ~* 'chispa' then 'Falla eléctrica' else 'Otro' end,
            d.data->>'funcionamiento' = 'parado',
            coalesce(nullif(concat_ws('. ', 'Notó: ' || nullif((select string_agg(v, ', ') from jsonb_array_elements_text(coalesce(d.data->'sintomas', '[]')) v), ''),
                                      nullif(d.data->>'descripcion', '')), ''), 'Aviso de W-Main'),
            null, coalesce(nullif(d.data->>'operario', ''), 'Operario'),
            (select empresa from public.equipos where codigo = eq_cod),
            case d.data->>'estado' when 'Nuevo' then 'nuevo' when 'Descartado' then 'descartado' else 'ot' end,
            nullif(d.data->>'motivo', ''), (select id from _ot where doc = d.data->>'otId'),
            coalesce((d.data->>'fecha')::timestamptz, now()), coalesce((d.data->>'fecha')::timestamptz, now()), now())
    returning id into ot_id;
    update public.reportes set estado = 'analisis' where id = ot_id and estado = 'ot' and orden_id is null;
    if to_regclass('public.avisos_fotos') is not null then
      for x in execute 'select jsonb_build_object(''tipo'', tipo, ''data'', data) from public.avisos_fotos where aviso_id = $1 and tipo = ''foto'' order by id' using d.id loop
        insert into public.adjuntos (reporte_id, bucket, ruta, tipo, mime) values (ot_id, 'w-main', x->>'data', 'foto', 'image/jpeg');
        c_adj := c_adj + 1;
      end loop;
    end if;
    c_rep := c_rep + 1;
  end loop;

  insert into public.config (clave, valor) values ('migracion_w_main', jsonb_build_object('fecha', to_char(now(), 'DD/MM/YYYY HH24:MI'),
    'equipos', c_eq, 'ordenes', c_ot, 'preventivos', c_pv, 'reportes', c_rep, 'cuentas', c_cu));
  insert into public.auditoria (operacion, tabla, registro, resumen, cambios)
  values ('alta', 'w-main', null, 'Migró los datos de W-Main: ' || c_eq || ' equipos, ' || c_ot || ' órdenes, ' || c_pv || ' preventivos, ' || c_rep || ' reportes, ' || c_cu || ' cuentas',
          jsonb_build_object('equipos', c_eq, 'manuales', c_man, 'ordenes', c_ot, 'fichas', c_fi, 'preventivos', c_pv, 'realizaciones', c_ej,
                             'historial', c_ev, 'reportes', c_rep, 'fotos', c_adj, 'cuentas', c_cu));
  return 'Migración de W-Main terminada:' ||
    E'\n · Equipos: ' || c_eq || ' (los códigos y QR viejos siguen funcionando)' ||
    E'\n · Manuales: ' || c_man ||
    E'\n · Órdenes de trabajo: ' || c_ot || ' (con ' || c_fi || ' fichas de trabajo)' ||
    E'\n · Preventivos: ' || c_pv || ' (con ' || c_ej || ' realizaciones)' ||
    E'\n · Otros registros pasados al historial de los equipos: ' || c_ev ||
    E'\n · Reportes de operarios: ' || c_rep || ' (con ' || c_adj || ' fotos)' ||
    E'\n · Cuentas: ' || c_cu || case when c_cu > 0 then ' — desde ahora ingresan con USUARIO (no con el email) y la misma contraseña:' || cuentas_txt
      || E'\n   Los gerentes tienen que definir su código de acceso en «Mi cuenta» al ingresar.' else '' end;
end $mig$;
revoke execute on function public.migrar_w_main() from public, anon, authenticated;

select public.migrar_w_main() as resultado;
