# Configuración paso a paso

## 1 · Supabase (base de datos)

Usa un proyecto de Supabase **propio de Forja** (no lo mezcles con otros).

1. **SQL Editor → New query**, pega el contenido de [`supabase/01_auth.sql`](../supabase/01_auth.sql) y pulsa **Run**.
2. Nueva query con [`supabase/02_app.sql`](../supabase/02_app.sql) → **Run**.
   Ambos son idempotentes: puedes volver a ejecutarlos sin romper nada (por ejemplo tras una actualización).
3. **Project Settings → API**: copia
   * **Project URL** (`https://xxxx.supabase.co`)
   * la clave **anon / publishable** (es pública por diseño; la seguridad la ponen las políticas RLS).
4. **Authentication → Providers**: el correo + contraseña ya viene activo.
   * Si quieres entrar sin confirmar correo mientras pruebas: Authentication → Sign In / Providers → Email → desactiva *Confirm email*.
5. **Authentication → URL Configuration**: en *Site URL* y *Redirect URLs* pon la URL de tu web de Netlify (y `http://localhost:5173` si desarrollas).
6. **Realtime** (Project Settings → Realtime): comprueba que *Allow public access* esté **desactivado** (así solo funcionan los canales privados que protege `02_app.sql`).

## 2 · Netlify (la web)

1. **Add new site → Import from Git** y elige este repositorio (rama `main`). Netlify lee `netlify.toml` solo (`npm run build`, carpeta `dist`).
2. **Site configuration → Environment variables**:

   | Variable | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | tu Project URL |
   | `VITE_SUPABASE_ANON_KEY` | tu clave anon/publishable |
   | `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS` | *(opcional)* servidor TURN para ver la pantalla fuera de tu WiFi |

   Si no las pones, la app te pide la URL y la clave la primera vez en cada navegador (se guardan localmente).
3. Despliega. Abre la URL y **instala la app** (Chrome/Edge: icono de instalar; tablet: *Añadir a pantalla de inicio*).

## 3 · Primer uso

1. **Crear cuenta** → te pide crear tu **estudio**.
2. **Equipo → Añadir** para dar acceso total a otras cuentas (si aún no tienen cuenta, entran solas al registrarse con ese correo).
3. En un tablero: **Colaboradores** para invitar a alguien **solo a ese proyecto**.
4. **3DS** → *Añadir* y sigue *¿Cómo conecto la 3DS?*; **Juegos → Mi PC** → *Añadir* y *Elegir carpeta* (ver [3DS.md](3DS.md)).

## Notas

* **Archivos grandes**: las transferencias pasan por Supabase Storage (bucket privado `transfers`); el plan gratuito limita a **50 MB por archivo**. Los archivos se borran tras transferirse.
* **Ver la pantalla fuera de casa**: WebRTC conecta directo entre dispositivos; en la misma red funciona sin más. Entre redes distintas puede hacer falta TURN (`VITE_TURN_*`).
* **Copia de seguridad**: Supabase → Database → Backups. Los scripts SQL del repositorio reconstruyen la estructura completa.
