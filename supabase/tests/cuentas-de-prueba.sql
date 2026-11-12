-- Cuentas para el recorrido de prueba (tests/recorrido.e2e.mjs). SOLO para un Supabase local de pruebas.
select public.primera_cuenta_direccion('direccion', 'Laura Directora', 'clave-direccion', '4321');
select public._crear_cuenta('gerente',    'Martín Gerente',     'gm',  null,  'clave-gerente',    '1234');
select public._crear_cuenta('produccion', 'Paula Producción',   'gp',  null,  'clave-produccion', '5678');
select public._crear_cuenta('tecnico',    'Tomás Técnico',      'tec', null,  'clave-tecnico',    null);
select public._crear_cuenta('operario',   'Oscar Operario',     'op',  'INY', 'clave-operario',   null);
select public._crear_cuenta('admin',      'Ana Administración', 'adm', null,  'clave-admin',      null);
