# App de mantenimiento

App web instalable (PWA) para el mantenimiento de las cuatro empresas del grupo: **INY** (inyectora de plásticos), **LIM** (productos de limpieza), **PIN** (pinturas) y **SAL** (salsas y aderezos). Las empresas se configuran desde la app.

- **Equipos** con código `EMPRESA DUEÑA-TIPO-NÚMERO` (ej.: `PIN-APL-001`), ficha, documentos, historial y etiqueta QR + chip NFC con el mismo enlace.
- **Reporte de falla en 3 toques** para el operario (escanea la etiqueta → qué le pasa → ¿está parada? → enviar), con foto o video.
- **Órdenes de trabajo**: asignación, prioridad (dirección la confirma), fichas, ficha de cierre con causa, fotos y firma del supervisor en equipos críticos, costos y pedidos de compra.
- **Movimientos**: préstamos entre empresas (aprueba dirección), reparación externa, reubicación y baja.
- **Funciona sin señal**: lo cargado queda en el celular y se envía solo al volver la señal.
- **Avisos** push (máquina parada, orden asignada, compras y préstamos por aprobar, órdenes vencidas, resumen diario).
- **Apariencia** editable por el jefe (colores, logo, textos, etiquetas, pantallas de inicio…), con versiones y vuelta atrás.
- **Exportar** todo a Excel o CSV. **Registro de cambios** inmutable.

Tecnología: React + Vite + TypeScript · Supabase (Postgres, Auth, Storage, Edge Functions, Realtime) · Netlify.

---

## Índice

