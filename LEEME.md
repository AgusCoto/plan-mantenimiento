# W-Main: plan de mantenimiento

**W-Main** es la misma aplicación que armaste en Claude (tablero, equipos, fallas con códigos de urgencia, checklists, manuales, informe mensual y etiquetas NFC/QR), convertida en un programa que se instala en Mac y en Windows. Los datos se guardan en una base de datos en la nube (Supabase): tu computadora y la de la oficina técnica ven lo mismo al instante.

```
 Tu computadora (Mac / Windows)      PC oficina técnica        Celular (QR / NFC)
        │  app instalada                    │  app instalada            │  versión web
        └──────────────────────┬────────────┴───────────────────────────┘
                               ▼
                 Supabase (base de datos + usuarios + archivos)
```

---

## Paso 1: crear la base de datos (una sola vez, unos 10 minutos)

1. Entrá a <https://supabase.com>, creá una cuenta gratuita y tocá **New project**.
   - Nombre: `plan-mantenimiento`.
   - Contraseña de la base: generala y guardala.
   - Región: **South America (São Paulo)**.
2. Cuando el proyecto esté listo, entrá a **SQL Editor → New query**, pegá **todo** el contenido de `supabase/esquema.sql` y tocá **Run**. Tiene que decir *Success*.
3. (Opcional) Para cargar los equipos de ejemplo que tenías en Claude, repetí el paso anterior con `supabase/datos-ejemplo.sql`.
4. Entrá a **Authentication → Sign In / Providers → Email** y desactivá **Confirm email**. Así cada persona crea su usuario desde la app sin tener que confirmar un email.
   No genera un riesgo: los usuarios nuevos no ven nada hasta que vos los habilitás.
5. Entrá a **Project Settings → API** y copiá dos datos:
   - **Project URL**, por ejemplo `https://abcdxyz.supabase.co`
   - **anon public key**, una clave larga que empieza con `eyJ...`

## Paso 2: poner esos datos en la app

Abrí `src/config.js` y completá `supabaseUrl` y `supabaseAnonKey`. Así los instaladores ya quedan conectados a tu base.

Si preferís no tocar el archivo, la app los pide la primera vez que se abre en cada computadora.

> La clave *anon* es pública por diseño. Lo que protege los datos son los permisos de la base: sin usuario habilitado no se ve nada.

## Paso 3: generar los instaladores (GitHub, gratis)

Los instaladores se generan en los servidores de GitHub, porque el de Mac solo puede compilarse en una Mac.

1. Creá una cuenta en <https://github.com> y un repositorio nuevo, por ejemplo `plan-mantenimiento`. Puede ser **privado**.
2. Subí todos los archivos de esta carpeta al repositorio, incluida la carpeta oculta `.github`.
   La forma más simple es pedirle a Claude Code que lo suba por vos: conectá tu GitHub y pasale el nombre del repositorio.
3. En el repositorio, entrá a **Actions → Instaladores → Run workflow**. Tarda unos 15 minutos.
4. Cuando termine, entrá a **Releases** (columna derecha) y descargá:
   - **Mac:** `W-Main_<versión>_universal.dmg`, que funciona en Mac Intel y en Apple Silicon (M1–M4).
   - **Windows:** `W-Main_<versión>_x64-setup.exe`.

### Instalar en Mac

Abrí el `.dmg` y arrastrá la app a **Aplicaciones**. Como la app no está firmada con un certificado de Apple pago, la primera vez:

- Hacé **clic derecho → Abrir → Abrir**.
- Si dice que *"está dañada"*, abrí la Terminal y ejecutá:
  `xattr -cr "/Applications/W-Main.app"`

### Instalar en Windows

Ejecutá el `-setup.exe`. Si aparece *"Windows protegió su PC"*, tocá **Más información → Ejecutar de todas formas**. No pide permisos de administrador.

## Paso 4: usuarios y roles

1. **Vos creás tu usuario primero** (Crear usuario) y quedás como **Administrador**.
2. Cada persona de la oficina técnica crea su propio usuario desde la app y queda **Sin acceso**.
3. Habilitalos desde **tu nombre (arriba a la derecha) → Usuarios**:

| Rol | Qué puede hacer |
|---|---|
| **Administrador** | Todo: alta y baja de equipos, manuales, códigos y usuarios |
| **Técnico** | Reportar y cerrar fallas, registrar intervenciones, tareas y checklists, actualizar horómetros |
| **Solo lectura** | Ver todo, sin modificar |
| **Sin acceso** | Nada (usuarios recién creados) |

