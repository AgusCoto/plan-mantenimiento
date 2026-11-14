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
