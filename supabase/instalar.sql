-- =====================================================================
-- App de mantenimiento · INSTALACIÓN / ACTUALIZACIÓN COMPLETA
-- Pegá todo este archivo en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin perder datos. Si el proyecto tenía W-Main, al final
-- migra sus datos (una sola vez) y muestra el resumen.
-- Generado con "npm run sql" a partir de supabase/migrations (no editar a mano).
-- =====================================================================

-- >>>>>>>>>> 20261114000100_base.sql
-- =====================================================================
-- App de mantenimiento · 1 · Base: control de cambios, empresas, usuarios, listas y apariencia
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- Campos de control: creado_por, creado_en, modificado_por, modificado_en ----------
-- Los completa la base, no la app. Si el cambio viene del sistema (migraciones, datos de ejemplo)
-- se respetan los valores recibidos.
create or replace function public.sellar() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.creado_por := auth.uid();
      new.creado_en := now();
    end if;
    new.creado_en := coalesce(new.creado_en, now());
    new.modificado_por := coalesce(auth.uid(), new.modificado_por, new.creado_por);
    new.modificado_en := case when auth.uid() is not null then now() else coalesce(new.modificado_en, new.creado_en) end;
  else
    new.creado_por := old.creado_por;
    new.creado_en := old.creado_en;
    new.modificado_por := coalesce(auth.uid(), new.modificado_por);
    new.modificado_en := case when auth.uid() is not null then now() else coalesce(new.modificado_en, now()) end;
  end if;
  return new;
end $$;

create or replace function public._control(t regclass) returns void
language plpgsql as $$
begin
  execute format('alter table %s add column if not exists creado_por uuid references auth.users(id) on delete set null,
                  add column if not exists creado_en timestamptz not null default now(),
                  add column if not exists modificado_por uuid references auth.users(id) on delete set null,
                  add column if not exists modificado_en timestamptz not null default now()', t);
  execute format('drop trigger if exists a_sellar on %s', t);
  execute format('create trigger a_sellar before insert or update on %s for each row execute function public.sellar()', t);
end $$;

-- Vuelve a crear una política (permite ejecutar los archivos más de una vez)
create or replace function public._politica(nombre text, tabla text, cmd text, usando text, chequeo text default null, rol text default 'authenticated') returns void
language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', nombre, tabla);
  execute format('create policy %I on public.%I for %s to %s %s %s', nombre, tabla, cmd, rol,
    case when usando is null then '' else 'using (' || usando || ')' end,
    case when chequeo is null then '' else 'with check (' || chequeo || ')' end);
end $$;

-- Para tablas cuyos registros nunca se borran (se dan de baja o se desactivan)
create or replace function public.no_se_borra() returns trigger
language plpgsql as $$
begin
  -- Única excepción: borrar_datos_ejemplo(), que corre desde el SQL Editor (sin usuario de la app)
  if auth.uid() is null and current_setting('planta.borrar_ejemplo', true) = '1' then return old; end if;
  raise exception 'Los registros de % no se borran: se dan de baja o se desactivan.', tg_table_name using errcode = '42501';
end $$;

-- ---------- Empresas (configurables: pueden sumarse más) ----------
create table if not exists public.empresas (
  id     uuid primary key default gen_random_uuid(),
  sigla  text not null unique check (sigla ~ '^[A-Z]{2,4}$'),
  nombre text not null check (length(btrim(nombre)) between 2 and 60),
  color  text not null default '#566472' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  activa boolean not null default true,
  orden  int not null default 0
);
select public._control('public.empresas');

-- ---------- Usuarios ----------
-- jefe · encargado · tecnico · operario · direccion. Los usuarios se desactivan, no se borran.
create table if not exists public.usuarios (
  id       uuid primary key references auth.users(id) on delete restrict,
  usuario  text not null unique check (usuario ~ '^[a-z0-9._-]{3,30}$'),
  nombre   text not null check (length(btrim(nombre)) between 2 and 80),
  perfil   text not null check (perfil in ('jefe','encargado','tecnico','operario','direccion')),
  telefono text,
  activo   boolean not null default true,
  ejemplo  boolean not null default false,
  email_anterior text
);
select public._control('public.usuarios');
drop trigger if exists no_borrar on public.usuarios;
create trigger no_borrar before delete on public.usuarios for each row execute function public.no_se_borra();

-- A qué empresas tiene acceso cada usuario (el jefe ve todas)
create table if not exists public.usuario_empresas (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  primary key (usuario_id, empresa_id)
);
create index if not exists usuario_empresas_empresa on public.usuario_empresas (empresa_id);

-- ---------- Perfil y empresas de quien está conectado ----------
create or replace function public.mi_perfil() returns text
language sql stable security definer set search_path = public as $$
  select perfil from public.usuarios where id = auth.uid() and activo
$$;
create or replace function public.es(variadic perfiles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select perfil from public.usuarios where id = auth.uid() and activo) = any(perfiles), false)
$$;
create or replace function public.es_mantenimiento() returns boolean
language sql stable security definer set search_path = public as $$
  select public.es('jefe','encargado','tecnico')
$$;
-- ¿Tengo acceso a esta empresa? (el jefe a todas)
create or replace function public.mi_empresa(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.es('jefe') or (public.mi_perfil() is not null and exists (
    select 1 from public.usuario_empresas ue where ue.usuario_id = auth.uid() and ue.empresa_id = e))
$$;

-- ---------- Listas editables ----------
create table if not exists public.areas (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null unique check (length(btrim(nombre)) between 2 and 60),
  activa boolean not null default true,
  orden  int not null default 0
);
select public._control('public.areas');

-- Tipos de equipo: sigla de 3 letras (parte del código) y campos propios de la ficha.
-- campos: [{ "clave": "capacidad", "etiqueta": "Capacidad de carga", "tipo": "numero", "unidad": "kg",
--            "opciones": [], "obligatorio": true }]   tipo: texto | numero | fecha | lista | foto
create table if not exists public.tipos_equipo (
  sigla  text primary key check (sigla ~ '^[A-Z]{3}$'),
  nombre text not null,
  icono  text not null default 'engranaje',
  campos jsonb not null default '[]' check (jsonb_typeof(campos) = 'array'),
  activo boolean not null default true,
  orden  int not null default 0
);
select public._control('public.tipos_equipo');

-- Tipos de falla, causas y estados de orden: el nombre, el color y el ícono se editan;
-- la clave interna no cambia (los estados internos los usa la base).
create table if not exists public.listas (
  lista  text not null check (lista in ('tipo_falla','causa','estado_orden','destino_baja')),
  clave  text not null check (clave ~ '^[a-z0-9_]{2,40}$'),
  nombre text not null,
  color  text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  icono  text,
  orden  int not null default 0,
  activo boolean not null default true,
  primary key (lista, clave)
);
select public._control('public.listas');

-- Parámetros generales (teléfono de mantenimiento, límites de video, tope de compras del jefe…)
create table if not exists public.config (
  clave text primary key,
  valor jsonb not null
);
select public._control('public.config');

-- ---------- Apariencia: temas versionados y preferencias de cada usuario ----------
-- Cada guardado crea una versión nueva; una sola está activa. El tema de fábrica no se borra.
create table if not exists public.temas (
  id         bigint generated always as identity primary key,
  version    int not null,
  nombre     text not null default 'Tema del grupo',
  tokens     jsonb not null check (jsonb_typeof(tokens) = 'object'),
  activo     boolean not null default false,
  de_fabrica boolean not null default false,
  nota       text
);
select public._control('public.temas');
create unique index if not exists temas_un_activo on public.temas (activo) where activo;
create unique index if not exists temas_version on public.temas (version);

create table if not exists public.preferencias_usuario (
  usuario_id uuid primary key references public.usuarios(id) on delete cascade,
  tema       text not null default 'sistema' check (tema in ('claro','oscuro','sistema')),
  tamano     text check (tamano in ('chico','normal','grande')),
  inicio     jsonb
);
select public._control('public.preferencias_usuario');

-- ---------- Datos de fábrica ----------
insert into public.empresas (sigla, nombre, color, orden) values
  ('INY','Inyectora de plásticos','#2F6FC0',1), ('LIM','Productos de limpieza','#1F8F82',2),
  ('PIN','Pinturas','#C47E1D',3), ('SAL','Salsas y aderezos','#A8466F',4)
on conflict (sigla) do nothing;

insert into public.areas (nombre, orden) values
  ('Producción',1), ('Servicios',2), ('Depósito / logística',3), ('Mantenimiento',4), ('Pañol',5), ('Edilicio',6)
on conflict (nombre) do nothing;

insert into public.tipos_equipo (sigla, nombre, icono, orden, campos) values
  ('INY','Inyectora','inyectora',1,'[{"clave":"fuerza_cierre","etiqueta":"Fuerza de cierre","tipo":"numero","unidad":"t","obligatorio":false}]'),
  ('SOP','Sopladora','sopladora',2,'[]'),
  ('COM','Compresor','compresor',3,'[{"clave":"presion","etiqueta":"Presión de trabajo","tipo":"numero","unidad":"bar","obligatorio":false}]'),
  ('APL','Apilador','apilador',4,'[{"clave":"capacidad","etiqueta":"Capacidad de carga","tipo":"numero","unidad":"kg","obligatorio":true}]'),
  ('MOT','Motor','motor',5,'[]'),
  ('TAB','Tablero eléctrico','tablero',6,'[]'),
  ('MAT','Matafuego','matafuego',7,'[{"clave":"vencimiento","etiqueta":"Vencimiento de la carga","tipo":"fecha","obligatorio":true},{"clave":"agente","etiqueta":"Agente extintor","tipo":"lista","opciones":["ABC polvo","CO2","Agua","Espuma"],"obligatorio":false}]'),
  ('HER','Herramienta','herramienta',8,'[]'),
  ('AUT','Autoelevador','autoelevador',9,'[{"clave":"capacidad","etiqueta":"Capacidad de carga","tipo":"numero","unidad":"kg","obligatorio":true}]'),
  ('MEZ','Mezclador','mezclador',10,'[]'),
  ('ENV','Envasadora','envasadora',11,'[]'),
  ('CHI','Chiller','chiller',12,'[]'),
  ('BOM','Bomba','bomba',13,'[]'),
  ('CAL','Caldera','caldera',14,'[]'),
  ('INS','Instalación eléctrica','instalacion',15,'[]'),
  ('RED','Red de aire comprimido','aire',16,'[]'),
  ('OTR','Otro','engranaje',99,'[]')
on conflict (sigla) do nothing;

insert into public.listas (lista, clave, nombre, icono, color, orden) values
  ('tipo_falla','ruido','Ruido','ruido',null,1),
  ('tipo_falla','perdida_aceite','Pérdida de aceite','gota',null,2),
  ('tipo_falla','perdida_aire','Pérdida de aire','aire',null,3),
  ('tipo_falla','perdida_agua','Pérdida de agua','agua',null,4),
  ('tipo_falla','temperatura','Temperatura alta','termometro',null,5),
  ('tipo_falla','no_arranca','No arranca','power',null,6),
  ('tipo_falla','electrica','Falla eléctrica','rayo',null,7),
  ('tipo_falla','tension','Baja o corte de tensión','enchufe',null,8),
  ('tipo_falla','calidad','Calidad del producto','producto',null,9),
  ('tipo_falla','otra','Otra','pregunta',null,99),
  ('causa','mecanica','Mecánica',null,null,1), ('causa','electrica','Eléctrica',null,null,2),
  ('causa','electronica','Electrónica',null,null,3), ('causa','automatizacion','Automatización',null,null,4),
  ('causa','mal_uso','Mal uso',null,null,5), ('causa','desgaste','Desgaste',null,null,6),
  ('causa','tension_red','Tensión de red',null,null,7), ('causa','falta_preventivo','Falta de preventivo',null,null,8),
  ('estado_orden','abierta','Abierta',null,'#0A5AA8',1),
  ('estado_orden','asignada','Asignada',null,'#3D7FC4',2),
  ('estado_orden','esperando_repuesto','Esperando repuesto',null,'#9A5B00',3),
  ('estado_orden','en_curso','En curso',null,'#9A5B00',4),
  ('estado_orden','terminada','Terminada',null,'#1D7544',5),
  ('estado_orden','verificada','Verificada por producción',null,'#1D7544',6),
  ('estado_orden','cerrada','Cerrada',null,'#566472',7),
  ('estado_orden','anulada','Anulada',null,'#566472',8),
  ('destino_baja','venta','Venta',null,null,1), ('destino_baja','desguace','Desguace',null,null,2), ('destino_baja','chatarra','Chatarra',null,null,3)
on conflict (lista, clave) do nothing;

insert into public.config (clave, valor) values
  ('telefono_mantenimiento', '""'),
  ('video_max_segundos', '60'),
  ('video_max_mb', '50'),
  ('foto_max_mb', '15'),
  ('documento_max_mb', '25'),
  -- Compras: las aprueba dirección. Monto en $ debajo del cual también puede aprobar el jefe (null = sin tope: solo dirección).
  ('compras_tope_jefe', 'null'),
  ('valor_hora_tecnico', '0'),
  ('inicio_por_perfil', '{}')
on conflict (clave) do nothing;


-- >>>>>>>>>> 20261114000200_equipos.sql
-- =====================================================================
-- App de mantenimiento · 2 · Equipos, documentos, proveedores y movimientos
-- =====================================================================

create table if not exists public.proveedores (
  id       uuid primary key default gen_random_uuid(),
  nombre   text not null check (length(btrim(nombre)) between 2 and 120),
  rubro    text,
  contacto text,
  telefono text,
  email    text,
  notas    text,
  activo   boolean not null default true,
  ejemplo  boolean not null default false
);
select public._control('public.proveedores');

-- ---------- Equipos ----------
-- Código EMPRESA DUEÑA-TIPO-NÚMERO (ej. PIN-APL-001): lo genera la base, correlativo por empresa
-- y tipo, y no se edita. La empresa dueña no cambia aunque el equipo se preste: a ella se le
-- cargan las reparaciones. Dónde está ahora es un dato aparte (empresa_ubicacion_id, área y ubicación).
create table if not exists public.equipos (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text not null unique,
  empresa_duena_id     uuid not null references public.empresas(id),
  tipo                 text not null references public.tipos_equipo(sigla),
  numero               int  not null,
  nombre               text not null check (length(btrim(nombre)) between 2 and 120),
  marca                text,
  modelo               text,
  serie                text,
  potencia             text,
  tension              text,
  proveedor_id         uuid references public.proveedores(id),
  planos               text,
  criticidad           text not null default 'media' check (criticidad in ('alta','media','baja')),
  empresa_ubicacion_id uuid not null references public.empresas(id),
  area_id              uuid references public.areas(id),
  ubicacion            text,
  estado               text not null default 'operativo'
                       check (estado in ('operativo','detenido','en_reparacion','reparacion_externa','baja')),
  campos               jsonb not null default '{}' check (jsonb_typeof(campos) = 'object'),
  horometro            numeric(12,1),
  horometro_fecha      date,
  notas                text,
  ejemplo              boolean not null default false,
  unique (empresa_duena_id, tipo, numero)
);
select public._control('public.equipos');
create index if not exists equipos_ubicacion on public.equipos (empresa_ubicacion_id, estado);
create index if not exists equipos_duena on public.equipos (empresa_duena_id);
drop trigger if exists no_borrar on public.equipos;
create trigger no_borrar before delete on public.equipos for each row execute function public.no_se_borra();

create or replace function public.codigo_equipo() returns trigger
language plpgsql security definer set search_path = public as $$
declare sig text;
begin
  if tg_op = 'INSERT' then
    select sigla into sig from public.empresas where id = new.empresa_duena_id;
    perform pg_advisory_xact_lock(hashtext('equipo:' || new.empresa_duena_id || ':' || new.tipo));
    if new.numero is null or auth.uid() is not null then
      select coalesce(max(numero), 0) + 1 into new.numero from public.equipos
        where empresa_duena_id = new.empresa_duena_id and tipo = new.tipo;
    end if;
    new.codigo := sig || '-' || new.tipo || '-' || lpad(new.numero::text, 3, '0');
    new.empresa_ubicacion_id := coalesce(new.empresa_ubicacion_id, new.empresa_duena_id);
  else
    if new.codigo is distinct from old.codigo or new.numero is distinct from old.numero
       or new.empresa_duena_id is distinct from old.empresa_duena_id or new.tipo is distinct from old.tipo then
      raise exception 'El código, la empresa dueña y el tipo del equipo no se pueden cambiar.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists b_codigo on public.equipos;
create trigger b_codigo before insert or update on public.equipos for each row execute function public.codigo_equipo();

-- Campos propios obligatorios del tipo de equipo (los define el jefe en Apariencia → Campos de la ficha)
create or replace function public.campos_obligatorios() returns trigger
language plpgsql security definer set search_path = public as $$
declare c jsonb; faltan text[] := '{}';
begin
  if auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' then return new; end if;
  for c in select jsonb_array_elements(campos) from public.tipos_equipo where sigla = new.tipo loop
    if coalesce((c->>'obligatorio')::boolean, false) and c->>'tipo' <> 'foto'
       and coalesce(btrim(new.campos->>(c->>'clave')), '') = '' then
      faltan := faltan || (c->>'etiqueta');
    end if;
  end loop;
  if array_length(faltan, 1) > 0 then
    raise exception 'Faltan datos obligatorios de la ficha: %.', array_to_string(faltan, ', ');
  end if;
  return new;
end $$;
drop trigger if exists b_campos on public.equipos;
create trigger b_campos before insert or update of campos, tipo on public.equipos for each row execute function public.campos_obligatorios();

-- La sigla de una empresa no se cambia si ya tiene equipos (es parte de sus códigos)
create or replace function public.sigla_fija() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sigla is distinct from old.sigla and exists (select 1 from public.equipos where empresa_duena_id = old.id) then
    raise exception 'La sigla % ya está en códigos de equipos y no se puede cambiar.', old.sigla using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists b_sigla on public.empresas;
create trigger b_sigla before update on public.empresas for each row execute function public.sigla_fija();

-- Códigos anteriores (etiquetas de W-Main): siguen abriendo el equipo
create table if not exists public.equipo_alias (
  alias     text primary key,
  equipo_id uuid not null references public.equipos(id) on delete cascade
);

-- Documentos del equipo: foto de chapa, fotos, manuales, planos, programas de PLC,
-- procedimientos de bloqueo y etiquetado, fotos de configuración. Se desactivan, no se borran.
create table if not exists public.documentos (
  id        uuid primary key default gen_random_uuid(),
  equipo_id uuid not null references public.equipos(id),
  categoria text not null check (categoria in ('chapa','foto','manual','plano','plc','bloqueo','configuracion','otro')),
  nombre    text not null,
  bucket    text,
  ruta      text,
  url       text,
  mime      text,
  bytes     bigint,
  activo    boolean not null default true,
  ejemplo   boolean not null default false,
  check (ruta is not null or url is not null)
);
select public._control('public.documentos');
create index if not exists documentos_equipo on public.documentos (equipo_id);

-- ---------- Movimientos de equipos ----------
-- prestamo:           lo pide el jefe, lo aprueba (o rechaza) dirección; después sale y vuelve.
-- reparacion_externa: taller, fechas de salida y vuelta, presupuesto, remito y garantía.
-- baja:               motivo y destino (venta, desguace o chatarra).
-- reubicacion:        cambio de área o lugar dentro de la misma empresa.
create table if not exists public.movimientos_equipo (
  id                  uuid primary key default gen_random_uuid(),
  equipo_id           uuid not null references public.equipos(id),
  tipo                text not null check (tipo in ('prestamo','reparacion_externa','baja','reubicacion')),
  estado              text not null default 'solicitado'
                      check (estado in ('solicitado','aprobado','rechazado','en_curso','cerrado')),
  empresa_origen_id   uuid references public.empresas(id),
  area_origen_id      uuid references public.areas(id),
  ubicacion_origen    text,
  empresa_destino_id  uuid references public.empresas(id),
  area_destino_id     uuid references public.areas(id),
  ubicacion_destino   text,
  motivo              text,
  destino_baja        text,
  proveedor_id        uuid references public.proveedores(id),
  fecha_salida        date,
  fecha_vuelta_prevista date,
  fecha_vuelta        date,
  presupuesto         numeric(14,2) check (presupuesto is null or presupuesto >= 0),
  remito              text,
  garantia_hasta      date,
  resuelto_por        uuid references public.usuarios(id),
  resuelto_en         timestamptz,
  respuesta           text,
  ejemplo             boolean not null default false
);
select public._control('public.movimientos_equipo');
create index if not exists movimientos_equipo_eq on public.movimientos_equipo (equipo_id, creado_en desc);
create index if not exists movimientos_equipo_estado on public.movimientos_equipo (estado, tipo);
drop trigger if exists no_borrar on public.movimientos_equipo;
create trigger no_borrar before delete on public.movimientos_equipo for each row execute function public.no_se_borra();


-- >>>>>>>>>> 20261114000300_ordenes.sql
-- =====================================================================
-- App de mantenimiento · 3 · Reportes de falla, órdenes de trabajo, fichas, costos y compras
-- Los id los puede generar el celular (para cargas sin señal): reenviar lo mismo no duplica.
-- =====================================================================

-- ---------- Reportes de falla del operario ----------
create table if not exists public.reportes_falla (
  id            uuid primary key default gen_random_uuid(),
  equipo_id     uuid not null references public.equipos(id),
  tipo_falla    text not null,
  parada        boolean not null,
  texto         text,
  operario_id   uuid references public.usuarios(id) default auth.uid(),
  estado        text not null default 'nuevo' check (estado in ('nuevo','en_orden','descartado')),
  orden_id      uuid,
  motivo_descarte text,
  hecho_en      timestamptz not null default now(),  -- cuándo lo cargó en el celular (puede ser sin señal)
  ejemplo       boolean not null default false
);
select public._control('public.reportes_falla');
create index if not exists reportes_estado on public.reportes_falla (estado, hecho_en desc);
create index if not exists reportes_equipo on public.reportes_falla (equipo_id);

-- ---------- Órdenes de trabajo ----------
-- Estados internos (no cambian; su nombre y color se editan en listas):
-- abierta → asignada → en_curso ⇄ esperando_repuesto → terminada → (verificada) → cerrada · anulada
create table if not exists public.ordenes (
  id                   uuid primary key default gen_random_uuid(),
  numero               int not null unique,
  equipo_id            uuid not null references public.equipos(id),
  reporte_id           uuid references public.reportes_falla(id),
  titulo               text not null check (length(btrim(titulo)) between 2 and 200),
  descripcion          text,
  tipo                 text not null default 'correctiva' check (tipo in ('correctiva','preventiva','mejora')),
  estado               text not null default 'abierta'
                       check (estado in ('abierta','asignada','esperando_repuesto','en_curso','terminada','verificada','cerrada','anulada')),
  parada               boolean not null default false,
  prioridad_calculada  text not null default 'media' check (prioridad_calculada in ('urgente','alta','media','baja')),
  prioridad            text not null default 'media' check (prioridad in ('urgente','alta','media','baja')),
  prioridad_por        uuid references public.usuarios(id),
  prioridad_en         timestamptz,
  asignado_a           uuid references public.usuarios(id),
  contratista_id       uuid references public.proveedores(id),
  vence                date,
  empresa_cargo_id     uuid not null references public.empresas(id),
  requiere_verificacion boolean not null default false,
  terminada_en         timestamptz,
  cerrada_en           timestamptz,
  motivo_anulacion     text,
  ejemplo              boolean not null default false
);
select public._control('public.ordenes');
create index if not exists ordenes_estado on public.ordenes (estado, prioridad);
create index if not exists ordenes_equipo on public.ordenes (equipo_id);
create index if not exists ordenes_asignado on public.ordenes (asignado_a, estado);
drop trigger if exists no_borrar on public.ordenes;
create trigger no_borrar before delete on public.ordenes for each row execute function public.no_se_borra();
do $$ begin
  alter table public.reportes_falla add constraint reportes_orden_fk foreign key (orden_id) references public.ordenes(id);
exception when duplicate_object then null; end $$;

-- Prioridad: combina la criticidad del equipo con si está parado.
create or replace function public.prioridad_de(criticidad text, parada boolean) returns text
language sql immutable as $$
  select case
    when parada and criticidad = 'alta' then 'urgente'
    when parada and criticidad = 'media' then 'alta'
    when parada then 'media'
    when criticidad = 'alta' then 'alta'
    when criticidad = 'media' then 'media'
    else 'baja' end
$$;

-- ---------- Fichas de trabajo (las cargan técnicos, encargado o el jefe por un contratista) ----------
-- La ficha de cierre lleva horas, horas de máquina parada, causa, fotos de antes y después y,
-- en equipos críticos, la firma del supervisor de producción (sin cuenta propia).
create table if not exists public.fichas (
  id                uuid primary key default gen_random_uuid(),
  orden_id          uuid not null references public.ordenes(id),
  tecnico_id        uuid references public.usuarios(id),
  contratista_id    uuid references public.proveedores(id),
  es_cierre         boolean not null default false,
  trabajo           text not null check (length(btrim(trabajo)) >= 2),
  horas             numeric(7,2) not null default 0 check (horas between 0 and 1000),
  horas_parada      numeric(7,2) not null default 0 check (horas_parada between 0 and 1000),
  causa             text,
  supervisor_nombre text,
  firma_ruta        text,
  remito            text,
  hecho_en          timestamptz not null default now(),
  ejemplo           boolean not null default false
);
select public._control('public.fichas');
create index if not exists fichas_orden on public.fichas (orden_id, hecho_en);

-- ---------- Costos de la orden: repuestos, servicios externos y otros (las horas salen de las fichas) ----------
create table if not exists public.costos_orden (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null references public.ordenes(id),
  tipo           text not null check (tipo in ('repuesto','servicio','otro')),
  descripcion    text not null,
  cantidad       numeric(12,3) not null default 1 check (cantidad > 0),
  costo_unitario numeric(14,2) not null default 0 check (costo_unitario >= 0),
  proveedor_id   uuid references public.proveedores(id),
  remito         text,
  ejemplo        boolean not null default false
);
select public._control('public.costos_orden');
create index if not exists costos_orden_orden on public.costos_orden (orden_id);

-- ---------- Pedidos de compra (los aprueba dirección; el jefe, debajo del tope configurado) ----------
create table if not exists public.pedidos_compra (
  id             uuid primary key default gen_random_uuid(),
  numero         int not null unique,
  orden_id       uuid references public.ordenes(id),
  equipo_id      uuid references public.equipos(id),
  empresa_id     uuid not null references public.empresas(id),
  descripcion    text not null check (length(btrim(descripcion)) >= 2),
  cantidad       numeric(12,3) not null default 1 check (cantidad > 0),
  monto_estimado numeric(14,2) check (monto_estimado is null or monto_estimado >= 0),
  proveedor_id   uuid references public.proveedores(id),
  estado         text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado','recibido','anulado')),
  resuelto_por   uuid references public.usuarios(id),
  resuelto_en    timestamptz,
  respuesta      text,
  ejemplo        boolean not null default false
);
select public._control('public.pedidos_compra');
create index if not exists pedidos_estado on public.pedidos_compra (estado);
drop trigger if exists no_borrar on public.pedidos_compra;
create trigger no_borrar before delete on public.pedidos_compra for each row execute function public.no_se_borra();

-- ---------- Fotos y videos (de reportes, fichas, costos y movimientos) ----------
create table if not exists public.adjuntos (
  id          uuid primary key default gen_random_uuid(),
  tabla       text not null check (tabla in ('reportes_falla','fichas','costos_orden','movimientos_equipo')),
  registro_id uuid not null,
  bucket      text not null default 'adjuntos',
  ruta        text not null,
  tipo        text not null check (tipo in ('foto','video')),
  momento     text check (momento in ('antes','despues')),
  mime        text,
  bytes       bigint,
  segundos    numeric(7,1),
  ejemplo     boolean not null default false
);
select public._control('public.adjuntos');
create index if not exists adjuntos_registro on public.adjuntos (tabla, registro_id);

-- Números correlativos sin saltos (órdenes y pedidos)
create or replace function public.numerar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('numerar:' || tg_table_name));
    if new.numero is null or auth.uid() is not null then
      execute format('select coalesce(max(numero), 0) + 1 from public.%I', tg_table_name) into new.numero;
    end if;
  elsif new.numero is distinct from old.numero then
    raise exception 'El número no se puede cambiar.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists b_numerar on public.ordenes;
