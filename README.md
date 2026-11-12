# Gestión de Planta

Sistema de gestión del grupo de cuatro empresas: **INY** (inyectora de plásticos), **LIM** (productos de limpieza), **PIN** (pinturas) y **SAL** (salsas y aderezos).

Son **dos apps instalables** (PWA: iPhone, Android y PC) que usan la misma base de datos:

| App | Dirección | Quién la usa |
|---|---|---|
| **Gestión** | `/` | Gerente de mantenimiento, técnicos, gerente de producción, administración y dirección |
| **Operarios** | `/operarios/` | Solo operarios: reportan problemas en las máquinas (con fotos y videos) y cargan producción, ventas y compras |

Una cuenta de gestión no entra a operarios y viceversa. Reemplaza a W-Main: sus datos se migran solos (ver más abajo).

- **Frontend:** React + Vite + TypeScript.
- **Base de datos, usuarios y archivos:** Supabase (PostgreSQL + Auth + Storage).
- **Publicación:** GitHub Pages, automática en cada cambio de `main`.

El diseño, los textos y los permisos salen del prototipo `referencia/gestion-planta-prototipo.html`.

---

## Qué puede hacer cada perfil

| Perfil | Puede |
|---|---|
| **Gerente de mantenimiento** | Equipos (alta con su código, edición, reubicación entre empresas, baja), órdenes de trabajo, preventivos, manuales PDF, revisión de reportes de operarios y OT desde un reporte. Crea técnicos y operarios. |
| **Técnico** | Ve órdenes, equipos, historial y manuales; completa fichas de trabajo y registra preventivos. Da de alta equipos solo con el código de un gerente de mantenimiento. No modifica equipos. |
| **Gerente de producción** | Revisa u observa lo que cargan los operarios. Crea cuentas de administración y operarios. |
| **Administración** | Listados de producción, ventas y compras con filtros, totales y exportación a CSV. |
| **Dirección** | Solo lectura de informes, gráficos y pendientes. Crea cualquier cuenta. |
| **Operario** | Reporta problemas en máquinas (fotos y videos) y carga producción, ventas y compras. Ve solo lo suyo. |

Todos los de gestión ven el **informe semanal** (productividad + mantenimiento), que se puede descargar. Gerentes y dirección cambian el nombre de las empresas con su código. **Las cuentas se desactivan, no se borran.**

## Seguridad

Todo se controla **en la base de datos**; ocultar un botón en la app no alcanza.

- **Permisos por perfil con Row Level Security** en todas las tablas (`supabase/migrations/…_reglas_y_permisos.sql`).
- **Códigos de acceso** de 4 a 6 números para gerentes y dirección.
  - Se guardan con hash bcrypt en una tabla que nadie puede leer.
  - Se verifican en funciones de Postgres, nunca en el navegador.
  - Después de 5 intentos fallidos se bloquean 10 minutos.
  - **Alta de equipo:** `alta_equipo()` exige el código de un gerente de mantenimiento. No hay otra forma de insertar equipos.
  - **Nombre de empresa:** `renombrar_empresa()` exige el código de quien hace el cambio. La sigla no cambia.
- **Registro de cambios** hecho con triggers. Anota cada alta, modificación, baja e ingreso con:
  - quién y cuándo;
  - qué cambió (antes → después);
  - quién autorizó con su código.

  Un trigger impide editarlo o borrarlo, incluso desde el SQL Editor.
- **Sellos de autoría:** cada registro guarda `creado_por`, `creado`, `modificado_por` y `modificado`, completados por la base.
- **Autoría forzada:** fichas, reportes y movimientos quedan siempre a nombre de quien está conectado, aunque la app mande otro nombre.
- **Fotos y videos:** van en buckets privados. El operario solo sube a su carpeta, y Gestión los ve con enlaces temporales.

La prueba `supabase/tests/permisos.test.mjs` hace que cada perfil intente lo que puede y lo que no, a través de la API real (90 casos).

---

## Puesta en marcha (paso a paso)

### 1. Supabase: crear o usar el proyecto

