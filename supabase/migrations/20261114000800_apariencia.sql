-- =====================================================================
-- App de mantenimiento · 8 · Apariencia: tema de fábrica, versiones y contraste
-- Los tokens de diseño se guardan en la tabla temas (JSON). Cada guardado crea una versión
-- nueva; se puede volver a cualquiera. El tema de fábrica siempre está y no se borra.
-- Solo el jefe de mantenimiento cambia la apariencia.
-- =====================================================================

-- ---------- Contraste WCAG ----------
create or replace function public._luminancia(hex text) returns numeric
language plpgsql immutable as $$
declare r numeric; g numeric; b numeric;
  f numeric;
begin
  r := ('x' || substr(hex, 2, 2))::bit(8)::int / 255.0;
  g := ('x' || substr(hex, 4, 2))::bit(8)::int / 255.0;
  b := ('x' || substr(hex, 6, 2))::bit(8)::int / 255.0;
  r := case when r <= 0.03928 then r / 12.92 else power((r + 0.055) / 1.055, 2.4) end;
  g := case when g <= 0.03928 then g / 12.92 else power((g + 0.055) / 1.055, 2.4) end;
  b := case when b <= 0.03928 then b / 12.92 else power((b + 0.055) / 1.055, 2.4) end;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
end $$;
create or replace function public.contraste(a text, b text) returns numeric
language sql immutable as $$
  select round(((greatest(public._luminancia(a), public._luminancia(b)) + 0.05) / (least(public._luminancia(a), public._luminancia(b)) + 0.05))::numeric, 2)
$$;

-- Pares de texto/fondo que tienen que leerse (4,5:1). Devuelve los que no llegan.
-- El texto sobre los colores de área lo calcula la app (blanco o casi negro, el que más contraste dé),
-- así que acá se controlan el texto general y los colores de estado sobre las superficies.
create or replace function public.problemas_contraste(t jsonb) returns jsonb
language plpgsql immutable as $$
declare res jsonb := '[]'; modo text; c jsonb; e jsonb; par record; k text;
begin
  foreach modo in array array['claro','oscuro'] loop
    c := t->'colores'->modo; e := t->'estados'->modo;
    for par in select * from (values
      ('Texto sobre el fondo', c->>'tinta', c->>'fondo'),
      ('Texto sobre las tarjetas', c->>'tinta', c->>'superficie'),
      ('Texto secundario sobre las tarjetas', c->>'tinta_suave', c->>'superficie'),
      ('Código de equipo sobre la placa', c->>'tinta', c->>'placa')) as x(nombre, a, b) loop
      if par.a ~ '^#[0-9A-Fa-f]{6}$' and par.b ~ '^#[0-9A-Fa-f]{6}$' and public.contraste(par.a, par.b) < 4.5 then
        res := res || jsonb_build_object('modo', modo, 'par', par.nombre, 'contraste', public.contraste(par.a, par.b));
      end if;
    end loop;
    for k in select jsonb_object_keys(coalesce(e, '{}')) loop
      if e->>k ~ '^#[0-9A-Fa-f]{6}$' and c->>'superficie' ~ '^#[0-9A-Fa-f]{6}$' and public.contraste(e->>k, c->>'superficie') < 4.5 then
        res := res || jsonb_build_object('modo', modo, 'par', 'Estado «' || k || '» sobre las tarjetas', 'contraste', public.contraste(e->>k, c->>'superficie'));
      end if;
    end loop;
  end loop;
  return res;
end $$;

-- ---------- Versiones ----------
-- Las versiones no se editan: solo cambia cuál está activa. El tema de fábrica no se borra.
create or replace function public.guardia_tema() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las versiones de la apariencia no se borran (el tema de fábrica siempre está).' using errcode = '42501';
  end if;
  if (new.tokens, new.version, new.de_fabrica, new.nombre) is distinct from (old.tokens, old.version, old.de_fabrica, old.nombre) then
    raise exception 'Una versión guardada no se modifica: guardá una versión nueva.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists b_guardia on public.temas;
create trigger b_guardia before update or delete on public.temas for each row execute function public.guardia_tema();