## Paso 5 (opcional): versión web para el celular, QR y NFC

Las etiquetas QR/NFC abren el equipo en el celular, y para eso hace falta la versión web de la app:

1. En el repositorio entrá a **Settings → Pages → Source: GitHub Actions**.
   En la cuenta gratuita de GitHub, Pages solo funciona si el repositorio es **público**. No expone datos, porque la base exige usuario y contraseña. Si preferís mantenerlo privado, podés subir la carpeta `src` a Netlify o Cloudflare Pages, que son gratis.
2. En **Actions → Version web → Run workflow** se publica la web en `https://TU-USUARIO.github.io/plan-mantenimiento/`.
3. Cargá esa dirección en `publicUrl` dentro de `src/config.js`, o en la app desde **tu nombre → Configuración**. Después generá las etiquetas.

## App en el celular (iPhone y Android), con lectura de QR y NFC

Con la versión web publicada (paso 5), los celulares se conectan así:

1. En la computadora, abrí **Configuración → Celulares**. Aparece un **QR de conexión**.
2. Apuntá la cámara del celular a ese QR y tocá el aviso. Se abre la app ya conectada a tu base.
3. Ingresá con tu usuario.
4. Instalala como app:
   - **iPhone (Safari):** Compartir → **Agregar a inicio**. Si al abrir el ícono pide conexión, tocá **Escanear QR de conexión** y apuntá otra vez al mismo QR.
   - **Android (Chrome):** menú ⋮ → **Instalar aplicación**.

Dentro de la app, la sección **Escanear** (botón azul abajo al centro) sirve para:

- **QR:** abre la cámara y, al leer la etiqueta, va directo a la ficha del equipo. Funciona en iPhone y en Android.
- **NFC:**
  - **Android (Chrome):** tocá **Leer etiqueta NFC** y acercá el celular a la etiqueta. Desde la ficha del equipo también se puede **grabar** la etiqueta NFC.
  - **iPhone:** no hace falta abrir nada. Con la pantalla desbloqueada, acercá la parte de arriba del iPhone a la etiqueta y tocá el aviso; se abre el equipo en Safari. Apple no permite que las apps web lean NFC, por eso se usa la lectura del sistema.
- **Escribir el código:** si la etiqueta está dañada, se puede escribir el código del equipo a mano.

## Sugerencias con IA (opcional)

El botón **"Sugerir ítems con IA"** del checklist del fabricante usa la API de Anthropic. Para activarlo, cargá tu clave (`sk-ant-...`, se obtiene en <https://console.anthropic.com>) en **tu nombre → Configuración**. La clave queda guardada solo en esa computadora y cada sugerencia tiene un costo de centavos de dólar.

## Para tener en cuenta

- **Plan gratuito de Supabase:** si el proyecto pasa **7 días sin uso**, se pausa (los datos no se pierden; se reactiva con **Restore project**). Para evitarlo, la tarea **Actions → Mantener activa la base** consulta la base cada 3 días. Necesita los secretos `SUPABASE_URL` y `SUPABASE_ANON_KEY` en **Settings → Secrets and variables → Actions**. El plan Pro (USD 25/mes) no se pausa y hace copias de seguridad diarias.
- **Copia de seguridad manual:** **Historial → Descargar CSV**, o en Supabase **Table Editor → docs → Export**.
- **Actualizar la app:** cuando haya cambios, se vuelve a ejecutar *Instaladores* y se instala la versión nueva encima. Los datos no se tocan porque están en la nube.

## Estructura del proyecto

| Carpeta / archivo | Qué es |
|---|---|
| `src/index.html` | La aplicación (la misma que estaba en Claude) |
| `src/backend.js` | Conexión con Supabase: datos en tiempo real, usuarios, archivos y descargas |
| `src/config.js` | Datos de conexión |
| `supabase/esquema.sql` | Tablas, permisos por rol y almacenamiento de manuales |
| `supabase/datos-ejemplo.sql` | Datos de ejemplo exportados de la versión en Claude |
| `src-tauri/` | Empaquetado como aplicación de escritorio (Tauri) |
| `.github/workflows/` | Generación automática de instaladores y de la versión web |

Para desarrolladores: `npm install && npm run dev` abre la app en modo desarrollo, y `npm run web` sirve la versión web en <http://localhost:5173>.