- **Si ya usabas W-Main:** usá el mismo proyecto. No hace falta crear nada. Seguí al paso 2.
- **Proyecto nuevo:**
  1. Entrá a [supabase.com](https://supabase.com) → **New project**.
  2. Elegí nombre, contraseña de la base y región **South America (São Paulo)**.
  3. Esperá unos minutos a que termine de crearse.

### 2. Correr las migraciones (crea todo y migra W-Main)

1. En Supabase andá a **SQL Editor** → **New query**.
2. Abrí `supabase/instalar.sql` de este repositorio. En GitHub: abrir el archivo → botón **Copy raw file**.
3. Pegalo completo y tocá **Run**.
4. Al final aparece un resultado:
   - **Con W-Main:** el resumen de la migración, con la lista de **qué usuario le tocó a cada cuenta**. Guardalo. Las cuentas de W-Main pasan a ingresar con **usuario** en lugar de email, con la **misma contraseña**.
   - **Proyecto nuevo:** dice que no había nada para migrar.

Se puede volver a ejecutar sin perder datos. La migración de W-Main corre una sola vez y deja la tabla `docs` de W-Main intacta, como respaldo.

### 3. Primera cuenta

- **Si migraste W-Main:** ya tenés cuenta. Los perfiles quedan así:
  - admin → gerente de mantenimiento
  - técnico → técnico
  - lectura → dirección

  Al ingresar, la app les pide a los gerentes que definan su **código de acceso** en «Mi cuenta». Hasta que lo hagan no se pueden dar de alta equipos.
- **Proyecto nuevo:** abrí `supabase/primera-cuenta.sql`, cambiá los cuatro valores (usuario, nombre, contraseña y código), pegalo en el SQL Editor y **Run**. Con esa cuenta de Dirección creás las demás desde **Usuarios**.

### 4. Cerrar el registro libre de usuarios

En Supabase andá a **Authentication → Sign In / Providers** y desactivá **Allow new users to sign up**.

Las cuentas se crean solo desde la app. Una cuenta creada por fuera no ve nada, pero así se evita basura.

### 5. Cargar las claves en GitHub

1. En Supabase andá a **Project Settings → API** (o **Data API / API Keys**) y copiá:
   - la **Project URL**;
   - la clave **anon / publishable**, que es pública por diseño. **Nunca** uses la `service_role` / secret.
2. En GitHub andá al repositorio → **Settings → Secrets and variables → Actions → New repository secret** y creá:
   - `SUPABASE_URL` = la Project URL;
   - `SUPABASE_ANON_KEY` = la clave anon / publishable.

> Si venías de W-Main, estos dos secretos ya están cargados.

### 6. Publicar

1. En GitHub: **Settings → Pages → Source: GitHub Actions** (si venías de W-Main, ya está así).
2. Uní la rama `gestion-planta` a `main`: **Pull requests → New pull request → base: main, compare: gestion-planta → Create → Merge**. El workflow **Publicar la app** arma y publica solo; lo ves en la pestaña **Actions**.
3. Quedan en:
   - Gestión: `https://aguscoto.github.io/plan-mantenimiento/`
   - Operarios: `https://aguscoto.github.io/plan-mantenimiento/operarios/`

> Orden importante: primero el paso 2 (SQL) y después el 6. Si se publica antes, la app no encuentra las tablas nuevas.

### 7. Instalar en celulares y PC

- **iPhone:** abrí la dirección en Safari → **Compartir → Agregar a inicio**.
- **Android:** abrí la dirección en Chrome → **Instalar app**.
- **PC:** en Chrome o Edge, ícono de instalar en la barra de direcciones.

Cada app tiene su ícono: azul para Gestión y naranja con el casco para Operarios.

### 8. Etiquetas QR

- En **Equipos → Hoja de etiquetas QR** (o **Descargar etiqueta** en cada equipo) se generan las etiquetas.
- Cada QR abre `…/operarios/?equipo=CÓDIGO`:
  - para el operario, con la máquina ya elegida;
  - si quien escanea tiene sesión de Gestión, se abre la ficha del equipo.
- **Las etiquetas viejas de W-Main siguen funcionando:** los códigos anteriores quedan como alias del equipo.

---

## Códigos de equipo

`EMPRESA-ÁREA-TIPO-NÚMERO`, por ejemplo `INY-PRO-INY-001`.

- Lo genera la base al dar de alta.
- **No cambia aunque el equipo se reubique en otra empresa**, así la etiqueta sigue sirviendo.
- Los equipos de W-Main se recodifican con las siglas nuevas: IP → INY, LH → LIM, PH → PIN, AL → SAL; GR y cualquier otra → INY. El código anterior sigue funcionando.

## Fotos y videos

- **Fotos:** se achican en el celular antes de subirse (1600 px, JPEG).
- **Videos:** se aceptan MP4 y MOV del iPhone. El límite está en la tabla `config` y se cambia con `select public.limite_video(100);` en el SQL Editor.
  - El plan gratuito de Supabase no acepta archivos de más de **50 MB**.
  - Un video MOV del iPhone puede no reproducirse en Chrome de Windows. En ese caso la app ofrece descargarlo.

## Datos de ejemplo (opcional)

`supabase/datos-ejemplo.sql` carga:

- 11 equipos de las 4 empresas;
- órdenes, preventivos y reportes;
- dos semanas de producción, ventas y compras;
- una cuenta de ejemplo por perfil, todas con contraseña `ejemplo-1234`:
  - `ej-mantenimiento` (código 1111)
  - `ej-tecnico`
  - `ej-produccion` (código 2222)
  - `ej-administracion`
  - `ej-direccion` (código 3333)
  - `ej-operario`

Para borrar todo eso, entrá como gerente de mantenimiento con tu cuenta real → **Tablero → Borrar datos de ejemplo**, o ejecutá `supabase/borrar-datos-ejemplo.sql`. Lo real no se toca, y las cuentas de ejemplo quedan desactivadas.

## Mantener activa la base

En el plan gratuito, Supabase pausa los proyectos después de 7 días sin uso. El workflow **Mantener activa la base** hace una consulta cada 3 días con los mismos secretos.

---

## Estructura del proyecto

```
index.html, operarios/index.html   entradas de las dos apps
public/                            manifiestos, íconos y service workers de cada app
src/compartido/                    estilos y logos del prototipo, conexión, datos en tiempo real, QR, informe, ingreso
src/gestion/                       app de Gestión (App, ventanas de carga, pantallas por área)
src/operarios/                     app de Operarios
supabase/migrations/               tablas, permisos, funciones, auditoría, archivos y migración de W-Main (en orden)
supabase/instalar.sql              todas las migraciones juntas (npm run sql)
supabase/primera-cuenta.sql        primera cuenta de Dirección
supabase/datos-ejemplo.sql         datos de ejemplo · borrar-datos-ejemplo.sql
supabase/tests/                    prueba de permisos y cuentas de prueba
supabase/w-main-anterior/          SQL de W-Main (referencia)
tests/recorrido.e2e.mjs            recorrido completo en el navegador
referencia/                        prototipo original
```

## Desarrollo

```bash
npm install
cp .env.example .env      # completar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev               # Gestión en http://localhost:5173/ · Operarios en /operarios/
npm run build             # revisa los tipos y arma dist/
npm run sql               # vuelve a armar supabase/instalar.sql después de tocar las migraciones
```

### Pruebas (con Supabase local)

Requisito: Docker.

```bash
mkdir ../sb-local && cd ../sb-local && npx supabase init
cp ../plan-mantenimiento/supabase/migrations/*.sql supabase/migrations/
npx supabase start && cd ../plan-mantenimiento
# con SUPABASE_URL, SUPABASE_ANON_KEY y DB_URL del comando "npx supabase status -o env":
npm run test:permisos                       # 90 casos de permisos
psql "$DB_URL" -f supabase/tests/cuentas-de-prueba.sql
npm run build && npx vite preview --port 4173
APP_URL=http://localhost:4173/ npm run test:e2e   # 32 pasos en el navegador
```

El workflow **Pruebas de permisos** hace lo mismo en GitHub en cada cambio de `supabase/` y en cada pull request.

### Publicar en Vercel o Netlify (alternativa)

Es un sitio estático: build `npm run build`, carpeta `dist`, y las variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_PUBLIC_URL`. No hace falta ninguna regla de redirección.
