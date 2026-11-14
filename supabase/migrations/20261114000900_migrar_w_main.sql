-- =====================================================================
-- App de mantenimiento · 9 · Migración de los datos de W-Main
-- Pasa lo que estaba cargado en W-Main (tabla docs) a las tablas nuevas, una sola vez:
--   · Equipos con el código nuevo EMPRESA-TIPO-NÚMERO (IP→INY, LH→LIM, PH→PIN, AL→SAL; GR y otras→INY).
--     Los códigos viejos quedan como alias: las etiquetas impresas siguen abriendo el equipo.
--   · Manuales → documentos. Órdenes (sin las anuladas) con sus fichas.
--   · Preventivos realizados e intervenciones sueltas → órdenes cerradas con su ficha (historial completo).
--   · Avisos de operarios → reportes de falla, con sus fotos.
--   · Cuentas: ingresan con USUARIO y la misma contraseña (el resultado dice cuál le tocó a cada uno).
--       admin → jefe · tecnico → técnico · lectura → dirección · pendiente → técnico desactivado.
--   · El plan de preventivos de W-Main se pasa en la etapa 2 (queda guardado en docs).
-- La tabla docs de W-Main NO se borra: queda como respaldo. En un proyecto sin W-Main no hace nada.
-- =====================================================================
create or replace function public.migrar_w_main() returns text
language plpgsql security definer set search_path = public, extensions, auth as $mig$
declare
  d record; x jsonb; s text; k int; nro int; viejo text; partes text[];
  emp uuid; sig text; ti text; ar uuid; eqid uuid; oid uuid; rid uuid; usu text; base text; perfil text; est text; uid uuid;
  c_eq int := 0; c_doc int := 0; c_ot int := 0; c_fi int := 0; c_hist int := 0; c_rep int := 0; c_adj int := 0; c_us int := 0;
  cuentas text := '';
  cfg jsonb;
  areas_wm jsonb := '{"INY":"Inyección","SOP":"Soplado","MOL":"Molienda / recuperado","ELA":"Elaboración / mezcla","ENV":"Envasado / llenado","EMP":"Etiquetado y empaque","DEP":"Depósito / logística","SER":"Servicios","LAB":"Calidad / laboratorio","EFL":"Efluentes","EDI":"Edilicio","TAL":"Taller / pañol de mantenimiento"}';
  tipos_wm jsonb := '{"INY":"Inyectora","SOP":"Sopladora","MOL":"Molino","MDE":"Molde / matriz","CHI":"Chiller","COM":"Compresor","SEC":"Secador","MEZ":"Mezclador","DIS":"Dispersor","MAR":"Marmita / reactor","BOM":"Bomba","LLE":"Llenadora","TAP":"Tapadora","ETQ":"Etiquetadora","CIN":"Cinta transportadora","TAN":"Tanque","CAL":"Caldera","INT":"Intercambiador","TAB":"Tablero eléctrico","MOT":"Motor","API":"Apilador","AUT":"Autoelevador","HER":"Herramienta","SOL":"Soldadora","GEN":"Grupo electrógeno","BAL":"Balanza","EXT":"Extracción / ventilación","ROB":"Robot","OTR":"Otro"}';
