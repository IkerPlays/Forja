# Forja

El hub personal de tu estudio, para la **tablet** y el **PC**. Un solo sitio para tus tareas, tu 3DS, tus juegos y tu equipo.

| Sección | Qué hace |
|---|---|
| **Inicio** | Tus tareas asignadas, actividad en vivo del estudio, dispositivos en línea y juegos recientes. |
| **Tareas** | Como Trello: varios proyectos, listas, tarjetas (arrastrar y soltar, etiquetas, fechas, asignados, checklist), comentarios y **chat** por proyecto, todo en **tiempo real** y con presencia. Puedes invitar colaboradores **solo a un proyecto**. |
| **3DS** | Conecta tu 3DS: explorador de archivos (subir/bajar/renombrar/borrar), **mando en pantalla** (botones, Circle Pad, C-Stick, pantalla táctil, teclado y mando USB) y **pantalla en directo**. |
| **Juegos** | Biblioteca del estudio con estado, plataforma, portada y versión. Se **sincroniza con Tareas** (un clic crea el tablero del juego y su progreso se ve en la ficha) y con tu **PC**: explora sus carpetas, importa carpetas como juegos, mira su pantalla en directo y controla ratón y teclado. |
| **Equipo** | Cuentas que gestionan **todo el estudio** (propietario / administrador / miembro). Distinto de los colaboradores de Tareas, que solo ven un proyecto. |

## Cómo está montado

```
Navegador (tablet / PC)  ──►  Netlify (la web)
        │
        ├── Supabase: Auth · Postgres (RLS) · Realtime · Storage
        │
        └── (opcional) Bridge ── corre en tu PC ──► tu 3DS (FTP + UDP) · archivos y ratón/teclado del PC
```

* **Web**: React + TypeScript + Vite, desplegada en Netlify.
* **Base de datos**: Supabase con **dos** scripts SQL, listos para pegar en el SQL Editor:
  1. [`supabase/01_auth.sql`](supabase/01_auth.sql) → **solo autenticación** (perfiles enlazados a `auth.users`).
  2. [`supabase/02_app.sql`](supabase/02_app.sql) → **todo lo demás** (estudio, tareas, juegos, dispositivos, permisos, storage, realtime).
* **Bridge** ([`bridge/`](bridge)): pequeño programa Node que conecta Forja con tu 3DS y con las carpetas/ratón/teclado de tu PC. Lo necesitas solo para 3DS y PC; Tareas, Juegos y Equipo funcionan sin él.
* **Pantalla en directo**: WebRTC entre navegadores (señalización por canales privados de Supabase Realtime). No pasa por ningún servidor tuyo.

## Puesta en marcha

Sigue **[docs/CONFIGURACION.md](docs/CONFIGURACION.md)** (Supabase → Netlify → primer arranque, ~10 minutos) y, para la consola, **[docs/3DS.md](docs/3DS.md)**.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
cd bridge && npm install && npm run selftest
```

## Seguridad en una frase

Todo está protegido con **RLS** en Postgres: solo ves lo de tu estudio y los proyectos a los que te invitan; los colaboradores de proyecto no pueden ver el resto del estudio; las carpetas del PC que se exponen las decides **tú en el bridge** (`PC_ROOTS`), nunca desde la web.