create trigger b_numerar before insert or update on public.ordenes for each row execute function public.numerar();
drop trigger if exists b_numerar on public.pedidos_compra;
create trigger b_numerar before insert or update on public.pedidos_compra for each row execute function public.numerar();


-- >>>>>>>>>> 20261114000400_reglas.sql
-- =====================================================================
-- App de mantenimiento · 4 · Reglas: estados de órdenes, compras y movimientos de equipos
-- Los cambios de estado pasan siempre por estas funciones, que controlan quién puede hacer cada
-- paso. Un trigger impide cambiar estados "a mano" desde la app.
-- =====================================================================

-- Marca que el cambio lo hace una función autorizada (dura solo la transacción)
create or replace function public._transicion() returns void
language sql as $$ select set_config('planta.transicion', '1', true) $$;
create or replace function public._en_transicion() returns boolean
language sql stable as $$ select auth.uid() is null or coalesce(current_setting('planta.transicion', true), '') = '1' $$;
-- Deja asentado quién aprobó (lo lee el registro de cambios)
create or replace function public._aprueba(u uuid) returns void
language sql as $$ select set_config('planta.aprobo_id', coalesce(u::text, ''), true) $$;
create or replace function public._nombre(u uuid) returns text
language sql stable security definer set search_path = public as $$ select nombre from public.usuarios where id = u $$;
create or replace function public._error(msg text) returns void
language plpgsql as $$ begin raise exception '%', msg using errcode = '42501'; end $$;

-- ¿Veo este equipo? (por la empresa dueña o la empresa donde está)
create or replace function public.veo_equipo(eq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipos e where e.id = eq and (public.mi_empresa(e.empresa_duena_id) or public.mi_empresa(e.empresa_ubicacion_id)))
$$;

-- ¿Puede esta persona trabajar en este equipo? (para asignarle órdenes)
create or replace function public._puede_trabajar(u uuid, eq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios us join public.equipos e on e.id = eq
    where us.id = u and us.activo and (us.perfil = 'jefe' or (us.perfil in ('tecnico','encargado') and exists (
      select 1 from public.usuario_empresas ue where ue.usuario_id = u and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)))))
$$;

-- ---------- Equipos: estado y ubicación solo cambian por funciones (dejan el movimiento registrado) ----------
create or replace function public.guardia_equipo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public._en_transicion() and (
       new.estado is distinct from old.estado or new.empresa_ubicacion_id is distinct from old.empresa_ubicacion_id
    or new.area_id is distinct from old.area_id or new.ubicacion is distinct from old.ubicacion) then
    raise exception 'El estado y la ubicación del equipo se cambian con un movimiento (reubicación, préstamo, reparación externa o baja).' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists c_guardia on public.equipos;
create trigger c_guardia before update on public.equipos for each row execute function public.guardia_equipo();

-- Un reporte con la máquina parada la deja «detenida» al instante
create or replace function public.reporte_detiene() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.operario_id := auth.uid();
    new.estado := 'nuevo'; new.orden_id := null; new.motivo_descarte := null;
  end if;
  return new;
end $$;
drop trigger if exists b_reporte on public.reportes_falla;
create trigger b_reporte before insert on public.reportes_falla for each row execute function public.reporte_detiene();

create or replace function public.reporte_parada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parada then
    perform public._transicion();
    update public.equipos set estado = 'detenido' where id = new.equipo_id and estado = 'operativo';
  end if;
  return null;
end $$;
drop trigger if exists c_reporte on public.reportes_falla;
create trigger c_reporte after insert on public.reportes_falla for each row execute function public.reporte_parada();

-- ---------- Órdenes ----------
create or replace function public.orden_nueva() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.equipos; r public.reportes_falla;
begin
  select * into e from public.equipos where id = new.equipo_id;
  if e.estado = 'baja' and not (auth.uid() is null and current_setting('planta.carga_masiva', true) = '1') then
    raise exception 'El equipo % está dado de baja.', e.codigo;
  end if;
  if new.reporte_id is not null then
    select * into r from public.reportes_falla where id = new.reporte_id;
    if r.estado <> 'nuevo' then raise exception 'Ese reporte ya fue atendido.'; end if;
    new.parada := r.parada;
  end if;
  new.empresa_cargo_id := e.empresa_duena_id;          -- las reparaciones se cargan a la empresa dueña
  new.requiere_verificacion := e.criticidad = 'alta';   -- producción verifica solo en equipos críticos
  new.prioridad_calculada := public.prioridad_de(e.criticidad, new.parada);
  if auth.uid() is not null then
    if new.asignado_a is not null and not public._puede_trabajar(new.asignado_a, new.equipo_id) then
      raise exception 'Esa persona no puede trabajar en este equipo (no es de mantenimiento o no tiene acceso a su empresa).';
    end if;
    new.prioridad := new.prioridad_calculada; new.prioridad_por := null; new.prioridad_en := null;
    new.estado := case when new.asignado_a is not null or new.contratista_id is not null then 'asignada' else 'abierta' end;
    new.terminada_en := null; new.cerrada_en := null;
  end if;
  return new;
end $$;
drop trigger if exists b_nueva on public.ordenes;
create trigger b_nueva before insert on public.ordenes for each row execute function public.orden_nueva();

create or replace function public.orden_desde_reporte() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reporte_id is not null then
    update public.reportes_falla set estado = 'en_orden', orden_id = new.id where id = new.reporte_id;
  end if;
  if new.parada then
    perform public._transicion();
    update public.equipos set estado = 'en_reparacion' where id = new.equipo_id and estado in ('operativo','detenido');
  end if;
  return null;
end $$;
drop trigger if exists c_desde_reporte on public.ordenes;
create trigger c_desde_reporte after insert on public.ordenes for each row execute function public.orden_desde_reporte();

-- Edición directa (jefe y encargado): título, descripción, tipo, vencimiento, asignación.
-- Estado, prioridad y fechas de cierre solo por funciones. Asignar una orden abierta la pasa a «asignada».
create or replace function public.guardia_orden() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.asignado_a is distinct from old.asignado_a and new.asignado_a is not null and auth.uid() is not null
     and not public._puede_trabajar(new.asignado_a, new.equipo_id) then
    raise exception 'Esa persona no puede trabajar en este equipo (no es de mantenimiento o no tiene acceso a su empresa).';
  end if;
  if not public._en_transicion() then
    if (new.estado, new.prioridad, new.prioridad_por, new.prioridad_calculada, new.empresa_cargo_id, new.requiere_verificacion,
        new.terminada_en, new.cerrada_en, new.equipo_id, new.reporte_id, new.parada)
       is distinct from
       (old.estado, old.prioridad, old.prioridad_por, old.prioridad_calculada, old.empresa_cargo_id, old.requiere_verificacion,
        old.terminada_en, old.cerrada_en, old.equipo_id, old.reporte_id, old.parada) then
      raise exception 'El estado y la prioridad de la orden se cambian con las acciones de la orden.' using errcode = '42501';
    end if;
    if old.estado in ('cerrada','anulada') then
      raise exception 'La orden está %: no se puede modificar.', old.estado using errcode = '42501';
    end if;
    if old.estado = 'abierta' and (new.asignado_a is not null or new.contratista_id is not null) then
      new.estado := 'asignada';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists c_guardia on public.ordenes;
create trigger c_guardia before update on public.ordenes for each row execute function public.guardia_orden();

-- Si ninguna otra orden activa tiene la máquina parada, el equipo vuelve a «operativo»
create or replace function public._liberar_equipo(eq uuid, salvo uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ordenes where equipo_id = eq and id <> salvo and parada
                 and estado not in ('terminada','verificada','cerrada','anulada')) then
    perform public._transicion();
    update public.equipos set estado = 'operativo' where id = eq and estado in ('detenido','en_reparacion');
  end if;
end $$;