begin
  if to_regclass('public.docs') is null then return 'No hay datos de W-Main en este proyecto: no hay nada para migrar.'; end if;
  if exists (select 1 from public.config where clave = 'migracion_w_main') then
    return 'Los datos de W-Main ya se migraron el ' || (select valor->>'fecha' from public.config where clave = 'migracion_w_main') || '. No se hizo nada.';
  end if;
  perform set_config('planta.carga_masiva', '1', true);

  create temp table _emp (vieja text primary key, nueva text) on commit drop;
  insert into _emp values ('IP','INY'), ('LH','LIM'), ('PH','PIN'), ('AL','SAL'), ('INY','INY'), ('LIM','LIM'), ('PIN','PIN'), ('SAL','SAL');
  create temp table _eq (doc text primary key, id uuid) on commit drop;
  create temp table _ot (doc text primary key, id uuid, registro text) on commit drop;

  select data into cfg from public.docs where col = 'config' and id = 'codigos';
  if cfg ? 'areasLista' then select areas_wm || coalesce(jsonb_object_agg(e->>'c', e->>'d'), '{}') into areas_wm from jsonb_array_elements(cfg->'areasLista') e where e->>'c' is not null; end if;
  if cfg ? 'tiposLista' then select tipos_wm || coalesce(jsonb_object_agg(e->>'c', e->>'d'), '{}') into tipos_wm from jsonb_array_elements(cfg->'tiposLista') e where e->>'c' is not null; end if;

  -- ---------- Cuentas ----------
  if to_regclass('public.perfiles') is not null then
    for d in select p.id, p.nombre, p.rol, u.email from public.perfiles p join auth.users u on u.id = p.id
             where not exists (select 1 from public.usuarios x where x.id = p.id) order by p.creado loop
      base := left(lower(regexp_replace(split_part(coalesce(d.email, 'usuario'), '@', 1), '[^A-Za-z0-9._-]', '', 'g')), 26);
      if length(base) < 3 then base := rpad(base, 3, '0'); end if;
      usu := base; k := 1;
      while exists (select 1 from public.usuarios where usuario = usu) or exists (select 1 from auth.users where email = public._email_de(usu) and id <> d.id) loop
        k := k + 1; usu := base || k;
      end loop;
      perfil := case d.rol when 'admin' then 'jefe' when 'lectura' then 'direccion' else 'tecnico' end;
      insert into public.usuarios (id, usuario, nombre, perfil, activo, email_anterior)
      values (d.id, usu, coalesce(nullif(btrim(d.nombre), ''), usu), perfil, d.rol <> 'pendiente', d.email);
      insert into public.usuario_empresas (usuario_id, empresa_id) select d.id, id from public.empresas on conflict do nothing;
      update auth.users set email = public._email_de(usu), updated_at = now() where id = d.id;
      update auth.identities set identity_data = identity_data || jsonb_build_object('email', public._email_de(usu)) where user_id = d.id and provider = 'email';
      if d.rol = 'pendiente' then update auth.users set banned_until = '2999-12-31'::timestamptz where id = d.id; end if;
      c_us := c_us + 1;
      cuentas := cuentas || E'\n   · ' || coalesce(d.email, '?') || ' → usuario «' || usu || '» (' ||
        case perfil when 'jefe' then 'jefe de mantenimiento' when 'direccion' then 'dirección' else 'técnico' end ||
        case when d.rol = 'pendiente' then ', desactivado' else '' end || ')';
    end loop;
  end if;
  drop trigger if exists al_crear_usuario on auth.users;  -- las cuentas nuevas ya no crean perfiles de W-Main

  -- ---------- Equipos ----------
  for d in select id, data from public.docs where col = 'equipos' order by coalesce(data->>'creado', ''), id loop
    viejo := upper(coalesce(d.data->>'codigo', ''));
    partes := regexp_match(viejo, '^([A-Z]{2,3})-([A-Z]{3})-([A-Z]{3})-([0-9]+)$');
    sig := coalesce((select nueva from _emp where vieja = upper(coalesce(d.data->>'empresa', ''))), (select nueva from _emp where vieja = partes[1]), 'INY');
    select id into emp from public.empresas where sigla = sig;
    ti := upper(coalesce(partes[3], d.data->>'tipo', ''));
    if ti !~ '^[A-Z]{3}$' then ti := 'OTR'; end if;
    if ti = 'API' then ti := 'APL'; end if;  -- apiladora → apilador
    insert into public.tipos_equipo (sigla, nombre, orden) values (ti, coalesce(tipos_wm->>ti, ti), 50) on conflict do nothing;
    s := coalesce(areas_wm->>upper(coalesce(partes[2], d.data->>'area', '')), nullif(d.data->>'sector', ''));
    ar := null;
    if s is not null then
      insert into public.areas (nombre, orden) values (left(s, 60), 50) on conflict (nombre) do nothing;
      select id into ar from public.areas where nombre = left(s, 60);
    end if;
    nro := coalesce(nullif(partes[4], '')::int, case when d.data->>'numero' ~ '^[0-9]+$' then (d.data->>'numero')::int end, 1);
    while exists (select 1 from public.equipos where empresa_duena_id = emp and tipo = ti and numero = nro) loop nro := nro + 1; end loop;
    est := case when d.data->>'estado' = 'Baja' then 'baja'
                when coalesce(d.data->>'estadoOp', '') ~* 'repara' then 'en_reparacion'
                when coalesce(d.data->>'estadoOp', '') ~* 'detenid|fuera' then 'detenido' else 'operativo' end;
    insert into public.equipos (empresa_duena_id, tipo, numero, codigo, nombre, marca, modelo, serie, criticidad, empresa_ubicacion_id, area_id,
                                ubicacion, estado, horometro, horometro_fecha, notas, ejemplo, creado_en, modificado_en)
    values (emp, ti, nro, 'x', left(coalesce(nullif(btrim(d.data->>'nombre'), ''), viejo, 'Equipo'), 120),
            nullif(d.data->>'marca', ''), nullif(d.data->>'modelo', ''), nullif(d.data->>'serie', ''),
            case upper(coalesce(d.data->>'criticidad', '')) when 'A' then 'alta' when 'C' then 'baja' else 'media' end,
            emp, ar, nullif(d.data->>'ubicacion', ''), est,
            case when d.data->>'horometro' ~ '^[0-9.]+$' then (d.data->>'horometro')::numeric end,
            case when d.data->>'horometroFecha' ~ '^\d{4}-\d{2}-\d{2}' then left(d.data->>'horometroFecha', 10)::date end,
            nullif(d.data->>'notas', ''), coalesce(d.data->>'nombre', '') ~* '^ejemplo',
            coalesce((d.data->>'creado')::timestamptz, now()), now())
    returning id into eqid;
    insert into _eq values (d.id, eqid);
    for s in select distinct v from (select d.id as v union all select viejo union all select upper(d.id) union all select upper(d.data->>'idActivo')
                                     union all select upper(jsonb_array_elements_text(coalesce(d.data->'codigosAnteriores', '[]')))) a
             where coalesce(v, '') <> '' loop
      insert into public.equipo_alias values (s, eqid) on conflict do nothing;
    end loop;
    c_eq := c_eq + 1;
  end loop;

  -- ---------- Manuales → documentos (los PDF siguen en el bucket «manuales») ----------
  for d in select id, data from public.docs where col = 'manuales' loop
    for s in select jsonb_array_elements_text(coalesce(d.data->'equipoIds', jsonb_build_array(d.data->>'equipoId'))) loop
      eqid := (select id from _eq where doc = s);
      if eqid is not null and (d.data->>'assetId' is not null or nullif(d.data->>'url', '') is not null) then
        insert into public.documentos (equipo_id, categoria, nombre, bucket, ruta, url, creado_en)
        values (eqid, 'manual', coalesce(nullif(d.data->>'titulo', ''), d.data->>'nombreArchivo', 'Manual'),
                case when d.data->>'assetId' is not null then 'manuales' end, d.data->>'assetId', nullif(d.data->>'url', ''),
                coalesce((d.data->>'creado')::timestamptz, now()));
        c_doc := c_doc + 1;
      end if;
    end loop;
  end loop;

  -- ---------- Órdenes ----------
  for d in select id, data from public.docs where col = 'ots' and coalesce(data->>'estado', '') <> 'Anulada'
           order by case when data->>'numero' ~ '^[0-9]+$' then (data->>'numero')::int end nulls last, data->>'reportado' loop
    eqid := (select id from _eq where doc = d.data->>'equipoId');
    continue when eqid is null;
    nro := case when d.data->>'numero' ~ '^[0-9]+$' then (d.data->>'numero')::int end;
    if nro is not null and exists (select 1 from public.ordenes where numero = nro) then nro := null; end if;
    uid := (select id from public.usuarios where id::text = d.data->>'tecnicoId');
    est := case d.data->>'estado' when 'Cerrada' then 'cerrada' when 'Abierta' then case when uid is not null then 'asignada' else 'abierta' end
                when 'Esperando repuesto' then 'esperando_repuesto' else 'en_curso' end;
    insert into public.ordenes (numero, equipo_id, titulo, descripcion, tipo, estado, parada, prioridad, asignado_a, vence, empresa_cargo_id,
                                cerrada_en, terminada_en, ejemplo, creado_en, modificado_en)
    values (nro, eqid, left(coalesce(nullif(btrim(d.data->>'desc'), ''), d.data->>'tareaNombre', 'Orden de W-Main'), 200),
            nullif(concat_ws(E'\n', d.data->>'desc', 'Motivo de la urgencia: ' || nullif(d.data->>'porQue', ''), 'Notas: ' || nullif(d.data->>'notas', '')), ''),
            case when d.data->>'tipo' = 'preventivo' then 'preventiva' else 'correctiva' end, est,
            coalesce(d.data->>'tipoFalla', '') = 'total',
            case coalesce(d.data->>'urgManual', d.data->>'urg') when 'U1' then 'urgente' when 'U2' then 'alta' when 'U4' then 'baja' else 'media' end,
            uid, case when d.data->>'vence' ~ '^\d{4}-\d{2}-\d{2}' then left(d.data->>'vence', 10)::date end,
            (select empresa_duena_id from public.equipos where id = eqid),
            case when est = 'cerrada' then coalesce((d.data->>'cierre')::timestamptz, now()) end,
            case when est = 'cerrada' then coalesce((d.data->>'cierre')::timestamptz, now()) end,
            coalesce(d.data->>'desc', '') ~* '^ejemplo', coalesce((d.data->>'reportado')::timestamptz, now()), now())
    returning id into oid;
    insert into _ot values (d.id, oid, d.data->>'registroId');
    c_ot := c_ot + 1;
  end loop;

  -- ---------- Registros: fichas de órdenes; preventivos realizados e intervenciones → órdenes cerradas ----------
  for d in select id, data from public.docs where col = 'registros' and coalesce(data->>'tipo', '') not in ('Alta','Baja','Reactivación','Traslado')
           order by data->>'fecha', id loop
    eqid := (select id from _eq where doc = d.data->>'equipoId');
    continue when eqid is null;
    oid := coalesce((select id from _ot where doc = d.data->>'otId'), (select id from _ot where registro = d.id));
    if oid is null then
      insert into public.ordenes (equipo_id, titulo, descripcion, tipo, estado, empresa_cargo_id, terminada_en, cerrada_en, creado_en, modificado_en)
      values (eqid, left(coalesce(nullif(d.data->>'tareaNombre', ''), 'Intervención registrada en W-Main'), 200), 'Migrado de W-Main',
              case when d.data->>'tareaId' is not null or d.data->>'tipo' = 'Preventivo' then 'preventiva' else 'correctiva' end, 'cerrada',
              (select empresa_duena_id from public.equipos where id = eqid),
              coalesce((d.data->>'fecha')::date + time '12:00', now()), coalesce((d.data->>'fecha')::date + time '12:00', now()),
              coalesce((d.data->>'fecha')::date + time '12:00', now()), now())
      returning id into oid;
      c_hist := c_hist + 1;
    end if;
    insert into public.fichas (orden_id, tecnico_id, trabajo, horas, horas_parada, causa, supervisor_nombre, hecho_en, creado_en, modificado_en)
    values (oid, (select id from public.usuarios where id::text = d.data->>'porId'),
            coalesce(nullif(concat_ws(' · ', 'Causa: ' || nullif(d.data->>'causa', ''), nullif(d.data->>'solucion', ''), nullif(d.data->>'obs', ''),
                                      'Técnico: ' || nullif(coalesce(nullif(d.data->>'firmaNombre', ''), d.data->>'tecnico'), '')), ''), 'Trabajo registrado en W-Main'),
            least(coalesce(case when d.data->>'duracion' ~ '^[0-9.]+$' then (d.data->>'duracion')::numeric end, 0), 1000),
            least(coalesce(case when d.data->>'parada' ~ '^[0-9.]+$' then (d.data->>'parada')::numeric end, 0), 1000),
            null, null, coalesce((d.data->>'fecha')::date + time '12:00', now()), coalesce((d.data->>'creado')::timestamptz, now()), now());
    c_fi := c_fi + 1;
  end loop;

  -- ---------- Avisos de operarios → reportes de falla ----------
  for d in select id, data from public.docs where col = 'avisos' order by data->>'fecha' loop
    eqid := (select id from _eq where doc = d.data->>'equipoId');
    continue when eqid is null;
    s := coalesce(d.data->'sintomas'->>0, '');
    insert into public.reportes_falla (equipo_id, tipo_falla, parada, texto, operario_id, estado, orden_id, motivo_descarte, hecho_en, creado_en, modificado_en)
    values (eqid,
            case when s ~* 'ruido|vibra' then 'ruido' when s ~* 'aceite' then 'perdida_aceite' when s ~* 'agua|aire' then 'perdida_aire'
                 when s ~* 'recalent' then 'temperatura' when s ~* 'arranca' then 'no_arranca' when s ~* 'chispa|olor|humo' then 'electrica' else 'otra' end,
            d.data->>'funcionamiento' = 'parado',
            nullif(concat_ws('. ', 'Operario: ' || nullif(d.data->>'operario', ''),
                             'Notó: ' || nullif((select string_agg(v, ', ') from jsonb_array_elements_text(coalesce(d.data->'sintomas', '[]')) v), ''),
                             nullif(d.data->>'descripcion', '')), ''),
            null,
            case d.data->>'estado' when 'Nuevo' then 'nuevo' when 'Descartado' then 'descartado'
                 else case when (select id from _ot where doc = d.data->>'otId') is not null then 'en_orden' else 'descartado' end end,
            (select id from _ot where doc = d.data->>'otId'), nullif(d.data->>'motivo', ''),
            coalesce((d.data->>'fecha')::timestamptz, now()), coalesce((d.data->>'fecha')::timestamptz, now()), now())
    returning id into rid;
    if to_regclass('public.avisos_fotos') is not null then
      for x in execute 'select jsonb_build_object(''data'', data) from public.avisos_fotos where aviso_id = $1 and tipo = ''foto'' order by id' using d.id loop
        insert into public.adjuntos (tabla, registro_id, bucket, ruta, tipo, mime) values ('reportes_falla', rid, 'w-main', x->>'data', 'foto', 'image/jpeg');
        c_adj := c_adj + 1;
      end loop;
    end if;
    c_rep := c_rep + 1;
  end loop;

  insert into public.config (clave, valor) values ('migracion_w_main', jsonb_build_object('fecha', to_char(now(), 'DD/MM/YYYY HH24:MI'),
    'equipos', c_eq, 'ordenes', c_ot, 'historial', c_hist, 'reportes', c_rep, 'usuarios', c_us));
  insert into public.registro_cambios (operacion, tabla, resumen, cambios)
  values ('alta', 'w-main', 'Migró los datos de W-Main: ' || c_eq || ' equipos, ' || c_ot + c_hist || ' órdenes, ' || c_rep || ' reportes, ' || c_us || ' usuarios',
          jsonb_build_object('equipos', c_eq, 'documentos', c_doc, 'ordenes', c_ot, 'historial', c_hist, 'fichas', c_fi, 'reportes', c_rep, 'fotos', c_adj, 'usuarios', c_us));
  return 'Migración de W-Main terminada:' ||
    E'\n · Equipos: ' || c_eq || ' (con código nuevo; los códigos y etiquetas viejos siguen funcionando)' ||
    E'\n · Documentos (manuales): ' || c_doc ||
    E'\n · Órdenes de trabajo: ' || c_ot || ' + ' || c_hist || ' trabajos anteriores pasados como órdenes cerradas (' || c_fi || ' fichas)' ||
    E'\n · Reportes de falla: ' || c_rep || ' (con ' || c_adj || ' fotos)' ||
    E'\n · El plan de preventivos se pasa en la etapa 2.' ||
    E'\n · Usuarios: ' || c_us || case when c_us > 0 then ' — desde ahora ingresan con USUARIO (no con el email) y la misma contraseña:' || cuentas
      || E'\n   Revisá en «Usuarios» a qué empresas tiene acceso cada uno (por ahora, a todas).' else '' end;
end $mig$;

-- Los PDF de W-Main quedan en su bucket: mantenimiento los puede ver
drop policy if exists mant_manuales_viejos on storage.objects;
create policy mant_manuales_viejos on storage.objects for select to authenticated
  using (bucket_id = 'manuales' and public.es_mantenimiento());

select public.migrar_w_main() as resultado;
