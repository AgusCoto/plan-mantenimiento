-- =====================================================================
-- Gestión de Planta · Primera cuenta de Dirección
-- Cambiá los cuatro valores y ejecutalo UNA vez en Supabase → SQL Editor → Run.
-- Con esa cuenta se crean todas las demás desde la app (Usuarios).
--   usuario:    minúsculas, números, punto o guion (3 a 30)
--   contraseña: al menos 8 caracteres
--   código:     de 4 a 6 números (para autorizar cambios sensibles)
-- =====================================================================
select public.primera_cuenta_direccion(
  'tu.usuario',            -- usuario para ingresar
  'Tu nombre y apellido',  -- nombre que se muestra
  'una-contraseña-segura', -- contraseña
  '123456'                 -- código de acceso
);