1. [Perfiles y qué puede hacer cada uno](#1-perfiles)
2. [Crear el proyecto de Supabase](#2-crear-el-proyecto-de-supabase) (o usar el de W-Main)
3. [Claves: cuáles son públicas y cuáles no](#3-claves)
4. [Instalar la base (migraciones)](#4-instalar-la-base)
5. [Primera cuenta del jefe](#5-primera-cuenta-del-jefe)
6. [Conectar GitHub](#6-conectar-github)
7. [Publicar en Netlify](#7-publicar-en-netlify)
8. [Avisos push](#8-avisos-push)
9. [Imprimir etiquetas y grabar los chips NFC](#9-imprimir-etiquetas-y-grabar-los-chips-nfc)
10. [Datos de ejemplo](#10-datos-de-ejemplo)
11. [Pasar de W-Main a la app nueva](#11-pasar-de-w-main-a-la-app-nueva)
12. [Exportar y respaldar](#12-exportar-y-respaldar)
13. [Desarrollo y pruebas](#13-desarrollo-y-pruebas)
14. [Estructura del repositorio](#14-estructura)

---

## 1. Perfiles

| Perfil | Qué hace |
|---|---|
| **Jefe de mantenimiento** | Todo: equipos, usuarios, apariencia, movimientos, compras (si se le habilita un tope), datos. |
| **Encargado** | Crea y asigna órdenes, carga fichas, cierra órdenes, descarta reportes, registra la llegada de compras. Marca equipos detenidos u operativos. |
| **Técnico** | Sus órdenes, historial y manuales de los equipos de sus empresas; fichas, lecturas de horómetro y pedidos de repuesto. |
| **Operario** | Escanea la etiqueta, reporta la falla (foto/video/texto) y marca si la máquina está parada. Ve sus reportes. |
| **Dirección** | Informes, pendientes y registro de cambios; **aprueba compras y préstamos**; confirma o cambia la prioridad de las órdenes. No edita la apariencia. |

- Cada usuario accede a **una o varias empresas**; ve solo los equipos cuya empresa dueña o empresa donde está sea una de las suyas.
- Los **manuales y documentos** los ve solo mantenimiento.
- En **equipos críticos**, el supervisor de producción firma el cierre en el celular del técnico (no necesita cuenta).
- Todos los permisos los controla la base (RLS). La app solo muestra lo que la base deja.

## 2. Crear el proyecto de Supabase

> Si ya usás W-Main, **no crees otro**: la app nueva se instala en el mismo proyecto y migra los datos (ver [punto 11](#11-pasar-de-w-main-a-la-app-nueva)).

1. Entrá a <https://supabase.com> → **Sign in** (podés ingresar con GitHub).
2. **New project** → elegí la organización → nombre (ej.: `mantenimiento`), una **contraseña de la base** (guardala en un gestor de contraseñas: no se pone en la app ni en GitHub) y la región **South America (São Paulo)**.
3. Esperá a que termine de crearse (1–2 minutos).
4. **Authentication → Sign In / Providers → Email**: dejá **Email** habilitado y **desactivá «Allow new users to sign up»** (los usuarios los crea el jefe desde la app). Desactivá también **«Confirm email»** si aparece (las cuentas se crean ya confirmadas).

## 3. Claves

En **Project Settings → API** (o **API Keys**) están:

| Dato | ¿Es secreto? | Dónde va |
|---|---|---|
| **Project URL** (`https://xxxx.supabase.co`) | No | Netlify (`VITE_SUPABASE_URL`), GitHub (`SUPABASE_URL`), `avisos-activar.sql` |
| **anon / publishable key** | **No**: es pública por diseño (los permisos los controla la base) | Netlify (`VITE_SUPABASE_ANON_KEY`), GitHub (`SUPABASE_ANON_KEY`), `avisos-activar.sql` |
| **service_role / secret key** | **Sí. Nunca** en la app, en Netlify, en GitHub ni en un chat | No se usa en ningún lado: la función de avisos la recibe sola de Supabase |
| **Contraseña de la base** | **Sí** | Solo para entrar al SQL Editor o a la CLI |
| **Clave privada VAPID** (avisos) | **Sí** | Solo en los secretos de la función «avisos» de Supabase |
| **Clave pública VAPID** | No | Netlify (`VITE_VAPID_PUBLIC_KEY`) y secretos de la función |

El archivo `.env.example` tiene la lista de variables de la app. Para trabajar en tu computadora, copialo como `.env.local` y completalo (está en `.gitignore`: no se sube).

## 4. Instalar la base

Las migraciones están en `supabase/migrations/` (numeradas, se aplican en orden). Para no tener que correrlas de a una, `supabase/instalar.sql` las junta todas en un solo archivo.

**Forma recomendada (sin instalar nada):**

1. Supabase → **SQL Editor** → **New query**.
2. Abrí `supabase/instalar.sql` del repositorio (en GitHub: botón **Raw**, seleccionar todo, copiar), pegalo y tocá **Run**.
3. Tiene que terminar sin errores. Se puede volver a correr: no borra datos.

Esto crea las tablas, permisos, reglas, buckets de Storage (`adjuntos`, `documentos`, `marca`), el tiempo real, el tema de fábrica y las tareas programadas de los avisos.

**Con la CLI (opcional, para quien programa):** `npx supabase login`, `npx supabase link --project-ref <ref>` y `npx supabase db push`.

> Cada vez que se agregue una migración nueva, se vuelve a correr `supabase/instalar.sql` (o `db push`). El archivo se regenera con `npm run sql`; la prueba automática avisa si quedó desactualizado.

## 5. Primera cuenta del jefe

1. SQL Editor → **New query** → pegá el contenido de `supabase/primera-cuenta.sql`.
2. Reemplazá `<usuario>`, `<Nombre y apellido>`, `<clave>` (mínimo 8 caracteres) y el teléfono (o dejalo vacío: `''`).
3. **Run**. Con ese usuario y clave ingresás a la app.
4. Ya en la app: **Mi cuenta → Cambiar la contraseña** (el SQL Editor guarda el historial de lo que corrés).
5. Los demás usuarios se crean desde **Usuarios** (perfil, empresas a las que accede, clave inicial).

Se ingresa con **usuario** (no con email). Si migrás desde W-Main, tu administrador ya queda como jefe (ver punto 11).

## 6. Conectar GitHub

El código vive en este repositorio. Para que las tareas automáticas funcionen:

1. GitHub → repositorio → **Settings → Secrets and variables → Actions**.
2. Pestaña **Secrets** → **New repository secret**: `SUPABASE_URL` (Project URL) y `SUPABASE_ANON_KEY` (clave pública). Los usa «Mantener activa la base», que consulta la base cada 3 días para que el plan gratuito de Supabase no la pause.
3. Pestaña **Variables** → **New repository variable**: `APP_URL` = la dirección de la app en Netlify (ej.: `https://mantenimiento-grupo.netlify.app`). Solo se usa al pasar de W-Main (punto 11).

Tareas automáticas (`.github/workflows/`):

| Tarea | Cuándo | Qué hace |
|---|---|---|
| **Pruebas** | En cada cambio | Levanta un Supabase temporal y prueba los permisos de cada perfil, la función de avisos, los datos de ejemplo y que la app compile. No toca la base real. |
| **Mantener activa la base** | Cada 3 días | Una consulta liviana para que Supabase no pause el proyecto. |
| **Etiquetas viejas a la app nueva** | Solo a mano | Ver punto 11. |

## 7. Publicar en Netlify

Usamos Netlify porque su plan gratuito permite uso comercial (el plan gratuito de Vercel no).

1. Entrá a <https://app.netlify.com> (podés ingresar con GitHub).
2. **Add new site → Import an existing project → GitHub** → autorizá y elegí este repositorio.
3. **Branch to deploy**: `main` (o `app-mantenimiento` para probar antes de pasar a producción). La configuración de compilación sale sola de `netlify.toml` (comando `npm run build`, carpeta `dist`).
4. Antes de publicar, en **Add environment variables** (o después en **Site configuration → Environment variables**):
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = clave pública
   - `VITE_VAPID_PUBLIC_KEY` = clave pública VAPID (punto 8; si todavía no la tenés, se agrega después y se vuelve a publicar)
5. **Deploy**. En **Site configuration → Change site name** elegí una dirección (ej.: `mantenimiento-grupo.netlify.app`) o conectá un dominio propio en **Domain management**.
6. **Importante**: la dirección queda impresa en las etiquetas QR y grabada en los chips NFC. Definila **antes** de imprimir etiquetas. Si después cambia, hay que reimprimir (o mantener la dirección vieja redirigiendo a la nueva).

Cada cambio que se sube a la rama elegida se publica solo. Para instalar la app en el celular: abrí la dirección en Chrome (Android) o Safari (iPhone) → menú → **Agregar a la pantalla de inicio**.

## 8. Avisos push

Los avisos siempre se ven en la **campanita** de la app. Para que además lleguen como notificación al celular (con la app cerrada) hay que hacer esto una vez:

1. **Claves VAPID** — en una computadora con Node instalado: `npx web-push generate-vapid-keys`. Da una **clave pública** y una **privada**.
2. **Publicar la función** — Supabase → **Edge Functions** → **Deploy a new function → Via Editor**. Nombre: `avisos`. Pegá el contenido de `supabase/functions/avisos/index.ts` y **Deploy**. En los ajustes de la función, desactivá **Verify JWT (Enforce JWT verification)**: la llama la propia base; solo envía lo que esté pendiente.
   (Con la CLI: `npx supabase functions deploy avisos --no-verify-jwt`.)
3. **Secretos de la función** — **Edge Functions → Secrets** (o **Manage secrets**): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` = la dirección de la app (ej.: `https://mantenimiento-grupo.netlify.app`).
4. **Conectar la base con la función** — SQL Editor: pegá `supabase/avisos-activar.sql`, reemplazá la URL del proyecto y la clave pública, y **Run**. Al final muestra lo configurado y las dos tareas programadas (avisos diarios a las 8 y reintentos cada 5 minutos).
5. **Netlify** — agregá `VITE_VAPID_PUBLIC_KEY` (la clave pública) y volvé a publicar (**Deploys → Trigger deploy**).
6. **En cada celular** — **Mi cuenta** (o la campanita) → **Activar avisos en este celular**.

**iPhone**: los avisos llegan solo con la app instalada en la pantalla de inicio (Safari → Compartir → **Agregar a inicio**) y con iOS 16.4 o más nuevo. La app muestra esta guía cuando hace falta.

Qué avisa y a quién (siempre solo a quien tiene acceso a la empresa del equipo):

| Aviso | Para |
|---|---|
| Máquina parada | Jefe, encargados y técnicos |
| Reporte nuevo (sin parada) | Jefe y encargados |
| Orden asignada | El técnico asignado |
| Compra o préstamo por aprobar | Dirección |
| Compra o préstamo aprobado/rechazado | Quien lo pidió |
| Orden vencida (todos los días) | El asignado y los encargados |
| Resumen del día (8 h) | Jefe y dirección |

**WhatsApp**: la estructura está lista (cada aviso tiene sus «canales» y los usuarios su teléfono), pero no está activado: requiere una cuenta de WhatsApp Business Cloud y una plantilla aprobada por Meta. Se suma en una etapa siguiente.

## 9. Imprimir etiquetas y grabar los chips NFC

Cada equipo tiene un enlace `https://<dirección de la app>/e/<CÓDIGO>`. El QR y el chip NFC llevan **el mismo enlace**. Al abrirlo:

- el **operario** va directo al reporte de falla de ese equipo;
- el **técnico**, al historial y las órdenes;
- el **jefe**, a la ficha completa;
- **sin sesión**, pide ingresar y después vuelve al equipo.

### Relevar y dar de alta
**Equipos → Relevamiento**, en la máquina, con el celular: foto de la chapa, tipo, empresa dueña, datos y ubicación. Al guardar, la base genera el código y aparece la etiqueta lista para imprimir o grabar.

### Imprimir
1. **Apariencia → Etiqueta**: tamaño (**50×30, 70×40 o 100×50 mm**), campos visibles, logo, y si se imprime en **hoja A4** o **impresora de rollo**.
2. **Equipos → Etiquetas**: filtrá (empresa, tipo, estado), **Elegir los filtrados** (o tildá uno por uno) → **PDF**.
3. Al imprimir el PDF: escala **100 % / Tamaño real** (no «Ajustar a la página»).
   - **A4**: hojas de etiquetas autoadhesivas o papel adhesivo y cortar por las líneas.
   - **Rollo** (Zebra, Brother, etc.): configurá en la impresora el mismo tamaño de etiqueta; el PDF trae una etiqueta por página.
4. Para planta, usá etiquetas de **poliéster o vinilo** (resisten aceite y limpieza) o laminalas.
5. Probá un QR con la cámara del celular antes de pegar todas.

### Grabar el chip NFC
- Hace falta un **celular Android con Chrome** (el iPhone **lee** los chips, pero la web no puede grabarlos).
- Chips **NTAG213 o NTAG215**, del tipo **«anti-metal»** si van sobre chapa.
1. Abrí la app en Chrome en el celular, ingresá como jefe y entrá a la ficha del equipo (o a la pantalla que aparece después del alta).
2. Tocá **Grabar el chip NFC** y acercá el chip a la parte de atrás del celular hasta que diga «Chip NFC grabado».
3. Probá: con la pantalla desbloqueada, acercá el celular al chip → tiene que abrir el equipo.
4. Opcional: para que nadie lo regrabe, se puede bloquear con una app como *NFC Tools* (**es irreversible**: si cambia la dirección de la app, habría que cambiar el chip).

## 10. Datos de ejemplo

Para probar la app con las cuatro empresas: 20 equipos, 6 usuarios de prueba (empiezan con `ej.`), órdenes en distintos estados, una máquina parada, un préstamo en curso, una reparación externa, una orden vencida y compras por aprobar.

- **Cargar** — SQL Editor:
  ```sql
  select public.cargar_datos_ejemplo('una-clave-de-al-menos-8');
  ```
  Usuarios: `ej.encargado`, `ej.tecnico1` (INY y LIM), `ej.tecnico2` (PIN y SAL), `ej.operario1` (INY), `ej.operario2` (SAL), `ej.direccion` (todas), todos con esa clave.
- **Borrar** (antes de empezar a usarla en serio):
  ```sql
  select public.borrar_datos_ejemplo();
  ```
  Si mientras probabas cargaste cosas sobre los datos de ejemplo (por ejemplo, una orden en un equipo de ejemplo), **no borra nada** y te dice qué hay. Si eso también era de prueba:
  ```sql
  select public.borrar_datos_ejemplo(p_tambien_lo_cargado_encima => true);
  ```
  El registro de cambios conserva que se cargaron y se borraron. Las fotos subidas durante las pruebas quedan en **Storage → adjuntos** (se pueden borrar desde ahí).

Estas dos funciones solo se pueden usar desde el SQL Editor: desde la app no.

## 11. Pasar de W-Main a la app nueva

W-Main sigue funcionando hasta que decidas el cambio. La app nueva se instala **en el mismo proyecto de Supabase**, sin tocar las tablas de W-Main, y **copia** sus datos.

1. **Respaldo**: Supabase → **Database → Backups** (o exportá desde W-Main).
2. **Instalar la base** (punto 4) en el proyecto de W-Main.
3. **Migrar los datos** — SQL Editor:
   ```sql
   select public.migrar_w_main();
   ```
   Muestra qué se pasó: equipos (con código nuevo; los códigos viejos se guardan y siguen funcionando), manuales, órdenes, trabajos anteriores (como órdenes cerradas con sus fichas), reportes con fotos y usuarios. Los usuarios desde ahora ingresan con **usuario** (lo que estaba antes de la @ del email) y **la misma contraseña**. El plan de preventivos pasa en la etapa 2.
4. Revisá en **Usuarios** a qué empresas accede cada uno (quedan con todas) y el perfil de cada uno.
5. **Publicar en Netlify** (punto 7) y **avisos** (punto 8). Probá con usuarios reales.
6. **Etiquetas viejas**: las etiquetas de W-Main apuntan a GitHub Pages. Cuando la app nueva esté publicada:
   - Cargá la variable `APP_URL` (punto 6).
   - GitHub → **Actions → Etiquetas viejas a la app nueva → Run workflow**.
   - Desde ese momento, una etiqueta vieja abre el equipo en la app nueva (por su código viejo). Las etiquetas nuevas se pueden ir reimprimiendo de a poco.
   - Esto reemplaza la versión web de W-Main en GitHub Pages; W-Main de escritorio deja de usarse.

## 12. Exportar y respaldar

- **Exportar datos** (jefe y dirección): Excel (.xlsx, una hoja por tabla) o CSV (un archivo por tabla en un .zip). Equipos, órdenes, fichas, costos, compras, movimientos, reportes, usuarios y registro de cambios, con nombres y códigos en vez de identificadores. No incluye fotos ni documentos (quedan en Storage).
- **Supabase** hace copias diarias en los planes pagos (**Database → Backups**). En el plan gratuito, exportá a Excel periódicamente.

## 13. Desarrollo y pruebas

Requisitos: Node 22, Docker (para el Supabase local) y `psql`.

```bash
npm ci
cp .env.example .env.local      # completar con los datos del Supabase local o de prueba
npm run dev                     # http://localhost:5173
npm run build                   # control de tipos y compilación
npm run sql                     # regenera supabase/instalar.sql después de tocar una migración
```

Supabase local: `npx supabase@2.58.5 init`, copiar `supabase/migrations/*` a la carpeta creada, `npx supabase start` y tomar URL, claves y `DB_URL` de `npx supabase status -o env`.

| Prueba | Comando (con `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DB_URL` definidos) |
|---|---|
| Permisos de cada perfil (155 casos) | `npm run test:permisos` (base recién reseteada) |
| Función de avisos | `SERVICE_ROLE_KEY=… npm run test:avisos` (después de la de permisos) |
| Datos de ejemplo | `npm run test:ejemplo` (base recién reseteada) |
| Recorrido completo en el navegador | `APP_URL=http://localhost:5173/ npm run test:e2e [carpeta-capturas]` (base recién reseteada y `npm run dev` andando) |

La de permisos, la de avisos y la de ejemplo corren solas en GitHub (tarea **Pruebas**).

## 14. Estructura

```
src/
  sistema/        tokens de diseño, tema activo en tiempo real, íconos, logos, vocabulario editable
  datos/          conexión con Supabase, sesión, datos en memoria, cola sin señal, avisos push
  comun/          componentes comunes, fotos y videos, QR/NFC, etiquetas PDF, exportar, campanita
  pantallas/      inicio, equipos, órdenes, reportes, operario, movimientos, compras, apariencia, usuarios…
public/           service worker (sin señal y notificaciones), íconos, manifiesto
netlify/          función del manifiesto (nombre e íconos según la apariencia)
supabase/
  migrations/     la base, versionada (tablas, permisos, reglas, avisos, datos de ejemplo, migración de W-Main)
  instalar.sql    todas las migraciones juntas para el SQL Editor (se genera con npm run sql)
  primera-cuenta.sql · avisos-activar.sql
  functions/avisos/   envío de notificaciones push (Edge Function)
  tests/          pruebas de permisos, avisos y datos de ejemplo
  w-main-anterior/    esquema de W-Main (referencia para la migración)
tests/            recorrido completo en el navegador (Playwright)
etiquetas-viejas/ página que lleva las etiquetas de W-Main a la app nueva
referencia/       especificación original
```

### Qué sigue

- **Etapa 2** y **etapa 3**: cada una con su propio plan (preventivos, informes, pantalla de oficina, WhatsApp, etc.).
