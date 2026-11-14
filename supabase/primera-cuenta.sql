-- =====================================================================
-- Primera cuenta del jefe de mantenimiento (se corre UNA vez, en Supabase → SQL Editor, después de
-- instalar la base con supabase/instalar.sql). Reemplazá los valores entre <> y tocá «Run».
--   usuario:  con el que vas a ingresar (minúsculas, sin espacios; ej.: agustin.coto)
--   clave:    al menos 8 caracteres. Después cambiala desde la app (Mi cuenta), porque el SQL Editor
--             guarda el historial de lo que se ejecuta.
-- Si ya migraste W-Main, no hace falta: tu usuario de administrador ya es jefe.
-- =====================================================================
select public.primera_cuenta_jefe('<usuario>', '<Nombre y apellido>', '<clave>', '<teléfono o dejalo vacío>');
