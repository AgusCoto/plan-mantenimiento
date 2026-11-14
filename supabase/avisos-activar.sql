-- =====================================================================
-- Activar el envío de avisos push (se corre UNA vez, en Supabase → SQL Editor, después de publicar la
-- función «avisos»; ver README → Avisos). Reemplazá los dos valores entre <>:
--   <URL del proyecto>   Project Settings → API → Project URL   (ej.: https://abcdefgh.supabase.co)
--   <clave pública>      Project Settings → API → anon / publishable key (es pública por diseño)
-- ¡No pongas acá la clave service_role ni la contraseña de la base!
-- =====================================================================
create extension if not exists pg_net;
create extension if not exists pg_cron;

insert into public.servidor (clave, valor) values
  ('url_funcion_avisos', '<URL del proyecto>/functions/v1/avisos'),
  ('clave_publica', '<clave pública>')
on conflict (clave) do update set valor = excluded.valor;

-- Avisos diarios a las 8 (hora argentina) y reintentos cada 5 minutos
select cron.schedule('avisos-diarios', '0 11 * * *', 'select public.avisos_diarios()');
select cron.schedule('avisos-reintento', '*/5 * * * *', 'select public.reenviar_avisos()');

-- Comprobación: tiene que mostrar las dos filas y las dos tareas
select clave, case when clave = 'clave_publica' then left(valor, 12) || '…' else valor end as valor from public.servidor;
select jobname, schedule from cron.job where jobname like 'avisos-%';