-- Cambios de estado de la orden
create or replace function public.orden_estado(p_orden uuid, p_estado text, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.ordenes; yo uuid := auth.uid(); p text := public.mi_perfil();
  responsable boolean;
begin
  select * into o from public.ordenes where id = p_orden for update;
  if o.id is null or not public.veo_equipo(o.equipo_id) then perform public._error('No existe la orden o no tenés acceso.'); end if;
  responsable := p in ('jefe','encargado') or (p = 'tecnico' and o.asignado_a = yo);
  perform public._transicion();
  if p_estado = 'en_curso' then
    if o.estado in ('abierta','asignada','esperando_repuesto') then
      if not responsable then perform public._error('Solo el técnico asignado, el encargado o el jefe pueden empezar el trabajo.'); end if;
    elsif o.estado in ('terminada','verificada','cerrada') then
      if p <> 'jefe' then perform public._error('Solo el jefe de mantenimiento puede reabrir una orden.'); end if;
    else perform public._error('La orden no puede pasar a «en curso» desde «' || o.estado || '».');
    end if;
    update public.ordenes set estado = 'en_curso', terminada_en = null, cerrada_en = null,
      asignado_a = coalesce(asignado_a, case when p = 'tecnico' then yo end) where id = p_orden;
  elsif p_estado = 'esperando_repuesto' then
    if o.estado not in ('abierta','asignada','en_curso') or not responsable then
      perform public._error('No podés marcar esta orden como «esperando repuesto».');
    end if;
    update public.ordenes set estado = 'esperando_repuesto' where id = p_orden;
  elsif p_estado = 'cerrada' then
    if p not in ('jefe','encargado') then perform public._error('Solo el jefe o el encargado cierran órdenes.'); end if;
    if o.estado = 'terminada' and o.requiere_verificacion then
      perform public._error('Equipo crítico: falta la verificación de producción (firma del supervisor en la ficha de cierre).');
    end if;
    if o.estado not in ('terminada','verificada') then perform public._error('La orden tiene que estar terminada para cerrarla.'); end if;
    update public.ordenes set estado = 'cerrada', cerrada_en = now() where id = p_orden;
  elsif p_estado = 'anulada' then
    if p <> 'jefe' then perform public._error('Solo el jefe de mantenimiento anula órdenes.'); end if;
    if coalesce(btrim(p_motivo), '') = '' then perform public._error('Indicá el motivo de la anulación.'); end if;
    if o.estado = 'cerrada' then perform public._error('Una orden cerrada no se anula.'); end if;
    update public.ordenes set estado = 'anulada', motivo_anulacion = p_motivo where id = p_orden;
    if o.reporte_id is not null then update public.reportes_falla set estado = 'nuevo', orden_id = null where id = o.reporte_id; end if;
    perform public._liberar_equipo(o.equipo_id, o.id);
  else
    perform public._error('Ese cambio de estado se hace con la ficha de cierre o no existe.');
  end if;
end $$;

-- Dirección confirma o cambia la prioridad
create or replace function public.orden_prioridad(p_orden uuid, p_prioridad text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es('direccion') then perform public._error('La prioridad la confirma o cambia dirección.'); end if;
  if p_prioridad not in ('urgente','alta','media','baja') then perform public._error('Prioridad desconocida.'); end if;
  if not exists (select 1 from public.ordenes o where o.id = p_orden and public.veo_equipo(o.equipo_id)) then perform public._error('No existe la orden o no tenés acceso.'); end if;
  perform public._transicion(); perform public._aprueba(auth.uid());
  update public.ordenes set prioridad = p_prioridad, prioridad_por = auth.uid(), prioridad_en = now() where id = p_orden;
end $$;

-- Fichas: a nombre de quien la carga (o del contratista, si la carga el jefe). La de cierre termina la orden.
create or replace function public.ficha_nueva() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.ordenes;
begin
  if auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' then return new; end if;
  select * into o from public.ordenes where id = new.orden_id for update;
  if o.estado in ('terminada','verificada','cerrada','anulada') then
    raise exception 'La orden ya está %: no se cargan más fichas.', o.estado using errcode = '42501';
  end if;
  if auth.uid() is not null then
    if new.contratista_id is not null then
      if not public.es('jefe') then raise exception 'El trabajo de un contratista lo carga el jefe de mantenimiento.' using errcode = '42501'; end if;
      new.tecnico_id := null;
    else
      new.tecnico_id := auth.uid();
    end if;
  end if;
  if new.es_cierre then
    if new.causa is null then raise exception 'Indicá la causa de la falla.'; end if;
    if o.requiere_verificacion and (coalesce(btrim(new.supervisor_nombre), '') = '' or new.firma_ruta is null) then
      raise exception 'Equipo crítico: el supervisor de producción tiene que firmar el cierre.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists b_ficha on public.fichas;
create trigger b_ficha before insert on public.fichas for each row execute function public.ficha_nueva();

create or replace function public.ficha_mueve_orden() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.ordenes;
begin
  if auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' then return null; end if;
  select * into o from public.ordenes where id = new.orden_id;
  perform public._transicion();
  if new.es_cierre then
    update public.ordenes set estado = case when o.requiere_verificacion then 'verificada' else 'terminada' end, terminada_en = now()
      where id = new.orden_id;
    perform public._liberar_equipo(o.equipo_id, o.id);
  elsif o.estado in ('abierta','asignada') then
    update public.ordenes set estado = 'en_curso' where id = new.orden_id;
  end if;
  return null;
end $$;
drop trigger if exists c_ficha on public.fichas;
create trigger c_ficha after insert on public.fichas for each row execute function public.ficha_mueve_orden();

-- Descartar un reporte (jefe o encargado)
create or replace function public.descartar_reporte(p_reporte uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe','encargado') then perform public._error('Solo el jefe o el encargado descartan reportes.'); end if;
  if coalesce(btrim(p_motivo), '') = '' then perform public._error('Indicá el motivo.'); end if;
  update public.reportes_falla set estado = 'descartado', motivo_descarte = p_motivo
    where id = p_reporte and estado = 'nuevo' and public.veo_equipo(equipo_id);
  if not found then perform public._error('El reporte no existe o ya fue atendido.'); end if;
end $$;

-- ---------- Compras ----------
-- Pedir un repuesto desde una orden: la orden pasa a «esperando repuesto».
create or replace function public.pedir_repuesto(p_orden uuid, p_descripcion text, p_cantidad numeric default 1, p_monto numeric default null, p_proveedor uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare o public.ordenes; nid uuid; p text := public.mi_perfil();
begin
  select * into o from public.ordenes where id = p_orden;
  if o.id is null or not public.veo_equipo(o.equipo_id) then perform public._error('No existe la orden o no tenés acceso.'); end if;
  if not (p in ('jefe','encargado') or (p = 'tecnico' and o.asignado_a = auth.uid())) then
    perform public._error('Solo el técnico asignado, el encargado o el jefe piden repuestos.');
  end if;
  if o.estado in ('terminada','verificada','cerrada','anulada') then perform public._error('La orden ya está terminada.'); end if;
  insert into public.pedidos_compra (orden_id, equipo_id, empresa_id, descripcion, cantidad, monto_estimado, proveedor_id)
  values (p_orden, o.equipo_id, o.empresa_cargo_id, p_descripcion, coalesce(p_cantidad, 1), p_monto, p_proveedor) returning id into nid;
  perform public._transicion();
  update public.ordenes set estado = 'esperando_repuesto' where id = p_orden and estado <> 'esperando_repuesto';
  return nid;
end $$;

-- Aprobar o rechazar: dirección siempre; el jefe, si el monto está por debajo del tope configurado.
create or replace function public.resolver_pedido(p_pedido uuid, p_aprobar boolean, p_respuesta text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.pedidos_compra; tope numeric;
begin
  select * into c from public.pedidos_compra where id = p_pedido for update;
  if c.id is null or not public.mi_empresa(c.empresa_id) then perform public._error('No existe el pedido o no tenés acceso.'); end if;
  if c.estado <> 'pendiente' then perform public._error('El pedido ya fue resuelto.'); end if;
  select nullif(valor, 'null'::jsonb)::text::numeric into tope from public.config where clave = 'compras_tope_jefe';
  if not (public.es('direccion') or (public.es('jefe') and tope is not null and coalesce(c.monto_estimado, 0) <= tope)) then
    perform public._error(case when public.es('jefe') then 'Este pedido lo aprueba dirección (supera el tope del jefe o no hay tope configurado).'
                               else 'Los pedidos de compra los aprueba dirección.' end);
  end if;
  if not p_aprobar and coalesce(btrim(p_respuesta), '') = '' then perform public._error('Indicá el motivo del rechazo.'); end if;
  perform public._aprueba(auth.uid());
  update public.pedidos_compra set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
    resuelto_por = auth.uid(), resuelto_en = now(), respuesta = p_respuesta where id = p_pedido;
end $$;

-- Llegó el repuesto: si la orden no espera nada más, vuelve a «en curso».
create or replace function public.recibir_pedido(p_pedido uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.pedidos_compra;
begin
  if not public.es('jefe','encargado') then perform public._error('Solo el jefe o el encargado registran la recepción.'); end if;
  select * into c from public.pedidos_compra where id = p_pedido for update;
  if c.estado <> 'aprobado' then perform public._error('Solo se recibe un pedido aprobado.'); end if;
  update public.pedidos_compra set estado = 'recibido' where id = p_pedido;
  if c.orden_id is not null and not exists (select 1 from public.pedidos_compra where orden_id = c.orden_id and estado in ('pendiente','aprobado')) then
    perform public._transicion();
    update public.ordenes set estado = 'en_curso' where id = c.orden_id and estado = 'esperando_repuesto';
  end if;
end $$;

-- ---------- Movimientos de equipos ----------
create or replace function public._equipo(eq uuid) returns public.equipos
language plpgsql security definer set search_path = public as $$
declare e public.equipos;
begin
  select * into e from public.equipos where id = eq for update;
  if e.id is null then perform public._error('No existe el equipo.'); end if;
  if e.estado = 'baja' then perform public._error('El equipo ' || e.codigo || ' está dado de baja.'); end if;
  return e;
end $$;

-- Préstamo entre empresas: lo pide el jefe…
create or replace function public.pedir_prestamo(p_equipo uuid, p_empresa_destino uuid, p_area uuid, p_ubicacion text, p_vuelta date, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.equipos; nid uuid;
begin
  if not public.es('jefe') then perform public._error('Los préstamos los pide el jefe de mantenimiento.'); end if;
  e := public._equipo(p_equipo);
  if p_empresa_destino = e.empresa_ubicacion_id then perform public._error('El equipo ya está en esa empresa.'); end if;
  if exists (select 1 from public.movimientos_equipo where equipo_id = p_equipo and estado in ('solicitado','aprobado','en_curso') and tipo in ('prestamo','reparacion_externa')) then
    perform public._error('El equipo ya tiene un préstamo o una reparación externa en trámite.');
  end if;
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, empresa_destino_id, area_destino_id, ubicacion_destino, fecha_vuelta_prevista, motivo)
  values (p_equipo, 'prestamo', 'solicitado', e.empresa_ubicacion_id, p_empresa_destino, p_area, p_ubicacion, p_vuelta, p_motivo) returning id into nid;
  return nid;
end $$;

-- …y lo aprueba o rechaza dirección
create or replace function public.resolver_prestamo(p_mov uuid, p_aprobar boolean, p_respuesta text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es('direccion') then perform public._error('Los préstamos entre empresas los aprueba dirección.'); end if;
  if not p_aprobar and coalesce(btrim(p_respuesta), '') = '' then perform public._error('Indicá el motivo del rechazo.'); end if;
  perform public._aprueba(auth.uid());
  update public.movimientos_equipo set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
    resuelto_por = auth.uid(), resuelto_en = now(), respuesta = p_respuesta
    where id = p_mov and tipo = 'prestamo' and estado = 'solicitado';
  if not found then perform public._error('El préstamo no existe o ya fue resuelto.'); end if;
end $$;

-- El jefe registra que el equipo salió (préstamo aprobado) o volvió (préstamo o reparación externa)
create or replace function public.mover_equipo(p_mov uuid, p_accion text, p_fecha date default current_date, p_datos jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare m public.movimientos_equipo; e public.equipos;
begin
  if not public.es('jefe') then perform public._error('Solo el jefe de mantenimiento registra la salida y la vuelta de equipos.'); end if;
  select * into m from public.movimientos_equipo where id = p_mov for update;
  if m.id is null then perform public._error('No existe el movimiento.'); end if;
  select * into e from public.equipos where id = m.equipo_id for update;
  perform public._transicion();
  if p_accion = 'salida' and m.tipo = 'prestamo' and m.estado = 'aprobado' then
    update public.movimientos_equipo set estado = 'en_curso', fecha_salida = p_fecha,
      area_origen_id = e.area_id, ubicacion_origen = e.ubicacion where id = p_mov;
    update public.equipos set empresa_ubicacion_id = m.empresa_destino_id, area_id = coalesce(m.area_destino_id, area_id),
      ubicacion = coalesce(m.ubicacion_destino, ubicacion) where id = m.equipo_id;
  elsif p_accion = 'vuelta' and m.estado = 'en_curso' and m.tipo = 'prestamo' then
    update public.movimientos_equipo set estado = 'cerrado', fecha_vuelta = p_fecha where id = p_mov;
    update public.equipos set empresa_ubicacion_id = m.empresa_origen_id,
      area_id = coalesce((p_datos->>'area_id')::uuid, m.area_origen_id), ubicacion = coalesce(p_datos->>'ubicacion', m.ubicacion_origen) where id = m.equipo_id;
  elsif p_accion = 'vuelta' and m.estado = 'en_curso' and m.tipo = 'reparacion_externa' then
    update public.movimientos_equipo set estado = 'cerrado', fecha_vuelta = p_fecha,
      remito = coalesce(p_datos->>'remito', remito), garantia_hasta = coalesce((p_datos->>'garantia_hasta')::date, garantia_hasta),
      presupuesto = coalesce((p_datos->>'costo')::numeric, presupuesto) where id = p_mov;
    update public.equipos set estado = 'operativo' where id = m.equipo_id;
  else
    perform public._error('Ese paso no corresponde al estado del movimiento.');
  end if;
end $$;

-- El jefe cancela un préstamo que todavía no salió (pedido o aprobado): queda como rechazado, con el motivo
create or replace function public.cancelar_prestamo(p_mov uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe') then perform public._error('Los préstamos los cancela el jefe de mantenimiento.'); end if;
  if coalesce(btrim(p_motivo), '') = '' then perform public._error('Indicá el motivo.'); end if;
  update public.movimientos_equipo set estado = 'rechazado', respuesta = 'Cancelado: ' || p_motivo, resuelto_por = auth.uid(), resuelto_en = now()
    where id = p_mov and tipo = 'prestamo' and estado in ('solicitado','aprobado');
  if not found then perform public._error('Solo se cancela un préstamo que todavía no salió.'); end if;
end $$;

-- Mandar a reparar afuera (el jefe; queda en curso desde la salida)
create or replace function public.reparacion_externa(p_equipo uuid, p_proveedor uuid, p_salida date, p_vuelta date, p_presupuesto numeric, p_remito text, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.equipos; nid uuid;
begin
  if not public.es('jefe') then perform public._error('Mandar a reparar afuera lo decide el jefe de mantenimiento.'); end if;
  e := public._equipo(p_equipo);
  if exists (select 1 from public.movimientos_equipo where equipo_id = p_equipo and estado in ('solicitado','aprobado','en_curso') and tipo in ('prestamo','reparacion_externa')) then
    perform public._error('El equipo ya tiene un préstamo o una reparación externa en trámite.');
  end if;
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, proveedor_id, fecha_salida, fecha_vuelta_prevista, presupuesto, remito, motivo)
  values (p_equipo, 'reparacion_externa', 'en_curso', e.empresa_ubicacion_id, p_proveedor, coalesce(p_salida, current_date), p_vuelta, p_presupuesto, p_remito, p_motivo)
  returning id into nid;
  perform public._transicion();
  update public.equipos set estado = 'reparacion_externa' where id = p_equipo;
  return nid;
end $$;

-- Reubicar dentro de la empresa donde está (área y lugar)
create or replace function public.reubicar_equipo(p_equipo uuid, p_area uuid, p_ubicacion text, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare e public.equipos;
begin
  if not public.es('jefe') then perform public._error('Las reubicaciones las hace el jefe de mantenimiento.'); end if;
  e := public._equipo(p_equipo);
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, empresa_destino_id, area_destino_id, ubicacion_destino, motivo, fecha_salida)
  values (p_equipo, 'reubicacion', 'cerrado', e.empresa_ubicacion_id, e.empresa_ubicacion_id, p_area, p_ubicacion, p_motivo, current_date);
  perform public._transicion();
  update public.equipos set area_id = p_area, ubicacion = nullif(btrim(p_ubicacion), '') where id = p_equipo;
end $$;

-- Baja: motivo y destino (venta, desguace o chatarra). El equipo queda con su historial.
create or replace function public.baja_equipo(p_equipo uuid, p_motivo text, p_destino text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.equipos;
begin
  if not public.es('jefe') then perform public._error('Las bajas las hace el jefe de mantenimiento.'); end if;
  e := public._equipo(p_equipo);
  if coalesce(btrim(p_motivo), '') = '' then perform public._error('Indicá el motivo de la baja.'); end if;
  if not exists (select 1 from public.listas where lista = 'destino_baja' and clave = p_destino) then perform public._error('Elegí el destino: venta, desguace o chatarra.'); end if;
  if exists (select 1 from public.ordenes where equipo_id = p_equipo and estado not in ('cerrada','anulada')) then
    perform public._error('El equipo tiene órdenes abiertas: cerralas o anulalas antes de darlo de baja.');
  end if;
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, motivo, destino_baja, fecha_salida)
  values (p_equipo, 'baja', 'cerrado', e.empresa_ubicacion_id, p_motivo, p_destino, current_date);
  perform public._transicion();
  update public.equipos set estado = 'baja' where id = p_equipo;
end $$;

-- Detener o volver a operativo a mano (jefe o encargado), por ejemplo tras una revisión
create or replace function public.estado_equipo(p_equipo uuid, p_estado text, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe','encargado') then perform public._error('Solo el jefe o el encargado cambian el estado de un equipo.'); end if;
  if p_estado not in ('operativo','detenido') then perform public._error('Desde acá solo se marca «operativo» o «detenido».'); end if;
  perform public._equipo(p_equipo);
  perform public._transicion();
  perform set_config('planta.motivo', coalesce(p_motivo, ''), true);
  update public.equipos set estado = p_estado where id = p_equipo and estado in ('operativo','detenido','en_reparacion');
end $$;

-- Horómetro (lo lee y lo carga el personal de mantenimiento)
create or replace function public.cargar_horometro(p_equipo uuid, p_valor numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_mantenimiento() or not public.veo_equipo(p_equipo) then perform public._error('No podés cargar el horómetro de ese equipo.'); end if;
  if p_valor < 0 then perform public._error('El horómetro no puede ser negativo.'); end if;
  update public.equipos set horometro = p_valor, horometro_fecha = current_date where id = p_equipo;
end $$;


-- >>>>>>>>>> 20261114000500_usuarios.sql
-- =====================================================================
-- App de mantenimiento · 5 · Usuarios: alta, edición, contraseña, activar y desactivar
-- Los administra el jefe de mantenimiento. Se ingresa con USUARIO: en Supabase Auth se guarda
-- como usuario@cuentas.mantenimiento.app (nunca recibe correos).
-- =====================================================================
create or replace function public._email_de(usuario text) returns text
language sql immutable as $$ select lower(btrim(usuario)) || '@cuentas.mantenimiento.app' $$;

create or replace function public._crear_auth(p_id uuid, p_email text, p_clave text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if length(coalesce(p_clave, '')) < 8 then raise exception 'La contraseña tiene que tener al menos 8 caracteres.'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id::text, p_id,
          jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());
end $$;

create or replace function public._empresas_de(p_usuario uuid, p_empresas uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.usuario_empresas where usuario_id = p_usuario;
  insert into public.usuario_empresas (usuario_id, empresa_id)
    select p_usuario, e from unnest(coalesce(p_empresas, '{}')) e where exists (select 1 from public.empresas where id = e)
    on conflict do nothing;
end $$;

create or replace function public._crear_usuario(p_usuario text, p_nombre text, p_perfil text, p_clave text,
  p_telefono text, p_empresas uuid[], p_ejemplo boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare u text := lower(btrim(coalesce(p_usuario, ''))); nid uuid := gen_random_uuid();
begin
  if u !~ '^[a-z0-9._-]{3,30}$' then raise exception 'El usuario tiene que tener de 3 a 30 letras minúsculas, números, punto o guion.'; end if;
  if exists (select 1 from public.usuarios where usuario = u) or exists (select 1 from auth.users where email = public._email_de(u)) then
    raise exception 'Ese usuario ya existe.';
  end if;
  if length(btrim(coalesce(p_nombre, ''))) < 2 then raise exception 'Escribí el nombre y apellido.'; end if;
  if p_perfil not in ('jefe','encargado','tecnico','operario','direccion') then raise exception 'Perfil desconocido.'; end if;
  if p_perfil <> 'jefe' and coalesce(array_length(p_empresas, 1), 0) = 0 then raise exception 'Elegí al menos una empresa.'; end if;
  perform public._crear_auth(nid, public._email_de(u), p_clave);
  insert into public.usuarios (id, usuario, nombre, perfil, telefono, ejemplo) values (nid, u, btrim(p_nombre), p_perfil, nullif(btrim(p_telefono), ''), p_ejemplo);
  perform public._empresas_de(nid, case when p_perfil = 'jefe' then array(select id from public.empresas) else p_empresas end);
  return nid;
end $$;

create or replace function public.crear_usuario(p_usuario text, p_nombre text, p_perfil text, p_clave text, p_telefono text, p_empresas uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe') then perform public._error('Los usuarios los crea el jefe de mantenimiento.'); end if;
  return public._crear_usuario(p_usuario, p_nombre, p_perfil, p_clave, p_telefono, p_empresas);
end $$;

create or replace function public.editar_usuario(p_id uuid, p_nombre text, p_perfil text, p_telefono text, p_empresas uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe') then perform public._error('Los usuarios los edita el jefe de mantenimiento.'); end if;
  if p_id = auth.uid() and p_perfil <> 'jefe' then perform public._error('No podés quitarte el perfil de jefe.'); end if;
  if p_perfil not in ('jefe','encargado','tecnico','operario','direccion') then perform public._error('Perfil desconocido.'); end if;
  if p_perfil <> 'jefe' and coalesce(array_length(p_empresas, 1), 0) = 0 then perform public._error('Elegí al menos una empresa.'); end if;
  update public.usuarios set nombre = btrim(p_nombre), perfil = p_perfil, telefono = nullif(btrim(p_telefono), '') where id = p_id;
  if not found then perform public._error('No existe el usuario.'); end if;
  perform public._empresas_de(p_id, case when p_perfil = 'jefe' then array(select id from public.empresas) else p_empresas end);
end $$;

create or replace function public.restablecer_clave(p_id uuid, p_clave text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.es('jefe') or p_id = auth.uid() then perform public._error('No podés cambiar la contraseña de ese usuario (la tuya se cambia en «Mi cuenta»).'); end if;
  if length(coalesce(p_clave, '')) < 8 then perform public._error('La contraseña tiene que tener al menos 8 caracteres.'); end if;
  update auth.users set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), updated_at = now() where id = p_id;
  delete from auth.sessions where user_id = p_id;
  update public.usuarios set modificado_en = now() where id = p_id;
end $$;

-- Desactivar o reactivar (los usuarios no se borran). Al desactivar se cierran sus sesiones.
create or replace function public.estado_usuario(p_id uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.es('jefe') or p_id = auth.uid() then perform public._error('No podés cambiar el estado de ese usuario.'); end if;
  update public.usuarios set activo = p_activo where id = p_id;
  if not found then perform public._error('No existe el usuario.'); end if;
  update auth.users set banned_until = case when p_activo then null else '2999-12-31'::timestamptz end where id = p_id;
  if not p_activo then delete from auth.sessions where user_id = p_id; end if;
end $$;

-- Mi cuenta: cambiar la propia contraseña confirmando la actual
create or replace function public.cambiar_mi_clave(p_actual text, p_nueva text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if public.mi_perfil() is null then perform public._error('Tu usuario no está activo.'); end if;
  if not exists (select 1 from auth.users where id = auth.uid() and encrypted_password = extensions.crypt(coalesce(p_actual, ''), encrypted_password)) then
    raise exception 'La contraseña actual no es correcta.';
  end if;
  if length(coalesce(p_nueva, '')) < 8 then raise exception 'La contraseña nueva tiene que tener al menos 8 caracteres.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_nueva, extensions.gen_salt('bf', 10)), updated_at = now() where id = auth.uid();
  update public.usuarios set modificado_en = now() where id = auth.uid();
end $$;

-- Primera cuenta del jefe de mantenimiento: una sola vez, desde el SQL Editor (supabase/primera-cuenta.sql)
create or replace function public.primera_cuenta_jefe(p_usuario text, p_nombre text, p_clave text, p_telefono text default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.usuarios where perfil = 'jefe' and activo and not ejemplo) then
    raise exception 'Ya hay un jefe de mantenimiento activo. Los demás usuarios se crean desde la app (Usuarios).';
  end if;
  perform public._crear_usuario(p_usuario, p_nombre, 'jefe', p_clave, p_telefono, null);
  if coalesce(p_telefono, '') <> '' then
    update public.config set valor = to_jsonb(p_telefono) where clave = 'telefono_mantenimiento' and valor = '""';
  end if;
  return 'Listo. Ingresá a la app con el usuario «' || lower(btrim(p_usuario)) || '».';
end $$;


-- >>>>>>>>>> 20261114000600_registro_cambios.sql
-- =====================================================================
-- App de mantenimiento · 6 · Registro de cambios
-- Lo llenan triggers: quién, cuándo, qué cambió (valor anterior y nuevo) y quién aprobó.
-- También los ingresos y los conflictos de sincronización. Nadie lo puede editar ni borrar.
-- =====================================================================
create table if not exists public.registro_cambios (
  id           bigint generated always as identity primary key,
  ts           timestamptz not null default now(),
  usuario_id   uuid,
  nombre       text not null default 'Sistema',
  perfil       text,
  operacion    text not null check (operacion in ('alta','modificacion','baja','ingreso','conflicto')),
  tabla        text not null,
  registro     text,
  resumen      text not null,
  cambios      jsonb,
  aprobo_id    uuid,
  aprobo_nombre text
);
create index if not exists registro_ts on public.registro_cambios (ts desc);
create index if not exists registro_tabla on public.registro_cambios (tabla, registro);
create index if not exists registro_usuario on public.registro_cambios (usuario_id, ts desc);

create or replace function public.registro_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception 'El registro de cambios no se puede modificar ni borrar.' using errcode = '42501';
end $$;
drop trigger if exists inmutable on public.registro_cambios;
create trigger inmutable before update or delete on public.registro_cambios for each row execute function public.registro_inmutable();
drop trigger if exists inmutable_truncate on public.registro_cambios;
create trigger inmutable_truncate before truncate on public.registro_cambios for each statement execute function public.registro_inmutable();
revoke update, delete, truncate on public.registro_cambios from anon, authenticated, service_role;

-- Cómo se nombra cada registro
create or replace function public._etiqueta(tabla text, r jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case tabla
    when 'equipos'            then 'el equipo ' || (r->>'codigo') || ' «' || (r->>'nombre') || '»'
    when 'ordenes'            then 'la orden OT-' || lpad(r->>'numero', 4, '0') || ' «' || (r->>'titulo') || '»'
    when 'pedidos_compra'     then 'el pedido de compra PC-' || lpad(r->>'numero', 4, '0') || ' «' || (r->>'descripcion') || '»'
    when 'fichas'             then case when (r->>'es_cierre')::boolean then 'la ficha de cierre' else 'una ficha de trabajo' end || ' de la OT-'
                                   || coalesce((select lpad(numero::text, 4, '0') from public.ordenes where id = (r->>'orden_id')::uuid), '?')
    when 'costos_orden'       then 'el costo «' || (r->>'descripcion') || '» de la OT-' || coalesce((select lpad(numero::text, 4, '0') from public.ordenes where id = (r->>'orden_id')::uuid), '?')
    when 'reportes_falla'     then 'un reporte de falla en ' || coalesce((select codigo from public.equipos where id = (r->>'equipo_id')::uuid), '?')
    when 'movimientos_equipo' then case r->>'tipo' when 'prestamo' then 'el préstamo' when 'reparacion_externa' then 'la reparación externa'
                                   when 'baja' then 'la baja' else 'la reubicación' end || ' de ' || coalesce((select codigo from public.equipos where id = (r->>'equipo_id')::uuid), '?')
    when 'documentos'         then 'el documento «' || (r->>'nombre') || '» de ' || coalesce((select codigo from public.equipos where id = (r->>'equipo_id')::uuid), '?')
    when 'adjuntos'           then 'un archivo (' || (r->>'tipo') || ')'
    when 'usuarios'           then 'el usuario ' || (r->>'nombre') || ' (' || (r->>'usuario') || ')'
    when 'usuario_empresas'   then 'el acceso de ' || coalesce((select nombre from public.usuarios where id = (r->>'usuario_id')::uuid), '?')
                                   || ' a ' || coalesce((select sigla from public.empresas where id = (r->>'empresa_id')::uuid), '?')
    when 'empresas'           then 'la empresa ' || (r->>'sigla')
    when 'areas'              then 'el área «' || (r->>'nombre') || '»'
    when 'tipos_equipo'       then 'el tipo de equipo ' || (r->>'sigla') || ' «' || (r->>'nombre') || '»'
    when 'listas'             then 'la opción «' || (r->>'nombre') || '» de ' || replace(r->>'lista', '_', ' ')
    when 'proveedores'        then 'el proveedor «' || (r->>'nombre') || '»'
    when 'config'             then 'el parámetro ' || (r->>'clave')
    when 'temas'              then 'la apariencia (versión ' || (r->>'version') || ')'
    else tabla end
$$;

create or replace function public.registrar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a jsonb; b jsonb; dif jsonb := '{}'::jsonb; k text; op text; res text; apr uuid; u public.usuarios;
  ignorar text[] := array['creado_por','creado_en','modificado_por','modificado_en'];
  clave text := tg_argv[0];
begin
  -- Cargas masivas desde el SQL Editor (migración, datos de ejemplo): se anota un solo resumen aparte
  if auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' then return null; end if;
  if tg_op = 'INSERT' then
    b := to_jsonb(new) - ignorar; op := 'alta'; dif := b;
    res := case tg_table_name when 'reportes_falla' then 'Envió ' when 'fichas' then 'Cargó ' when 'costos_orden' then 'Cargó '
             when 'adjuntos' then 'Adjuntó ' when 'usuario_empresas' then 'Dio ' when 'temas' then 'Guardó '
             when 'movimientos_equipo' then 'Registró ' when 'pedidos_compra' then 'Pidió ' else 'Dio de alta ' end
           || public._etiqueta(tg_table_name, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    a := to_jsonb(old) - ignorar; b := to_jsonb(new) - ignorar;
    for k in select key from jsonb_each(b) loop
      if (a -> k) is distinct from (b -> k) then dif := dif || jsonb_build_object(k, jsonb_build_array(a -> k, b -> k)); end if;
    end loop;
    if tg_table_name = 'temas' and not (b->>'activo')::boolean then return null; end if;  -- la versión que se deja de usar
    if dif = '{}'::jsonb then
      if tg_table_name = 'usuarios' then op := 'modificacion'; dif := null; res := 'Cambió la contraseña de ' || public._etiqueta(tg_table_name, b);
      else return null; end if;
    else
      op := 'modificacion';
      res := case
        when tg_table_name = 'usuarios' and dif ? 'activo' then case when (b->>'activo')::boolean then 'Activó ' else 'Desactivó ' end
        when tg_table_name = 'equipos' and dif ? 'estado' and b->>'estado' = 'baja' then 'Dio de baja '
        when tg_table_name = 'equipos' and (dif ? 'empresa_ubicacion_id' or dif ? 'area_id' or dif ? 'ubicacion') then 'Movió '
        when tg_table_name = 'equipos' and dif ? 'estado' then 'Cambió a «' || replace(b->>'estado', '_', ' ') || '» '
        when tg_table_name = 'ordenes' and dif ? 'prioridad' then 'Fijó la prioridad «' || (b->>'prioridad') || '» de '
        when tg_table_name = 'ordenes' and dif ? 'estado' then 'Pasó a «' || replace(b->>'estado', '_', ' ') || '» '
        when tg_table_name = 'pedidos_compra' and dif ? 'estado' then case b->>'estado' when 'aprobado' then 'Aprobó ' when 'rechazado' then 'Rechazó '
                                                                     when 'recibido' then 'Recibió ' else 'Modificó ' end
        when tg_table_name = 'movimientos_equipo' and dif ? 'estado' then case b->>'estado' when 'aprobado' then 'Aprobó ' when 'rechazado' then 'Rechazó '
                                                                     when 'en_curso' then 'Registró la salida en ' when 'cerrado' then 'Cerró ' else 'Modificó ' end
        when tg_table_name = 'reportes_falla' and dif ? 'estado' then case b->>'estado' when 'descartado' then 'Descartó ' else 'Pasó a orden ' end
        when tg_table_name = 'temas' and dif ? 'activo' and (b->>'activo')::boolean then 'Aplicó '
        else 'Modificó ' end
        || public._etiqueta(tg_table_name, to_jsonb(new));
    end if;
  else
    a := to_jsonb(old) - ignorar; op := 'baja'; dif := a;
    res := 'Quitó ' || public._etiqueta(tg_table_name, to_jsonb(old));
  end if;
  apr := nullif(current_setting('planta.aprobo_id', true), '')::uuid;
  select * into u from public.usuarios where id = auth.uid();
  insert into public.registro_cambios (usuario_id, nombre, perfil, operacion, tabla, registro, resumen, cambios, aprobo_id, aprobo_nombre)
  values (auth.uid(), coalesce(u.nombre, case when auth.uid() is null then 'Sistema' else 'Usuario sin perfil' end), u.perfil, op,
          tg_table_name, coalesce(b, a) ->> clave, res, dif, apr, public._nombre(apr));
  return null;
end $$;

do $$
declare t record;
begin
  for t in select * from (values
    ('empresas','id'), ('usuarios','id'), ('usuario_empresas','usuario_id'), ('areas','id'), ('tipos_equipo','sigla'),
    ('listas','clave'), ('config','clave'), ('temas','version'), ('proveedores','id'), ('equipos','codigo'), ('documentos','id'),
    ('movimientos_equipo','id'), ('reportes_falla','id'), ('ordenes','id'), ('fichas','id'), ('costos_orden','id'),
    ('pedidos_compra','id'), ('adjuntos','id')) as x(tabla, clave)
  loop
    execute format('drop trigger if exists z_registrar on public.%I', t.tabla);
    execute format('create trigger z_registrar after insert or update or delete on public.%I for each row execute function public.registrar(%L)', t.tabla, t.clave);
  end loop;
end $$;

-- Ingresos: cada inicio de sesión crea una fila en auth.sessions (no depende de la app)
create or replace function public.registrar_ingreso() returns trigger
language plpgsql security definer set search_path = public as $$
declare u public.usuarios;
begin
  select * into u from public.usuarios where id = new.user_id;
  insert into public.registro_cambios (usuario_id, nombre, perfil, operacion, tabla, registro, resumen)
  values (new.user_id, coalesce(u.nombre, 'Usuario sin perfil'), u.perfil, 'ingreso', 'sesion', new.user_id::text, 'Ingresó a la app');
  return null;
exception when others then
  return null;  -- un problema al anotar nunca impide el ingreso
end $$;
do $$ begin
  execute 'drop trigger if exists planta_ingreso on auth.sessions';
  execute 'create trigger planta_ingreso after insert on auth.sessions for each row execute function public.registrar_ingreso()';
exception when insufficient_privilege then
  raise notice 'AVISO: no se pudo crear el registro de ingresos en auth.sessions (permiso). El resto funciona igual.';
end $$;

-- Conflictos de sincronización (cargas sin señal): la app los informa y quedan registrados
create or replace function public.registrar_conflicto(p_tabla text, p_registro text, p_detalle jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u public.usuarios;
begin
  select * into u from public.usuarios where id = auth.uid() and activo;
  if u.id is null then perform public._error('Usuario no activo.'); end if;
  insert into public.registro_cambios (usuario_id, nombre, perfil, operacion, tabla, registro, resumen, cambios)
  values (u.id, u.nombre, u.perfil, 'conflicto', left(p_tabla, 40), left(p_registro, 80),
          'Conflicto al sincronizar ' || replace(left(p_tabla, 40), '_', ' ') || ': se guardó la última modificación', p_detalle);
end $$;


-- >>>>>>>>>> 20261114000700_permisos.sql
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
-- El encargado también las ve: las necesita para asignar órdenes a quien tiene acceso al equipo
select public._politica('ver', 'usuario_empresas', 'select', 'public.es(''jefe'',''encargado'') or usuario_id = auth.uid()');

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



-- >>>>>>>>>> 20261114000800_apariencia.sql
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
  "marca": { "nombre": "W-Main", "logo_url": null, "icono_192": null, "icono_512": null, "fondo_carga": "#0B2A4A" },
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
  "vocabulario": { "jefe": "Gerente de mantenimiento" },
  "etiqueta": { "tamano": "70x40", "campos": ["codigo", "nombre", "empresa", "area", "telefono"], "logo": true, "hoja": "a4" },
  "informes": { "secciones": ["realizados", "parada", "externas", "gasto", "preventivos", "mtbf"], "destinatarios": [], "dia": "lunes", "hora": "08:00" },
  "oficina": { "tarjetas": ["parados", "ordenes", "reportes"], "empresas": [], "rotacion_seg": 20, "tamano_texto": "grande" }
}$json$::jsonb, true, true, 'Tema de fábrica: siempre disponible'
where not exists (select 1 from public.temas where de_fabrica);


-- >>>>>>>>>> 20261114000900_migrar_w_main.sql
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


-- >>>>>>>>>> 20261114001000_avisos.sql
-- =====================================================================
-- App de mantenimiento · 10 · Avisos (notificaciones push)
-- Cada aviso se guarda en la tabla «avisos» (también se ven dentro de la app, en la campanita) y la
-- función de Supabase «avisos» los manda como notificación push a los celulares del destinatario.
-- La tabla tiene la columna «canales» para sumar WhatsApp más adelante sin cambiar la estructura.
--
-- Qué avisa y a quién (solo a quien tiene acceso a la empresa del equipo):
--   · Máquina parada (reporte con parada) → jefe, encargados y técnicos
--   · Reporte de falla nuevo (sin parada)  → jefe y encargados
--   · Orden asignada                       → el técnico asignado
--   · Pedido de compra por aprobar         → dirección; aprobado o rechazado → quien lo pidió
--   · Préstamo por aprobar                 → dirección; aprobado o rechazado → quien lo pidió
--   · Orden vencida (todos los días)       → el asignado y los encargados
--   · Resumen del día (todos los días)     → jefe y dirección
-- =====================================================================

-- ---------- Avisos ----------
create table if not exists public.avisos (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.usuarios(id),
  tipo        text not null,
  titulo      text not null,
  cuerpo      text,
  url         text,
  canales     text[] not null default '{push}',
  creado_en   timestamptz not null default now(),
  leido_en    timestamptz,
  enviado_en  timestamptz,
  tomado_en   timestamptz,
  intentos    int not null default 0,
  error       text
);
create index if not exists avisos_usuario on public.avisos (usuario_id, id desc);
create index if not exists avisos_pendientes on public.avisos (id) where enviado_en is null;
alter table public.avisos enable row level security;
select public._politica('ver', 'avisos', 'select', 'usuario_id = auth.uid()');

-- ---------- Celulares suscriptos a las notificaciones push ----------
create table if not exists public.push_suscripciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  agente      text,
  creado_en   timestamptz not null default now(),
  ultimo_envio timestamptz,
  fallos      int not null default 0
);
alter table public.push_suscripciones enable row level security;
select public._politica('ver', 'push_suscripciones', 'select', 'usuario_id = auth.uid()');

-- Datos para llamar a la función de envío desde la base (los completa supabase/avisos-activar.sql).
-- Sin políticas: nadie lo lee desde la app.
create table if not exists public.servidor (
  clave text primary key,
  valor text not null
);
alter table public.servidor enable row level security;

-- Suscribir este celular (si ya estaba a nombre de otro usuario, pasa al actual)
create or replace function public.suscribir_push(p_endpoint text, p_p256dh text, p_auth text, p_agente text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.activo() then perform public._error('Usuario no activo.'); end if;
  if coalesce(p_endpoint, '') !~ '^https://' then perform public._error('Suscripción inválida.'); end if;
  delete from public.push_suscripciones where endpoint = p_endpoint;
  insert into public.push_suscripciones (usuario_id, endpoint, p256dh, auth, agente) values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_agente, 200));
end $$;
create or replace function public.desuscribir_push(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_suscripciones where endpoint = p_endpoint and usuario_id = auth.uid();
$$;
create or replace function public.marcar_avisos_leidos(p_hasta bigint default null) returns void
language sql security definer set search_path = public as $$
  update public.avisos set leido_en = now() where usuario_id = auth.uid() and leido_en is null and (p_hasta is null or id <= p_hasta);
$$;

-- ---------- Destinatarios ----------
-- Usuarios activos con alguno de esos perfiles y acceso a alguna de esas empresas (el jefe accede a todas)
create or replace function public._destinatarios(p_perfiles text[], p_empresas uuid[], p_salvo uuid default null) returns setof uuid
language sql stable security definer set search_path = public as $$
  select u.id from public.usuarios u
  where u.activo and u.perfil = any(p_perfiles) and u.id is distinct from p_salvo
    and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id = any(p_empresas)))
$$;
create or replace function public._avisar(p_usuarios uuid[], p_tipo text, p_titulo text, p_cuerpo text, p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_usuarios is null or cardinality(p_usuarios) = 0 then return; end if;
  insert into public.avisos (usuario_id, tipo, titulo, cuerpo, url)
  select distinct u, p_tipo, left(p_titulo, 120), left(p_cuerpo, 400), p_url from unnest(p_usuarios) u where u is not null;
end $$;
-- Las cargas masivas (migración de W-Main, datos de ejemplo) no avisan
create or replace function public._sin_avisos() returns boolean
language sql stable as $$ select auth.uid() is null and current_setting('planta.carga_masiva', true) = '1' $$;
create or replace function public._empresas_eq(eq uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array[empresa_duena_id, empresa_ubicacion_id] from public.equipos where id = eq
$$;
create or replace function public._ot(n int) returns text language sql immutable as $$ select 'OT-' || lpad(n::text, 4, '0') $$;

-- ---------- Disparadores ----------
create or replace function public.avisar_reporte() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.equipos; falla text;
begin
  if public._sin_avisos() then return null; end if;
  select * into e from public.equipos where id = new.equipo_id;
  select nombre into falla from public.listas where lista = 'tipo_falla' and clave = new.tipo_falla;
  perform public._avisar(array(select public._destinatarios(
      case when new.parada then array['jefe','encargado','tecnico'] else array['jefe','encargado'] end, array[e.empresa_duena_id, e.empresa_ubicacion_id], new.operario_id)),
    case when new.parada then 'maquina_parada' else 'reporte_nuevo' end,
    case when new.parada then 'Máquina parada: ' || e.codigo else 'Reporte de falla: ' || e.codigo end,
    coalesce(falla, new.tipo_falla) || ' · ' || e.nombre || coalesce(' · ' || public._nombre(new.operario_id), '') || coalesce(' — «' || left(new.texto, 120) || '»', ''),
    '/reportes');
  return null;
end $$;
drop trigger if exists d_avisar on public.reportes_falla;
create trigger d_avisar after insert on public.reportes_falla for each row execute function public.avisar_reporte();

create or replace function public.avisar_orden() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.equipos;
begin
  if public._sin_avisos() or new.asignado_a is null or new.asignado_a = auth.uid() then return null; end if;
  if tg_op = 'UPDATE' and new.asignado_a is not distinct from old.asignado_a then return null; end if;
  select * into e from public.equipos where id = new.equipo_id;
  perform public._avisar(array[new.asignado_a], 'orden_asignada', 'Te asignaron la ' || public._ot(new.numero) || ' (' || new.prioridad || ')',
    new.titulo || ' · ' || e.codigo || ' ' || e.nombre || case when new.parada then ' · máquina parada' else '' end, '/ordenes/' || new.id);
  return null;
end $$;
drop trigger if exists d_avisar on public.ordenes;
create trigger d_avisar after insert or update of asignado_a on public.ordenes for each row execute function public.avisar_orden();

create or replace function public.avisar_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public._sin_avisos() then return null; end if;
  if tg_op = 'INSERT' and new.estado = 'pendiente' then
    perform public._avisar(array(select public._destinatarios(array['direccion'], array[new.empresa_id], new.creado_por)), 'compra_pendiente',
      'Compra por aprobar: PC-' || lpad(new.numero::text, 4, '0'),
      new.descripcion || coalesce(' · $ ' || to_char(new.monto_estimado, 'FM999G999G999D00'), '') || coalesce(' · pidió ' || public._nombre(new.creado_por), ''), '/compras');
  elsif tg_op = 'UPDATE' and new.estado in ('aprobado','rechazado') and old.estado = 'pendiente' and new.creado_por is distinct from auth.uid() then
    perform public._avisar(array[new.creado_por], 'compra_resuelta',
      case when new.estado = 'aprobado' then 'Compra aprobada: ' else 'Compra rechazada: ' end || 'PC-' || lpad(new.numero::text, 4, '0'),
      new.descripcion || coalesce(' — ' || new.respuesta, ''), '/compras');
  end if;
  return null;
end $$;
drop trigger if exists d_avisar on public.pedidos_compra;
create trigger d_avisar after insert or update of estado on public.pedidos_compra for each row execute function public.avisar_pedido();

create or replace function public.avisar_movimiento() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.equipos; destino text;
begin
  if public._sin_avisos() or new.tipo <> 'prestamo' then return null; end if;
  select * into e from public.equipos where id = new.equipo_id;
  select nombre into destino from public.empresas where id = new.empresa_destino_id;
  if tg_op = 'INSERT' and new.estado = 'solicitado' then
    perform public._avisar(array(select public._destinatarios(array['direccion'], array[e.empresa_duena_id, new.empresa_destino_id], new.creado_por)), 'prestamo_pendiente',
      'Préstamo por aprobar: ' || e.codigo, e.nombre || ' → ' || coalesce(destino, '') || coalesce(' · ' || new.motivo, ''), '/movimientos');
  elsif tg_op = 'UPDATE' and new.estado in ('aprobado','rechazado') and old.estado = 'solicitado' and new.creado_por is distinct from auth.uid() then
    perform public._avisar(array[new.creado_por], 'prestamo_resuelto',
      case when new.estado = 'aprobado' then 'Préstamo aprobado: ' else 'Préstamo rechazado: ' end || e.codigo, coalesce(destino, '') || coalesce(' — ' || new.respuesta, ''), '/movimientos');
  end if;
  return null;
end $$;
drop trigger if exists d_avisar on public.movimientos_equipo;
create trigger d_avisar after insert or update of estado on public.movimientos_equipo for each row execute function public.avisar_movimiento();

-- ---------- Avisos diarios: órdenes vencidas y resumen del día ----------
create or replace function public.avisos_diarios() returns int
language plpgsql security definer set search_path = public as $$
declare o record; n int := 0; u record; hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  abiertas int; paradas int; reportes int; compras int; prestamos int; vencidas int;
begin
  -- Órdenes vencidas (una vez por día cada una)
  for o in select x.*, e.codigo, e.empresa_duena_id, e.empresa_ubicacion_id from public.ordenes x join public.equipos e on e.id = x.equipo_id
           where x.vence < hoy and x.estado in ('abierta','asignada','esperando_repuesto','en_curso') loop
    perform public._avisar(array(select public._destinatarios(array['encargado'], array[o.empresa_duena_id, o.empresa_ubicacion_id])) || o.asignado_a,
      'orden_vencida', 'Orden vencida: ' || public._ot(o.numero), o.titulo || ' · ' || o.codigo || ' · venció el ' || to_char(o.vence, 'DD/MM/YYYY'), '/ordenes/' || o.id);
    n := n + 1;
  end loop;
  -- Resumen del día, con lo de las empresas de cada uno
  for u in select id, perfil from public.usuarios where activo and perfil in ('jefe','direccion') loop
    select count(*) filter (where x.estado in ('abierta','asignada','esperando_repuesto','en_curso')),
           count(*) filter (where x.estado in ('abierta','asignada','esperando_repuesto','en_curso') and x.vence < hoy)
      into abiertas, vencidas
      from public.ordenes x join public.equipos e on e.id = x.equipo_id
      where u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id));
    select count(*) into paradas from public.equipos e where e.estado in ('detenido','en_reparacion')
      and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)));
    select count(*) into reportes from public.reportes_falla r join public.equipos e on e.id = r.equipo_id where r.estado = 'nuevo'
      and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)));
    select count(*) into compras from public.pedidos_compra p where p.estado = 'pendiente'
      and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id = p.empresa_id));
    select count(*) into prestamos from public.movimientos_equipo m where m.estado = 'solicitado';
    perform public._avisar(array[u.id], 'resumen_diario', 'Resumen del día · ' || to_char(hoy, 'DD/MM'),
      abiertas || ' órdenes pendientes' || case when vencidas > 0 then ' (' || vencidas || ' vencidas)' else '' end
      || ' · ' || paradas || ' máquinas paradas · ' || reportes || ' reportes sin atender · ' || compras || ' compras' || case when u.perfil = 'direccion' then ' y ' || prestamos || ' préstamos' else '' end || ' por aprobar',
      '/');
  end loop;
  return n;
end $$;

-- ---------- Envío: la base llama a la función «avisos» apenas hay algo para mandar ----------
-- (si pg_net no está o no se configuró la dirección, los avisos quedan en la app y se mandan con el reintento)
create or replace function public._llamar_envio() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_clave text;
begin
  select s.valor into v_url from public.servidor s where s.clave = 'url_funcion_avisos';
  select s.valor into v_clave from public.servidor s where s.clave = 'clave_publica';
  if v_url is null or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') then return; end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer '' || $2, ''apikey'', $2), timeout_milliseconds := 10000)'
    using v_url, coalesce(v_clave, '');
exception when others then
  raise warning 'No se pudo llamar a la función de avisos: %', sqlerrm;   -- nunca frena la carga
end $$;
create or replace function public.avisos_enviar() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public._llamar_envio(); return null; end $$;
drop trigger if exists z_enviar on public.avisos;
create trigger z_enviar after insert on public.avisos for each statement execute function public.avisos_enviar();
-- Reintento: si quedó algo sin mandar (por ejemplo, la función estaba caída)
create or replace function public.reenviar_avisos() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.avisos where enviado_en is null and intentos < 5 and creado_en > now() - interval '2 days') then
    perform public._llamar_envio();
  end if;
end $$;

-- La función de envío toma los avisos de a tandas (sin mandar dos veces lo mismo si corre dos veces)
create or replace function public.tomar_avisos(p_cantidad int default 100) returns setof public.avisos
language sql security definer set search_path = public as $$
  update public.avisos set tomado_en = now(), intentos = intentos + 1
  where id in (select id from public.avisos
               where enviado_en is null and intentos < 5 and creado_en > now() - interval '2 days'
                 and (tomado_en is null or tomado_en < now() - interval '2 minutes')
               order by id limit p_cantidad for update skip locked)
  returning *;
$$;
create or replace function public.resultado_aviso(p_id bigint, p_enviado boolean, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.avisos set enviado_en = case when p_enviado then now() end, error = p_error, tomado_en = null where id = p_id;
$$;

-- ---------- Tareas programadas (pg_cron): avisos diarios a las 8 (hora argentina) y reintentos ----------
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron no disponible: los avisos diarios se activan con supabase/avisos-activar.sql'; end;
  begin create extension if not exists pg_net; exception when others then raise notice 'pg_net no disponible'; end;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'cron' and p.proname = 'schedule') then
    perform cron.schedule('avisos-diarios', '0 11 * * *', 'select public.avisos_diarios()');   -- 11 UTC = 8 de Argentina
    perform cron.schedule('avisos-reintento', '*/5 * * * *', 'select public.reenviar_avisos()');
  end if;
exception when others then raise notice 'No se pudieron programar los avisos: %', sqlerrm;
end $$;

-- Tiempo real: la campanita de la app se actualiza sola
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.avisos; exception when duplicate_object then null; end;
  end if;
end $$;


-- >>>>>>>>>> 20261114001100_datos_ejemplo.sql
-- =====================================================================
-- App de mantenimiento · 11 · Datos de ejemplo (se cargan y se borran desde el SQL Editor de Supabase)
--   Cargar:  select public.cargar_datos_ejemplo('una-clave-para-los-usuarios-de-ejemplo');
--   Borrar:  select public.borrar_datos_ejemplo();
-- Todo lo de ejemplo queda marcado (columna «ejemplo») y los usuarios empiezan con «ej.».
-- Desde la app no se pueden llamar.
-- =====================================================================

create or replace function public.cargar_datos_ejemplo(p_clave text) returns text
language plpgsql security definer set search_path = public as $$
declare
  emp jsonb := (select jsonb_object_agg(sigla, id) from public.empresas);
  ar jsonb := (select jsonb_object_agg(nombre, id) from public.areas);
  u jsonb := '{}'; eq jsonb := '{}'; pr jsonb := '{}';
  r record; v uuid; o uuid; rep uuid; ped uuid; f uuid;
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  agente text := (select c->'opciones'->>0 from public.tipos_equipo t, jsonb_array_elements(t.campos) c where t.sigla = 'MAT' and c->>'clave' = 'agente');
begin
  if auth.uid() is not null then perform public._error('Los datos de ejemplo se cargan desde el SQL Editor de Supabase.'); end if;
  if exists (select 1 from public.equipos where ejemplo) or exists (select 1 from public.usuarios where ejemplo) then
    perform public._error('Los datos de ejemplo ya están cargados. Para cargarlos de nuevo, primero: select public.borrar_datos_ejemplo();');
  end if;
  if length(coalesce(p_clave, '')) < 8 then perform public._error('Elegí una clave de al menos 8 caracteres para los usuarios de ejemplo.'); end if;
  if emp->>'INY' is null or emp->>'LIM' is null or emp->>'PIN' is null or emp->>'SAL' is null then
    perform public._error('Faltan las empresas INY, LIM, PIN o SAL (los datos de ejemplo las usan).');
  end if;
  perform set_config('planta.carga_masiva', '1', true);   -- sin avisos ni registro de cada fila

  -- Usuarios (ingresan con la clave elegida)
  for r in select * from (values
      ('ej.encargado', 'Marta Gil (ejemplo)', 'encargado', array['INY','LIM']),
      ('ej.tecnico1', 'Diego Ríos (ejemplo)', 'tecnico', array['INY','LIM']),
      ('ej.tecnico2', 'Lucas Paz (ejemplo)', 'tecnico', array['PIN','SAL']),
      ('ej.operario1', 'Juan Gómez (ejemplo)', 'operario', array['INY']),
      ('ej.operario2', 'Rosa Benítez (ejemplo)', 'operario', array['SAL']),
      ('ej.direccion', 'Roberto Alonso (ejemplo)', 'direccion', array['INY','LIM','PIN','SAL'])) x(usuario, nombre, perfil, empresas) loop
    v := public._crear_usuario(r.usuario, r.nombre, r.perfil, p_clave, null, array(select (emp->>s)::uuid from unnest(r.empresas) s), true);
    u := u || jsonb_build_object(r.usuario, v);
  end loop;

  -- Proveedores y talleres
  for r in select * from (values ('bob', 'Bobinados Sur (ejemplo)', 'Motores eléctricos', '11 4555-1200'), ('hid', 'Hidráulica Norte (ejemplo)', 'Hidráulica y autoelevadores', '11 4777-3300'),
                                 ('fri', 'Frío Industrial SRL (ejemplo)', 'Refrigeración', '11 4321-8800'), ('ele', 'Electro Ramos (ejemplo)', 'Electricidad y tableros', '11 4612-0909')) x(k, nombre, rubro, tel) loop
    insert into public.proveedores (nombre, rubro, telefono, ejemplo) values (r.nombre, r.rubro, r.tel, true) returning id into v;
    pr := pr || jsonb_build_object(r.k, v);
  end loop;

  -- Equipos de las cuatro empresas (el código lo genera la base)
  for r in select * from (values
      ('iny1', 'INY', 'INY', 'Inyectora 280 t', 'Haitian', 'MA2800', 'alta', 'Producción', 'Nave 1, línea 1', '{"fuerza_cierre": 280}', 18450.0),
      ('iny2', 'INY', 'INY', 'Inyectora 450 t', 'Engel', 'Victory 450', 'alta', 'Producción', 'Nave 1, línea 2', '{"fuerza_cierre": 450}', 22310.0),
      ('sop1', 'INY', 'SOP', 'Sopladora PET 4 cavidades', 'Sidel', 'SBO 4', 'media', 'Producción', 'Nave 2', '{}', null),
      ('com1', 'INY', 'COM', 'Compresor a tornillo 30 HP', 'Atlas Copco', 'GA22', 'alta', 'Servicios', 'Sala de compresores', '{"presion": 8}', 31020.0),
      ('chi1', 'INY', 'CHI', 'Chiller 40 TR', 'Frigel', 'RSY 40', 'media', 'Servicios', 'Techo nave 1', '{}', null),
      ('mat1', 'INY', 'MAT', 'Matafuego ABC 10 kg (nave 1)', 'Georgia', null, 'baja', 'Producción', 'Columna 4', null, null),
      ('mez1', 'LIM', 'MEZ', 'Mezclador 2000 l', 'Inoxpa', null, 'alta', 'Producción', 'Sala de mezclas', '{}', null),
      ('env1', 'LIM', 'ENV', 'Envasadora lineal 4 picos', 'Tecnopack', 'EL-4', 'alta', 'Producción', 'Línea de envasado', '{}', null),
      ('apl1', 'LIM', 'APL', 'Apilador eléctrico 1,5 t', 'Toyota', 'SPE15', 'media', 'Depósito / logística', 'Depósito de producto terminado', '{"capacidad": 1500}', null),
      ('bom1', 'LIM', 'BOM', 'Bomba centrífuga 5 HP', 'Grundfos', 'CR 10', 'media', 'Producción', 'Sala de mezclas', '{}', null),
      ('dis1', 'PIN', 'MEZ', 'Dispersora 30 HP', 'Netzsch', null, 'alta', 'Producción', 'Planta de base agua', '{}', 9870.0),
      ('mol1', 'PIN', 'MEZ', 'Molino de perlas 50 l', 'Netzsch', 'LME 50', 'alta', 'Producción', 'Planta de base solvente', '{}', null),
      ('lat1', 'PIN', 'ENV', 'Envasadora de latas', 'Fillpack', null, 'media', 'Producción', 'Envasado', '{}', null),
      ('aut1', 'PIN', 'AUT', 'Autoelevador 2,5 t', 'Yale', 'GLP25', 'media', 'Depósito / logística', 'Depósito de materias primas', '{"capacidad": 2500}', 6120.0),
      ('tab1', 'PIN', 'TAB', 'Tablero general de baja tensión', 'Schneider', null, 'alta', 'Servicios', 'Sala de tableros', '{}', null),
      ('cal1', 'SAL', 'CAL', 'Caldera humotubular 2 t/h', 'Fontanet', null, 'alta', 'Servicios', 'Sala de calderas', '{}', 15400.0),
      ('mar1', 'SAL', 'MEZ', 'Marmita con agitador 1000 l', 'Inoxpa', null, 'alta', 'Producción', 'Cocina', '{}', null),
      ('doy1', 'SAL', 'ENV', 'Envasadora de doypack', 'Volpak', 'SI-280', 'alta', 'Producción', 'Envasado', '{}', null),
      ('cam1', 'SAL', 'CHI', 'Cámara de frío de producto terminado', 'Frío Industrial', null, 'media', 'Depósito / logística', 'Expedición', '{}', null),
      ('lob1', 'SAL', 'BOM', 'Bomba lobular', 'Alfa Laval', 'SRU 2', 'media', 'Producción', 'Cocina', '{}', null)
    ) x(k, e, tipo, nombre, marca, modelo, crit, area, lugar, campos, horas) loop
    insert into public.equipos (empresa_duena_id, tipo, nombre, marca, modelo, criticidad, area_id, ubicacion, campos, horometro, horometro_fecha, ejemplo, codigo, numero, creado_en)
    values ((emp->>r.e)::uuid, r.tipo, r.nombre, r.marca, r.modelo, r.crit, (ar->>r.area)::uuid, r.lugar,
            coalesce(r.campos::jsonb, jsonb_build_object('vencimiento', to_char(hoy + 20, 'YYYY-MM-DD'), 'agente', agente)),
            r.horas, case when r.horas is not null then hoy - 3 end, true, '', null, now() - interval '60 days')
    returning id into v;
    eq := eq || jsonb_build_object(r.k, v);
  end loop;

  -- 1. Máquina parada sin atender (SAL): reporte de la operaria
  insert into public.reportes_falla (equipo_id, tipo_falla, parada, texto, operario_id, hecho_en, ejemplo, creado_por, creado_en)
  values ((eq->>'doy1')::uuid, 'no_arranca', true, 'Se detuvo en medio del lote y no vuelve a arrancar', (u->>'ej.operario2')::uuid, now() - interval '25 minutes', true, (u->>'ej.operario2')::uuid, now() - interval '25 minutes');
  -- 2. Reporte sin parada (INY)
  insert into public.reportes_falla (equipo_id, tipo_falla, parada, texto, operario_id, hecho_en, ejemplo, creado_por, creado_en)
  values ((eq->>'com1')::uuid, 'ruido', false, 'Ruido metálico al arrancar', (u->>'ej.operario1')::uuid, now() - interval '2 hours', true, (u->>'ej.operario1')::uuid, now() - interval '2 hours');

  -- 3. Orden urgente en curso, desde un reporte con la máquina parada (INY)
  insert into public.reportes_falla (equipo_id, tipo_falla, parada, texto, operario_id, hecho_en, ejemplo, creado_por, creado_en)
  values ((eq->>'iny2')::uuid, 'perdida_aceite', true, 'Pierde aceite por el cilindro de cierre', (u->>'ej.operario1')::uuid, now() - interval '5 hours', true, (u->>'ej.operario1')::uuid, now() - interval '5 hours')
  returning id into rep;
  insert into public.ordenes (equipo_id, reporte_id, titulo, descripcion, estado, parada, asignado_a, ejemplo, creado_por, creado_en)
  values ((eq->>'iny2')::uuid, rep, 'Pérdida de aceite en el cilindro de cierre', 'Revisar sellos del cilindro y nivel del tanque', 'en_curso', true, (u->>'ej.tecnico1')::uuid, true, (u->>'ej.encargado')::uuid, now() - interval '4 hours 40 minutes')
  returning id into o;
  insert into public.fichas (orden_id, tecnico_id, trabajo, horas, horas_parada, ejemplo, creado_por, hecho_en, creado_en)
  values (o, (u->>'ej.tecnico1')::uuid, 'Desarme de la tapa del cilindro: sello principal cortado. Se pide el kit de sellos al pañol.', 1.5, 1.5, true, (u->>'ej.tecnico1')::uuid, now() - interval '3 hours', now() - interval '3 hours');

  -- 4. Orden esperando repuesto, con compra por aprobar (PIN)
  insert into public.ordenes (equipo_id, titulo, descripcion, tipo, estado, asignado_a, vence, ejemplo, creado_por, creado_en)
  values ((eq->>'dis1')::uuid, 'Vibración en el eje de la dispersora', 'Rodamiento inferior con juego', 'correctiva', 'esperando_repuesto', (u->>'ej.tecnico2')::uuid, hoy + 5, true, (u->>'ej.tecnico2')::uuid, now() - interval '2 days')
  returning id into o;
  insert into public.fichas (orden_id, tecnico_id, trabajo, horas, ejemplo, creado_por, hecho_en, creado_en)
  values (o, (u->>'ej.tecnico2')::uuid, 'Diagnóstico: rodamiento 6312 2RS con juego. Hay que cambiarlo.', 2, true, (u->>'ej.tecnico2')::uuid, now() - interval '2 days', now() - interval '2 days');
  insert into public.pedidos_compra (orden_id, equipo_id, empresa_id, descripcion, cantidad, monto_estimado, proveedor_id, estado, ejemplo, creado_por, creado_en)
  values (o, (eq->>'dis1')::uuid, (emp->>'PIN')::uuid, 'Rodamiento 6312 2RS + retén', 2, 180000, (pr->>'ele')::uuid, 'pendiente', true, (u->>'ej.tecnico2')::uuid, now() - interval '2 days');

  -- 5. Preventivo asignado que vence pronto (LIM) y 6. una orden vencida (SAL)
  insert into public.ordenes (equipo_id, titulo, tipo, estado, asignado_a, vence, ejemplo, creado_por, creado_en)
  values ((eq->>'mez1')::uuid, 'Cambio de aceite del reductor del agitador', 'preventiva', 'asignada', (u->>'ej.tecnico1')::uuid, hoy + 3, true, (u->>'ej.encargado')::uuid, now() - interval '6 days'),
         ((eq->>'cal1')::uuid, 'Revisión del quemador y limpieza de tubos', 'preventiva', 'asignada', (u->>'ej.tecnico2')::uuid, hoy - 2, true, (u->>'ej.encargado')::uuid, now() - interval '12 days');

  -- 7. Orden terminada, falta cerrarla (LIM)
  insert into public.ordenes (equipo_id, titulo, estado, asignado_a, terminada_en, ejemplo, creado_por, creado_en)
  values ((eq->>'bom1')::uuid, 'Pérdida por el sello mecánico', 'terminada', (u->>'ej.tecnico1')::uuid, now() - interval '1 day', true, (u->>'ej.encargado')::uuid, now() - interval '2 days')
  returning id into o;
  insert into public.fichas (orden_id, tecnico_id, es_cierre, trabajo, horas, horas_parada, causa, ejemplo, creado_por, hecho_en, creado_en)
  values (o, (u->>'ej.tecnico1')::uuid, true, 'Cambio de sello mecánico y prueba con agua', 2.5, 3, 'desgaste', true, (u->>'ej.tecnico1')::uuid, now() - interval '1 day', now() - interval '1 day');
  insert into public.costos_orden (orden_id, tipo, descripcion, cantidad, costo_unitario, ejemplo, creado_por)
  values (o, 'repuesto', 'Sello mecánico 25 mm', 1, 64000, true, (u->>'ej.tecnico1')::uuid);

  -- 8. Historia cerrada completa en un equipo crítico (INY): reporte, fichas, compra recibida y verificación de producción
  insert into public.reportes_falla (equipo_id, tipo_falla, parada, texto, operario_id, hecho_en, ejemplo, creado_por, creado_en)
  values ((eq->>'iny1')::uuid, 'temperatura', true, 'Alarma de temperatura del aceite hidráulico', (u->>'ej.operario1')::uuid, now() - interval '12 days', true, (u->>'ej.operario1')::uuid, now() - interval '12 days')
  returning id into rep;
  insert into public.ordenes (equipo_id, reporte_id, titulo, estado, parada, asignado_a, terminada_en, cerrada_en, prioridad_por, prioridad_en, ejemplo, creado_por, creado_en)
  values ((eq->>'iny1')::uuid, rep, 'Temperatura alta del aceite hidráulico', 'cerrada', true, (u->>'ej.tecnico1')::uuid, now() - interval '10 days', now() - interval '9 days',
          (u->>'ej.direccion')::uuid, now() - interval '12 days', true, (u->>'ej.encargado')::uuid, now() - interval '12 days')
  returning id into o;
  insert into public.fichas (orden_id, tecnico_id, trabajo, horas, horas_parada, ejemplo, creado_por, hecho_en, creado_en)
  values (o, (u->>'ej.tecnico1')::uuid, 'Intercambiador de calor tapado. Se pide el kit de limpieza.', 1, 2, true, (u->>'ej.tecnico1')::uuid, now() - interval '12 days', now() - interval '12 days');
  insert into public.pedidos_compra (orden_id, equipo_id, empresa_id, descripcion, cantidad, monto_estimado, estado, resuelto_por, resuelto_en, respuesta, ejemplo, creado_por, creado_en)
  values (o, (eq->>'iny1')::uuid, (emp->>'INY')::uuid, 'Kit de limpieza química para intercambiador', 1, 95000, 'recibido', (u->>'ej.direccion')::uuid, now() - interval '11 days', 'Ok, urgente', true, (u->>'ej.tecnico1')::uuid, now() - interval '12 days');
  insert into public.fichas (orden_id, tecnico_id, es_cierre, trabajo, horas, horas_parada, causa, supervisor_nombre, ejemplo, creado_por, hecho_en, creado_en)
  values (o, (u->>'ej.tecnico1')::uuid, true, 'Limpieza química del intercambiador y cambio de filtro de retorno. Temperatura normal en 45 °C.', 3, 6, 'falta_preventivo', 'Carla Méndez', true, (u->>'ej.tecnico1')::uuid, now() - interval '10 days', now() - interval '10 days');
  insert into public.costos_orden (orden_id, tipo, descripcion, cantidad, costo_unitario, ejemplo, creado_por)
  values (o, 'repuesto', 'Kit de limpieza química', 1, 91500, true, (u->>'ej.tecnico1')::uuid),
         (o, 'repuesto', 'Filtro de retorno hidráulico', 1, 38000, true, (u->>'ej.tecnico1')::uuid);

  -- Estados de los equipos que quedaron parados por los reportes históricos
  perform public._transicion();
  update public.equipos set estado = 'operativo' where id in ((eq->>'iny1')::uuid);
  update public.equipos set estado = 'detenido' where id = (eq->>'doy1')::uuid;
  update public.equipos set estado = 'en_reparacion' where id = (eq->>'iny2')::uuid;

  -- 9. Movimientos: préstamo en curso (LIM → INY), reparación externa (PIN) y un préstamo por aprobar (PIN → SAL)
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, area_origen_id, ubicacion_origen, empresa_destino_id, area_destino_id, ubicacion_destino,
         motivo, fecha_salida, fecha_vuelta_prevista, resuelto_por, resuelto_en, ejemplo, creado_en)
  values ((eq->>'apl1')::uuid, 'prestamo', 'en_curso', (emp->>'LIM')::uuid, (ar->>'Depósito / logística')::uuid, 'Depósito de producto terminado', (emp->>'INY')::uuid,
          (ar->>'Depósito / logística')::uuid, 'Depósito de INY', 'Pico de despachos en INY', hoy - 6, hoy + 15, (u->>'ej.direccion')::uuid, now() - interval '7 days', true, now() - interval '8 days');
  update public.equipos set empresa_ubicacion_id = (emp->>'INY')::uuid, ubicacion = 'Depósito de INY' where id = (eq->>'apl1')::uuid;
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, proveedor_id, fecha_salida, fecha_vuelta_prevista, presupuesto, remito, motivo, ejemplo, creado_en)
  values ((eq->>'aut1')::uuid, 'reparacion_externa', 'en_curso', (emp->>'PIN')::uuid, (pr->>'hid')::uuid, hoy - 4, hoy + 6, 420000, 'R-0002-00045123', 'Pérdida en el cilindro de elevación', true, now() - interval '4 days');
  update public.equipos set estado = 'reparacion_externa' where id = (eq->>'aut1')::uuid;
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, empresa_destino_id, ubicacion_destino, motivo, fecha_vuelta_prevista, ejemplo, creado_en)
  values ((eq->>'lat1')::uuid, 'prestamo', 'solicitado', (emp->>'PIN')::uuid, (emp->>'SAL')::uuid, 'Envasado', 'Prueba de envasado de aderezos en lata', hoy + 30, true, now() - interval '3 hours');

  insert into public.registro_cambios (usuario_id, nombre, perfil, operacion, tabla, registro, resumen)
  values (null, 'SQL Editor', null, 'alta', 'datos_ejemplo', null, 'Cargó los datos de ejemplo: 6 usuarios «ej.», 4 proveedores, 20 equipos, órdenes, reportes, compras y movimientos');

  return 'Datos de ejemplo cargados. Usuarios (contraseña: la que elegiste): ej.encargado, ej.tecnico1, ej.tecnico2, ej.operario1, ej.operario2, ej.direccion. '
      || 'Se borran con: select public.borrar_datos_ejemplo();';
end $$;

-- Borra todo lo marcado como ejemplo. Si mientras se probaba la app se cargaron cosas reales sobre datos de
-- ejemplo (por ejemplo, una orden en un equipo de ejemplo), se detiene y avisa: para borrarlas también,
-- se llama con p_tambien_lo_cargado_encima => true.
create or replace function public.borrar_datos_ejemplo(p_tambien_lo_cargado_encima boolean default false) returns text
language plpgsql security definer set search_path = public, auth as $$
declare reales int; n_eq int; n_us int; detalle text; t text;
begin
  if auth.uid() is not null then perform public._error('Los datos de ejemplo se borran desde el SQL Editor de Supabase.'); end if;
  create temp table b_us on commit drop as select id from public.usuarios where ejemplo;
  create temp table b_eq on commit drop as select id from public.equipos where ejemplo;
  create temp table b_rep on commit drop as select id, ejemplo from public.reportes_falla
    where ejemplo or equipo_id in (select id from b_eq) or operario_id in (select id from b_us) or creado_por in (select id from b_us);
  create temp table b_ord on commit drop as select id, ejemplo from public.ordenes
    where ejemplo or equipo_id in (select id from b_eq) or reporte_id in (select id from b_rep) or asignado_a in (select id from b_us) or prioridad_por in (select id from b_us) or creado_por in (select id from b_us);
  create temp table b_fic on commit drop as select id, ejemplo from public.fichas where ejemplo or orden_id in (select id from b_ord) or tecnico_id in (select id from b_us) or creado_por in (select id from b_us);
  create temp table b_cos on commit drop as select id, ejemplo from public.costos_orden where ejemplo or orden_id in (select id from b_ord) or creado_por in (select id from b_us);
  create temp table b_ped on commit drop as select id, ejemplo from public.pedidos_compra
    where ejemplo or orden_id in (select id from b_ord) or equipo_id in (select id from b_eq) or resuelto_por in (select id from b_us) or creado_por in (select id from b_us);
  create temp table b_mov on commit drop as select id, ejemplo from public.movimientos_equipo where ejemplo or equipo_id in (select id from b_eq) or resuelto_por in (select id from b_us) or creado_por in (select id from b_us);
  -- Lo real (no marcado como ejemplo) que quedaría colgado de datos de ejemplo
  select (select count(*) from b_rep where not ejemplo) + (select count(*) from b_ord where not ejemplo) + (select count(*) from b_fic where not ejemplo)
       + (select count(*) from b_cos where not ejemplo) + (select count(*) from b_ped where not ejemplo) + (select count(*) from b_mov where not ejemplo)
       + (select count(*) from public.documentos where equipo_id in (select id from b_eq))
    into reales;
  if reales > 0 and not p_tambien_lo_cargado_encima then
    select string_agg(x, ', ') into detalle from (
      select (select count(*) from b_rep where not ejemplo) || ' reportes' x union all select (select count(*) from b_ord where not ejemplo) || ' órdenes'
      union all select (select count(*) from b_fic where not ejemplo) || ' fichas' union all select (select count(*) from b_ped where not ejemplo) || ' pedidos de compra'
      union all select (select count(*) from b_mov where not ejemplo) || ' movimientos' union all select (select count(*) from public.documentos where equipo_id in (select id from b_eq)) || ' documentos') y
      where x !~ '^0 ';
    perform public._error('Hay ' || reales || ' registros cargados en la app sobre datos de ejemplo (' || detalle || '). '
      || 'Si también son de prueba, borralos junto con los de ejemplo: select public.borrar_datos_ejemplo(p_tambien_lo_cargado_encima => true);');
  end if;

  perform set_config('planta.carga_masiva', '1', true);
  perform set_config('planta.borrar_ejemplo', '1', true);
  delete from public.adjuntos where (tabla = 'reportes_falla' and registro_id in (select id from b_rep)) or (tabla = 'fichas' and registro_id in (select id from b_fic))
                                 or (tabla = 'costos_orden' and registro_id in (select id from b_cos)) or (tabla = 'movimientos_equipo' and registro_id in (select id from b_mov))
                                 or creado_por in (select id from b_us);
  delete from public.avisos where usuario_id in (select id from b_us);
  delete from public.fichas where id in (select id from b_fic);
  delete from public.costos_orden where id in (select id from b_cos);
  delete from public.pedidos_compra where id in (select id from b_ped);
  update public.reportes_falla set orden_id = null where id in (select id from b_rep) or orden_id in (select id from b_ord);
  delete from public.ordenes where id in (select id from b_ord);
  delete from public.reportes_falla where id in (select id from b_rep);
  delete from public.movimientos_equipo where id in (select id from b_mov);
  delete from public.documentos where equipo_id in (select id from b_eq);
  delete from public.equipo_alias where equipo_id in (select id from b_eq);
  select count(*) into n_eq from b_eq;
  delete from public.equipos where id in (select id from b_eq);
  delete from public.proveedores p where p.ejemplo
    and not exists (select 1 from public.equipos where proveedor_id = p.id) and not exists (select 1 from public.ordenes where contratista_id = p.id)
    and not exists (select 1 from public.fichas where contratista_id = p.id) and not exists (select 1 from public.costos_orden where proveedor_id = p.id)
    and not exists (select 1 from public.pedidos_compra where proveedor_id = p.id) and not exists (select 1 from public.movimientos_equipo where proveedor_id = p.id);
  -- Si un usuario de ejemplo modificó algo real (por ejemplo, editó una orden), solo se borra la referencia
  perform public._transicion();
  for t in select c.table_name from information_schema.columns c where c.table_schema = 'public' and c.column_name = 'modificado_por' and c.table_name <> 'registro_cambios' loop
    execute format('update public.%I set modificado_por = null where modificado_por in (select id from b_us)', t);
    execute format('update public.%I set creado_por = null where creado_por in (select id from b_us)', t);
  end loop;
  select count(*) into n_us from b_us;
  delete from public.usuarios where id in (select id from b_us);
  delete from auth.users where id in (select id from b_us);
  insert into public.registro_cambios (usuario_id, nombre, perfil, operacion, tabla, registro, resumen)
  values (null, 'SQL Editor', null, 'baja', 'datos_ejemplo', null, 'Borró los datos de ejemplo: ' || n_eq || ' equipos y ' || n_us || ' usuarios «ej.», con sus órdenes, reportes, compras y movimientos'
    || case when reales > 0 then ' (y ' || reales || ' registros cargados encima)' else '' end);
  return 'Datos de ejemplo borrados: ' || n_eq || ' equipos y ' || n_us || ' usuarios' || case when reales > 0 then ', y ' || reales || ' registros cargados encima' else '' end
    || '. Las fotos que se hayan subido mientras se probaba quedan en Storage (se pueden borrar desde Storage → adjuntos).';
end $$;


-- >>>>>>>>>> 20261114009900_ejecucion.sql
-- =====================================================================
-- App de mantenimiento · Último paso · Permisos de ejecución de las funciones
-- Lo interno no se puede llamar desde la app; lo público, solo con sesión iniciada.
-- (Va al final para alcanzar a todas las funciones de las migraciones anteriores.)
-- =====================================================================
do $$
declare f record;
  publicas text[] := array['mi_perfil','es','es_mantenimiento','mi_empresa','activo','veo_equipo','veo_orden','trabajo_en','puedo_adjuntar',
    'orden_estado','orden_prioridad','descartar_reporte','pedir_repuesto','resolver_pedido','recibir_pedido','pedir_prestamo','cancelar_prestamo',
    'resolver_prestamo','mover_equipo','reparacion_externa','reubicar_equipo','baja_equipo','estado_equipo','cargar_horometro',
    'crear_usuario','editar_usuario','restablecer_clave','estado_usuario','cambiar_mi_clave','registrar_conflicto','prioridad_de',
    'guardar_tema','volver_a_tema','problemas_contraste','contraste','suscribir_push','desuscribir_push','marcar_avisos_leidos'];
  -- Funciones de W-Main: no se tocan (W-Main sigue andando hasta que se publique la app nueva)
  w_main text[] := array['_empresa_de_codigo','asignar_numero_ot','borrar_codigo_operario','doc_update','estado_avisos_operario',
    'estado_codigos_operario','firma_propia','firmas_inmutables','mi_rol','nuevo_usuario','operario_ingresar','reglas_avisos',
    'reglas_tecnico','reportar_anomalia','set_codigo_operario','solo_cambia','verificar_firma_ot'];
begin
  for f in select p.oid::regprocedure as firma, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
             and p.proname <> all (w_main) loop
    execute format('revoke execute on function %s from public, anon', f.firma);
    if f.proname = any(publicas) then
      execute format('grant execute on function %s to authenticated', f.firma);
    else
      execute format('revoke execute on function %s from authenticated', f.firma);
    end if;
  end loop;
end $$;


-- >>>>>>>>>> 20261119000100_control_del_jefe.sql
-- =====================================================================
-- App de mantenimiento · 12 · El jefe de mantenimiento aprueba todo (decisión del 19/11/2026)
--   · Compras: las aprueba o rechaza solo el jefe. Lo que pide el propio jefe queda aprobado.
--   · Préstamos entre empresas: los pide y los aprueba el jefe (quedan aprobados al pedirlos).
--   · Prioridad de las órdenes: la confirma o cambia el jefe.
--   · Dirección: ve informes, pendientes y el registro de cambios, sin aprobar nada.
-- Se puede correr más de una vez.
-- =====================================================================

-- Compras: aprobar o rechazar (solo el jefe)
create or replace function public.resolver_pedido(p_pedido uuid, p_aprobar boolean, p_respuesta text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.pedidos_compra;
begin
  if not public.es('jefe') then perform public._error('Los pedidos de compra los aprueba el jefe de mantenimiento.'); end if;
  select * into c from public.pedidos_compra where id = p_pedido for update;
  if c.id is null or not public.mi_empresa(c.empresa_id) then perform public._error('No existe el pedido o no tenés acceso.'); end if;
  if c.estado <> 'pendiente' then perform public._error('El pedido ya fue resuelto.'); end if;
  if not p_aprobar and coalesce(btrim(p_respuesta), '') = '' then perform public._error('Indicá el motivo del rechazo.'); end if;
  perform public._aprueba(auth.uid());
  update public.pedidos_compra set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
    resuelto_por = auth.uid(), resuelto_en = now(), respuesta = p_respuesta where id = p_pedido;
end $$;

-- Lo que pide el jefe (directo o desde una orden) queda aprobado por él mismo
create or replace function public.pedido_del_jefe() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.es('jefe') and new.estado = 'pendiente' then
    new.estado := 'aprobado'; new.resuelto_por := auth.uid(); new.resuelto_en := now();
    perform public._aprueba(auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists b_del_jefe on public.pedidos_compra;
create trigger b_del_jefe before insert on public.pedidos_compra for each row execute function public.pedido_del_jefe();
select public._politica('crear', 'pedidos_compra', 'insert', null, 'public.es(''jefe'') and public.mi_empresa(empresa_id)');

-- Préstamos: los pide el jefe y quedan aprobados (después registra la salida y la vuelta)
create or replace function public.pedir_prestamo(p_equipo uuid, p_empresa_destino uuid, p_area uuid, p_ubicacion text, p_vuelta date, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.equipos; nid uuid;
begin
  if not public.es('jefe') then perform public._error('Los préstamos los decide el jefe de mantenimiento.'); end if;
  e := public._equipo(p_equipo);
  if p_empresa_destino = e.empresa_ubicacion_id then perform public._error('El equipo ya está en esa empresa.'); end if;
  if exists (select 1 from public.movimientos_equipo where equipo_id = p_equipo and estado in ('solicitado','aprobado','en_curso') and tipo in ('prestamo','reparacion_externa')) then
    perform public._error('El equipo ya tiene un préstamo o una reparación externa en trámite.');
  end if;
  perform public._aprueba(auth.uid());
  insert into public.movimientos_equipo (equipo_id, tipo, estado, empresa_origen_id, empresa_destino_id, area_destino_id, ubicacion_destino, fecha_vuelta_prevista, motivo,
                                         resuelto_por, resuelto_en)
  values (p_equipo, 'prestamo', 'aprobado', e.empresa_ubicacion_id, p_empresa_destino, p_area, p_ubicacion, p_vuelta, p_motivo, auth.uid(), now()) returning id into nid;
  return nid;
end $$;
-- (por si quedó alguno «solicitado» de antes)
create or replace function public.resolver_prestamo(p_mov uuid, p_aprobar boolean, p_respuesta text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe') then perform public._error('Los préstamos entre empresas los aprueba el jefe de mantenimiento.'); end if;
  if not p_aprobar and coalesce(btrim(p_respuesta), '') = '' then perform public._error('Indicá el motivo del rechazo.'); end if;
  perform public._aprueba(auth.uid());
  update public.movimientos_equipo set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
    resuelto_por = auth.uid(), resuelto_en = now(), respuesta = p_respuesta
    where id = p_mov and tipo = 'prestamo' and estado = 'solicitado';
  if not found then perform public._error('El préstamo no existe o ya fue resuelto.'); end if;
end $$;

-- Prioridad de las órdenes: la confirma o cambia el jefe
create or replace function public.orden_prioridad(p_orden uuid, p_prioridad text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es('jefe') then perform public._error('La prioridad la confirma o cambia el jefe de mantenimiento.'); end if;
  if p_prioridad not in ('urgente','alta','media','baja') then perform public._error('Prioridad desconocida.'); end if;
  if not exists (select 1 from public.ordenes o where o.id = p_orden and public.veo_equipo(o.equipo_id)) then perform public._error('No existe la orden o no tenés acceso.'); end if;
  perform public._transicion(); perform public._aprueba(auth.uid());
  update public.ordenes set prioridad = p_prioridad, prioridad_por = auth.uid(), prioridad_en = now() where id = p_orden;
end $$;

-- Avisos: las compras por aprobar le llegan al jefe
create or replace function public.avisar_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public._sin_avisos() then return null; end if;
  if tg_op = 'INSERT' and new.estado = 'pendiente' then
    perform public._avisar(array(select public._destinatarios(array['jefe'], array[new.empresa_id], new.creado_por)), 'compra_pendiente',
      'Compra por aprobar: PC-' || lpad(new.numero::text, 4, '0'),
      new.descripcion || coalesce(' · $ ' || to_char(new.monto_estimado, 'FM999G999G999D00'), '') || coalesce(' · pidió ' || public._nombre(new.creado_por), ''), '/compras');
  elsif tg_op = 'UPDATE' and new.estado in ('aprobado','rechazado') and old.estado = 'pendiente' and new.creado_por is distinct from auth.uid() then
    perform public._avisar(array[new.creado_por], 'compra_resuelta',
      case when new.estado = 'aprobado' then 'Compra aprobada: ' else 'Compra rechazada: ' end || 'PC-' || lpad(new.numero::text, 4, '0'),
      new.descripcion || coalesce(' — ' || new.respuesta, ''), '/compras');
  end if;
  return null;
end $$;


-- >>>>>>>>>> 20261120000100_usuarios_y_bajas.sql
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


-- >>>>>>>>>> 20261120000200_siglas_usuarios_contratistas.sql
-- =====================================================================
-- App de mantenimiento · 14 · Siglas, eliminar usuarios y contratistas cargados a mano (20/11/2026)
--   · La sigla de una empresa se puede cambiar si la empresa no tiene equipos activos (los dados de
--     baja conservan su código viejo). La numeración de los códigos sigue por sigla y tipo.
--   · Un usuario dado de baja se puede eliminar: si nunca cargó ni tuvo asignado nada se borra del todo;
--     si tiene historia, desaparece de la lista y libera su usuario, pero su nombre queda en el historial.
--   · El jefe y el encargado pueden cargar proveedores y contratistas nuevos (al crear una orden, etc.).
-- Se puede correr más de una vez.
-- =====================================================================

-- ---------- Siglas ----------
create or replace function public.sigla_fija() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sigla is distinct from old.sigla and exists (select 1 from public.equipos where empresa_duena_id = old.id and estado <> 'baja') then
    raise exception 'La sigla % ya está en códigos de equipos activos y no se puede cambiar. (Se puede cambiar cuando la empresa no tiene equipos activos.)', old.sigla using errcode = '42501';
  end if;
  return new;
end $$;

-- El código (SIGLA-TIPO-NNN) es único; el número ya no es único por empresa y tipo, porque al cambiar
-- la sigla los equipos nuevos vuelven a empezar en 001 (los dados de baja conservan su código viejo)
alter table public.equipos drop constraint if exists equipos_empresa_duena_id_tipo_numero_key;

-- Código del equipo: el número sigue por sigla y tipo (si la sigla cambió, los equipos nuevos empiezan en 001)
create or replace function public.codigo_equipo() returns trigger
language plpgsql security definer set search_path = public as $$
declare sig text;
begin
  if tg_op = 'INSERT' then
    select sigla into sig from public.empresas where id = new.empresa_duena_id;
    perform pg_advisory_xact_lock(hashtext('equipo:' || sig || ':' || new.tipo));
    if new.numero is null or auth.uid() is not null then
      select coalesce(max(numero), 0) + 1 into new.numero from public.equipos
        where codigo like sig || '-' || new.tipo || '-%';
    end if;
    new.codigo := sig || '-' || new.tipo || '-' || lpad(new.numero::text, 3, '0');
    new.empresa_ubicacion_id := coalesce(new.empresa_ubicacion_id, new.empresa_duena_id);
  else
    if new.codigo is distinct from old.codigo or new.numero is distinct from old.numero
       or new.empresa_duena_id is distinct from old.empresa_duena_id or new.tipo is distinct from old.tipo then
      raise exception 'El código, la empresa dueña y el tipo del equipo no se pueden cambiar.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ---------- Eliminar usuarios ----------
alter table public.usuarios add column if not exists eliminado boolean not null default false;

-- Los usuarios solo se borran con eliminar_usuario() (o con el borrado de los datos de ejemplo)
create or replace function public.no_se_borra() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null and current_setting('planta.borrar_ejemplo', true) = '1' then return old; end if;
  if tg_table_name = 'usuarios' and current_setting('planta.borrar_usuario', true) = old.id::text then return old; end if;
  raise exception 'Los registros de % no se borran: se dan de baja o se desactivan.', tg_table_name using errcode = '42501';
end $$;

create or replace function public.eliminar_usuario(p_id uuid) returns text
language plpgsql security definer set search_path = public, auth as $$
declare u public.usuarios; historia boolean; alias text;
begin
  if not public.es('jefe') then perform public._error('Los usuarios los elimina el jefe de mantenimiento.'); end if;
  if p_id = auth.uid() then perform public._error('No podés eliminarte a vos mismo.'); end if;
  select * into u from public.usuarios where id = p_id and not eliminado;
  if u.id is null then perform public._error('No existe el usuario.'); end if;
  if u.activo then perform public._error('Primero dalo de baja; después se puede eliminar.'); end if;
  if u.perfil = 'jefe' and not exists (select 1 from public.usuarios where perfil = 'jefe' and activo and id <> p_id) then
    perform public._error('Tiene que quedar al menos un jefe de mantenimiento activo.');
  end if;
  historia := exists (select 1 from public.reportes_falla where operario_id = p_id or creado_por = p_id)
    or exists (select 1 from public.ordenes where asignado_a = p_id or prioridad_por = p_id or creado_por = p_id)
    or exists (select 1 from public.fichas where tecnico_id = p_id or creado_por = p_id)
    or exists (select 1 from public.costos_orden where creado_por = p_id)
    or exists (select 1 from public.pedidos_compra where creado_por = p_id or resuelto_por = p_id)
    or exists (select 1 from public.movimientos_equipo where creado_por = p_id or resuelto_por = p_id)
    or exists (select 1 from public.adjuntos where creado_por = p_id)
    or exists (select 1 from public.documentos where creado_por = p_id)
    or exists (select 1 from public.equipos where creado_por = p_id);
  if not historia then
    begin
      delete from public.avisos where usuario_id = p_id;
      perform set_config('planta.borrar_usuario', p_id::text, true);
      delete from public.usuarios where id = p_id;
      delete from auth.users where id = p_id;
      perform set_config('planta.borrar_usuario', '', true);
      return 'borrado';
    exception when foreign_key_violation then
      null;   -- algo lo referencia: se archiva como abajo
    end;
  end if;
  -- Con historia: deja de figurar, no puede ingresar y libera su usuario; el nombre queda en el historial
  alias := 'eliminado.' || left(replace(p_id::text, '-', ''), 10);
  update public.usuarios set eliminado = true, activo = false, usuario = alias where id = p_id;
  update auth.users set email = public._email_de(alias), banned_until = '2999-12-31'::timestamptz, updated_at = now() where id = p_id;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', public._email_de(alias)) where user_id = p_id and provider = 'email';
  delete from auth.sessions where user_id = p_id;
  delete from public.push_suscripciones where usuario_id = p_id;
  delete from public.usuario_empresas where usuario_id = p_id;
  return 'archivado';
end $$;
revoke execute on function public.eliminar_usuario(uuid) from public, anon;
grant execute on function public.eliminar_usuario(uuid) to authenticated;

-- Un usuario eliminado no se reactiva
create or replace function public.estado_usuario(p_id uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.es('jefe') or p_id = auth.uid() then perform public._error('No podés cambiar el estado de ese usuario.'); end if;
  if p_activo and exists (select 1 from public.usuarios where id = p_id and eliminado) then perform public._error('Ese usuario fue eliminado: creá uno nuevo.'); end if;
  update public.usuarios set activo = p_activo where id = p_id;
  if not found then perform public._error('No existe el usuario.'); end if;
  update auth.users set banned_until = case when p_activo then null else '2999-12-31'::timestamptz end where id = p_id;
  if not p_activo then delete from auth.sessions where user_id = p_id; end if;
end $$;

-- ---------- Proveedores y contratistas: los cargan el jefe y el encargado ----------
select public._politica('crear', 'proveedores', 'insert', null, 'public.es(''jefe'',''encargado'')');


-- >>>>>>>>>> 20261120000300_preventivos_y_wmain.sql
-- =====================================================================
-- App de mantenimiento · 15 · Plan de preventivos y nombres de W-Main (20/11/2026)
--   · Preventivos: tareas por equipo cada N días, semanas, meses, años u horas de uso.
--     Estado: vencida, próxima, al día o sin datos. El jefe arma y cambia el plan; el jefe y el
--     encargado generan la orden (o registran que se hizo). Al terminar la orden, la tarea queda al día.
--   · Avisos diarios: también los preventivos vencidos (al jefe y a los encargados de la empresa).
--   · Nombres: la app pasa a llamarse W-Main y el perfil del jefe, «Gerente de mantenimiento».
-- Se puede correr más de una vez.
-- =====================================================================

-- ---------- Tareas preventivas ----------
create table if not exists public.preventivos (
  id           uuid primary key default gen_random_uuid(),
  equipo_id    uuid not null references public.equipos(id) on delete cascade,   -- solo se borra junto con los datos de ejemplo
  titulo       text not null check (length(btrim(titulo)) between 2 and 200),
  descripcion  text,                                   -- pasos, puntos a revisar
  frecuencia   int not null check (frecuencia between 1 and 100000),
  unidad       text not null check (unidad in ('dias','semanas','meses','anios','horas')),
  aviso_dias   int not null default 7 check (aviso_dias between 0 and 365),        -- cuántos días antes pasa a «próxima»
  aviso_horas  numeric(10,1) not null default 50 check (aviso_horas >= 0),          -- ídem, para las tareas por horas de uso
  ultima_fecha date,                                   -- la última vez que se hizo
  ultima_horas numeric(12,1),                          -- horómetro de esa vez (tareas por horas)
  asignado_a   uuid references public.usuarios(id),
  activo       boolean not null default true,
  ejemplo      boolean not null default false
);
select public._control('public.preventivos');
create index if not exists preventivos_equipo on public.preventivos (equipo_id);
alter table public.ordenes add column if not exists preventivo_id uuid references public.preventivos(id);

-- Estado de la tarea (lo mismo calcula la app)
create or replace function public.preventivo_estado(p public.preventivos, horometro numeric) returns text
language sql stable as $$
  select case
    when p.unidad = 'horas' then
      case when p.ultima_horas is null or horometro is null then 'sin_datos'
           when horometro >= p.ultima_horas + p.frecuencia then 'vencida'
           when horometro >= p.ultima_horas + p.frecuencia - p.aviso_horas then 'proxima'
           else 'al_dia' end
    else
      case when p.ultima_fecha is null then 'sin_datos'
           when current_date > (p.ultima_fecha + (p.frecuencia || ' ' || case p.unidad when 'dias' then 'days' when 'semanas' then 'weeks' when 'meses' then 'months' else 'years' end)::interval)::date then 'vencida'
           when current_date >= (p.ultima_fecha + (p.frecuencia || ' ' || case p.unidad when 'dias' then 'days' when 'semanas' then 'weeks' when 'meses' then 'months' else 'years' end)::interval)::date - p.aviso_dias then 'proxima'
           else 'al_dia' end
  end
$$;

alter table public.preventivos enable row level security;
select public._politica('ver', 'preventivos', 'select', 'public.es(''jefe'',''encargado'',''tecnico'',''direccion'') and public.veo_equipo(equipo_id)');
select public._politica('crear', 'preventivos', 'insert', null, 'public.es(''jefe'') and public.veo_equipo(equipo_id)');
select public._politica('modificar', 'preventivos', 'update', 'public.es(''jefe'')', 'public.es(''jefe'')');

-- Las tareas no se borran: se quitan del plan (activo = false)
drop trigger if exists no_borrar on public.preventivos;
create trigger no_borrar before delete on public.preventivos for each row execute function public.no_se_borra();

-- Registrar que se hizo (sin orden, por ejemplo al cargar el plan): jefe o encargado
create or replace function public.preventivo_hecho(p_id uuid, p_fecha date default null, p_horas numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.preventivos; h numeric;
begin
  if not public.es('jefe','encargado') then perform public._error('Lo registra el jefe o el encargado.'); end if;
  select * into p from public.preventivos where id = p_id;
  if p.id is null or not public.veo_equipo(p.equipo_id) then perform public._error('No existe la tarea o no tenés acceso.'); end if;
  if coalesce(p_fecha, current_date) > current_date then perform public._error('La fecha no puede ser futura.'); end if;
  select horometro into h from public.equipos where id = p.equipo_id;
  update public.preventivos set ultima_fecha = coalesce(p_fecha, current_date), ultima_horas = coalesce(p_horas, h, ultima_horas) where id = p_id;
end $$;
revoke execute on function public.preventivo_hecho(uuid, date, numeric) from public, anon;
grant execute on function public.preventivo_hecho(uuid, date, numeric) to authenticated;

-- Una orden por tarea a la vez; la orden queda como preventiva
create or replace function public.orden_de_preventivo() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.preventivos;
begin
  if new.preventivo_id is null then return new; end if;
  select * into p from public.preventivos where id = new.preventivo_id;
  if p.id is null or p.equipo_id <> new.equipo_id then raise exception 'La tarea preventiva no corresponde a ese equipo.'; end if;
  if exists (select 1 from public.ordenes where preventivo_id = new.preventivo_id and estado in ('abierta','asignada','esperando_repuesto','en_curso')) then
    raise exception 'Esa tarea preventiva ya tiene una orden abierta.';
  end if;
  new.tipo := 'preventiva';
  return new;
end $$;
drop trigger if exists a_preventivo on public.ordenes;
create trigger a_preventivo before insert on public.ordenes for each row execute function public.orden_de_preventivo();

-- Al terminarse la orden, la tarea queda al día (fecha y horómetro de ese momento)
create or replace function public.preventivo_al_terminar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.preventivo_id is not null and new.estado in ('terminada','verificada','cerrada') and old.estado not in ('terminada','verificada','cerrada') then
    update public.preventivos set ultima_fecha = coalesce(new.terminada_en, now())::date,
      ultima_horas = coalesce((select horometro from public.equipos where id = new.equipo_id), ultima_horas)
      where id = new.preventivo_id;
  end if;
  return null;
end $$;
drop trigger if exists d_preventivo on public.ordenes;
create trigger d_preventivo after update of estado on public.ordenes for each row execute function public.preventivo_al_terminar();

-- Registro de cambios y tiempo real
create or replace function public._etiqueta(tabla text, r jsonb) returns text
language sql stable security definer set search_path = public as $$
  select case tabla
    when 'equipos'            then 'el equipo ' || (r->>'codigo') || ' «' || (r->>'nombre') || '»'
    when 'ordenes'            then 'la orden OT-' || lpad(r->>'numero', 4, '0') || ' «' || (r->>'titulo') || '»'
    when 'pedidos_compra'     then 'el pedido de compra PC-' || lpad(r->>'numero', 4, '0') || ' «' || (r->>'descripcion') || '»'
    when 'fichas'             then case when (r->>'es_cierre')::boolean then 'la ficha de cierre' else 'una ficha de trabajo' end || ' de la OT-'
                                   || coalesce((select lpad(numero::text, 4, '0') from public.ordenes where id = (r->>'orden_id')::uuid), '?')
    when 'costos_orden'       then 'el costo «' || (r->>'descripcion') || '» de la OT-' || coalesce((select lpad(numero::text, 4, '0') from public.ordenes where id = (r->>'orden_id')::uuid), '?')
    when 'reportes_falla'     then 'un reporte de falla en ' || coalesce((select codigo from public.equipos where id = (r->>'equipo_id')::uuid), '?')
    when 'movimientos_equipo' then case r->>'tipo' when 'prestamo' then 'el préstamo' when 'reparacion_externa' then 'la reparación externa'
                                   when 'baja' then 'la baja' else 'la reubicación' end || ' de ' || coalesce((select codigo from public.equipos where id = (r->>'equipo_id')::uuid), '?')
    when 'documentos'         then 'el documento «' || (r->>'nombre') || '» de ' || coalesce((select codigo from public.equipos where id = (r->>'equipo_id')::uuid), '?')
    when 'adjuntos'           then 'un archivo (' || (r->>'tipo') || ')'
    when 'usuarios'           then 'el usuario ' || (r->>'nombre') || ' (' || (r->>'usuario') || ')'
    when 'usuario_empresas'   then 'el acceso de ' || coalesce((select nombre from public.usuarios where id = (r->>'usuario_id')::uuid), '?')
                                   || ' a ' || coalesce((select sigla from public.empresas where id = (r->>'empresa_id')::uuid), '?')
    when 'empresas'           then 'la empresa ' || (r->>'sigla')
    when 'areas'              then 'el área «' || (r->>'nombre') || '»'
    when 'tipos_equipo'       then 'el tipo de equipo ' || (r->>'sigla') || ' «' || (r->>'nombre') || '»'
    when 'listas'             then 'la opción «' || (r->>'nombre') || '» de ' || replace(r->>'lista', '_', ' ')
    when 'proveedores'        then 'el proveedor «' || (r->>'nombre') || '»'
    when 'config'             then 'el parámetro ' || (r->>'clave')
    when 'temas'              then 'la apariencia (versión ' || (r->>'version') || ')'
    when 'preventivos'        then 'la tarea preventiva «' || (r->>'titulo') || '» de ' || coalesce((select codigo from public.equipos where id = (r->>'equipo_id')::uuid), '?')
    else tabla end
$$;
drop trigger if exists z_registrar on public.preventivos;
create trigger z_registrar after insert or update or delete on public.preventivos for each row execute function public.registrar('id');
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.preventivos; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------- Avisos diarios: también los preventivos vencidos ----------
create or replace function public.avisos_diarios() returns int
language plpgsql security definer set search_path = public as $$
declare o record; n int := 0; u record; hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  abiertas int; paradas int; reportes int; compras int; vencidas int; prev int;
begin
  -- Órdenes vencidas (una vez por día cada una)
  for o in select x.*, e.codigo, e.empresa_duena_id, e.empresa_ubicacion_id from public.ordenes x join public.equipos e on e.id = x.equipo_id
           where x.vence < hoy and x.estado in ('abierta','asignada','esperando_repuesto','en_curso') loop
    perform public._avisar(array(select public._destinatarios(array['encargado'], array[o.empresa_duena_id, o.empresa_ubicacion_id])) || o.asignado_a,
      'orden_vencida', 'Orden vencida: ' || public._ot(o.numero), o.titulo || ' · ' || o.codigo || ' · venció el ' || to_char(o.vence, 'DD/MM/YYYY'), '/ordenes/' || o.id);
    n := n + 1;
  end loop;
  -- Preventivos vencidos sin orden abierta: un aviso por persona con la cantidad
  for u in select id, perfil from public.usuarios where activo and perfil in ('jefe','encargado') loop
    select count(*) into prev from public.preventivos p join public.equipos e on e.id = p.equipo_id
      where p.activo and e.estado <> 'baja' and public.preventivo_estado(p, e.horometro) = 'vencida'
        and not exists (select 1 from public.ordenes x where x.preventivo_id = p.id and x.estado in ('abierta','asignada','esperando_repuesto','en_curso'))
        and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)));
    if prev > 0 then
      perform public._avisar(array[u.id], 'preventivos_vencidos', prev || case when prev = 1 then ' preventivo vencido' else ' preventivos vencidos' end,
        'Generá las órdenes desde Preventivos.', '/preventivos');
    end if;
  end loop;
  -- Resumen del día, con lo de las empresas de cada uno
  for u in select id, perfil from public.usuarios where activo and perfil in ('jefe','direccion') loop
    select count(*) filter (where x.estado in ('abierta','asignada','esperando_repuesto','en_curso')),
           count(*) filter (where x.estado in ('abierta','asignada','esperando_repuesto','en_curso') and x.vence < hoy)
      into abiertas, vencidas
      from public.ordenes x join public.equipos e on e.id = x.equipo_id
      where u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id));
    select count(*) into paradas from public.equipos e where e.estado in ('detenido','en_reparacion')
      and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)));
    select count(*) into reportes from public.reportes_falla r join public.equipos e on e.id = r.equipo_id where r.estado = 'nuevo'
      and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)));
    select count(*) into compras from public.pedidos_compra p where p.estado = 'pendiente'
      and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id = p.empresa_id));
    select count(*) into prev from public.preventivos p join public.equipos e on e.id = p.equipo_id
      where p.activo and e.estado <> 'baja' and public.preventivo_estado(p, e.horometro) = 'vencida'
        and (u.perfil = 'jefe' or exists (select 1 from public.usuario_empresas ue where ue.usuario_id = u.id and ue.empresa_id in (e.empresa_duena_id, e.empresa_ubicacion_id)));
    perform public._avisar(array[u.id], 'resumen_diario', 'Resumen del día · ' || to_char(hoy, 'DD/MM'),
      abiertas || ' órdenes pendientes' || case when vencidas > 0 then ' (' || vencidas || ' vencidas)' else '' end
      || ' · ' || prev || ' preventivos vencidos · ' || paradas || ' máquinas paradas · ' || reportes || ' reportes sin atender · ' || compras || ' compras por aprobar',
      '/');
  end loop;
  return n;
end $$;

-- ---------- Nombres de W-Main en la apariencia activa ----------
-- Solo si sigue con el nombre de fábrica «Mantenimiento» (si ya lo cambiaste en Apariencia, no se toca).
-- Queda como una versión nueva: se puede volver atrás desde Apariencia → Versiones.
do $$
declare t public.temas; v int; nuevo jsonb;
begin
  select * into t from public.temas where activo;
  if t.id is null or coalesce(t.tokens->'marca'->>'nombre', '') <> 'Mantenimiento' then return; end if;
  nuevo := jsonb_set(t.tokens, '{marca,nombre}', '"W-Main"');
  nuevo := jsonb_set(nuevo, '{vocabulario}', coalesce(nuevo->'vocabulario', '{}'::jsonb) || '{"jefe": "Gerente de mantenimiento"}'::jsonb);
  perform pg_advisory_xact_lock(hashtext('temas'));
  select coalesce(max(version), 0) + 1 into v from public.temas;
  update public.temas set activo = false where activo;
  insert into public.temas (version, nombre, tokens, activo, nota) values (v, 'W-Main', nuevo, true, 'Nombre W-Main y perfil «Gerente de mantenimiento» (fusión con W-Main)');
end $$;