-- Guardar una versión nueva y aplicarla a todos (llega en vivo por Realtime).
-- Si hay texto con contraste menor a 4,5:1, hay que confirmarlo.
create or replace function public.guardar_tema(p_tokens jsonb, p_nota text default null, p_confirmo_contraste boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare prob jsonb; v int;
begin
  if not public.es('jefe') then perform public._error('La apariencia la cambia el jefe de mantenimiento.'); end if;
  if jsonb_typeof(p_tokens) <> 'object' or not (p_tokens ? 'colores' and p_tokens ? 'areas') then
    perform public._error('El tema no tiene el formato esperado.');
  end if;
  prob := public.problemas_contraste(p_tokens);
  if jsonb_array_length(prob) > 0 and not coalesce(p_confirmo_contraste, false) then
    return jsonb_build_object('ok', false, 'problemas', prob);
  end if;
  perform pg_advisory_xact_lock(hashtext('temas'));
  select coalesce(max(version), 0) + 1 into v from public.temas;
  update public.temas set activo = false where activo;
  insert into public.temas (version, nombre, tokens, activo, nota)
  values (v, coalesce(p_tokens->'marca'->>'nombre', 'Tema del grupo'), p_tokens, true,
          coalesce(nullif(btrim(p_nota), ''), case when jsonb_array_length(prob) > 0 then 'Guardado con contraste bajo confirmado' end));
  return jsonb_build_object('ok', true, 'version', v, 'problemas', prob);
end $$;

-- Volver a una versión anterior (se aplica como una versión nueva, así queda todo en el historial)
create or replace function public.volver_a_tema(p_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.temas;
begin
  if not public.es('jefe') then perform public._error('La apariencia la cambia el jefe de mantenimiento.'); end if;
  select * into t from public.temas where version = p_version;
  if t.id is null then perform public._error('No existe esa versión.'); end if;
  return public.guardar_tema(t.tokens, 'Vuelta a la versión ' || p_version || case when t.de_fabrica then ' (de fábrica)' else '' end, true);
end $$;

-- ---------- Tema de fábrica ----------
insert into public.temas (version, nombre, tokens, activo, de_fabrica, nota)
select 1, 'De fábrica', $json${
  "marca": { "nombre": "Mantenimiento", "logo_url": null, "icono_192": null, "icono_512": null, "fondo_carga": "#0B2A4A" },
  "modo": "sistema",
  "colores": {
    "claro":  { "fondo": "#EEF1F4", "superficie": "#FFFFFF", "superficie_2": "#E4E9EE", "tinta": "#16202A", "tinta_suave": "#566472",
                "linea": "#D3DAE1", "placa": "#DCE2E8", "placa_borde": "#B9C3CD" },
    "oscuro": { "fondo": "#0E1318", "superficie": "#161D24", "superficie_2": "#1F2831", "tinta": "#E5EAF0", "tinta_suave": "#94A2AF",
                "linea": "#2B3640", "placa": "#222D38", "placa_borde": "#3A4856" }
  },
  "estados": {
    "claro":  { "ok": "#1D7544", "alerta": "#9A5B00", "critico": "#B93228", "sin_datos": "#566472" },
    "oscuro": { "ok": "#55C487", "alerta": "#E5A645", "critico": "#F06B5F", "sin_datos": "#94A2AF" }
  },
  "areas": {
    "mant":  { "nombre": "Mantenimiento",  "principal": "#0A5AA8", "detalle": "#3D7FC4", "barra": "#0B2A4A", "logo": "mant",  "logo_url": null, "integrar_w": true },
    "prod":  { "nombre": "Producción",     "principal": "#12784F", "detalle": "#2FA36F", "barra": "#0E3B29", "logo": "prod",  "logo_url": null, "integrar_w": true },
    "admin": { "nombre": "Administración", "principal": "#6B3FB8", "detalle": "#8D66D6", "barra": "#2E1A52", "logo": "admin", "logo_url": null, "integrar_w": true },
    "dir":   { "nombre": "Dirección",      "principal": "#2F3742", "detalle": "#D4A93A", "barra": "#1C2128", "logo": "dir",   "logo_url": null, "integrar_w": true },
    "op":    { "nombre": "Operarios",      "principal": "#C2410C", "detalle": "#1F1A17", "barra": "#1F1A17", "logo": "op",    "logo_url": null, "integrar_w": true }
  },
  "perfil_area": { "jefe": "mant", "encargado": "mant", "tecnico": "mant", "operario": "op", "direccion": "dir" },
  "fuentes": { "titulos": "Archivo", "texto": "IBM Plex Sans", "codigos": "IBM Plex Mono", "tamano": "normal" },
  "forma": { "radio": "suave", "densidad": "auto", "borde": 1, "franja": "rayada" },
  "vocabulario": {},
  "etiqueta": { "tamano": "70x40", "campos": ["codigo", "nombre", "empresa", "area", "telefono"], "logo": true, "hoja": "a4" },
  "informes": { "secciones": ["realizados", "parada", "externas", "gasto", "preventivos", "mtbf"], "destinatarios": [], "dia": "lunes", "hora": "08:00" },
  "oficina": { "tarjetas": ["parados", "ordenes", "reportes"], "empresas": [], "rotacion_seg": 20, "tamano_texto": "grande" }
}$json$::jsonb, true, true, 'Tema de fábrica: siempre disponible'
where not exists (select 1 from public.temas where de_fabrica);
