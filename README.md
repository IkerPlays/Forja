# Forja

El hub personal de tu estudio, para la **tablet** y el **PC**. Un solo sitio para tus tareas, tu 3DS, tus juegos y tu equipo.

| Sección | Qué hace |
|---|---|
| **Inicio** | Tus tareas asignadas, actividad en vivo del estudio, dispositivos en línea y juegos recientes. |
| **Tareas** | Como Trello: varios proyectos, listas, tarjetas (arrastrar y soltar, etiquetas, fechas, asignados, checklist), comentarios y **chat** por proyecto, todo en **tiempo real** y con presencia. Puedes invitar colaboradores **solo a un proyecto**. |
| **3DS** | Conecta tu 3DS **sin PC**: app **Forja3DS** en la consola → explorador de la SD desde la tablet. Mando en pantalla (botones, Circle Pad, C-Stick, táctil) con la app de escritorio en tu red. |
| **Juegos** | Biblioteca del estudio con estado, plataforma, portada y versión. Se **sincroniza con Tareas** (un clic crea el tablero del juego y su progreso se ve en la ficha) y con tu **PC**: explora sus carpetas, importa carpetas como juegos, mira su pantalla en directo y controla ratón y teclado. |
| **Equipo** | Cuentas que gestionan **todo el estudio** (propietario / administrador / miembro). Distinto de los colaboradores de Tareas, que solo ven un proyecto. |

## Cómo está montado

```
Tablet / navegador ─► Netlify (la web)
        │
        └─► Supabase: Auth · Postgres (RLS) · Realtime · Storage
               ▲                ▲                         ▲
   App de escritorio (PC)   Forja3DS (3DS)     (si la 3DS no hace TLS: HTTP local vía la app de escritorio)
```

* **Web**: React + TypeScript + Vite en Netlify. Guía de conexión integrada (*Conectar*).
* **Base de datos**: [`supabase/01_auth.sql`](supabase/01_auth.sql) (**solo auth**) y [`supabase/02_app.sql`](supabase/02_app.sql) (**todo lo demás**).
* **App de escritorio** ([`desktop/`](desktop)): Electron. Convierte el PC en dispositivo completo y enlaza la 3DS por la red local.
* **Forja3DS** ([`agent3ds/`](agent3ds)): app homebrew (`.cia` / `.3dsx`) que se compila en GitHub Actions.
* **Pantalla en directo**: WebRTC entre navegadores/app (señalización por canales privados de Supabase Realtime).

## Puesta en marcha

Sigue **[docs/CONFIGURACION.md](docs/CONFIGURACION.md)** (Supabase → Netlify → primer arranque, ~10 minutos) y, para la consola y el PC, **[docs/CONEXIONES.md](docs/CONEXIONES.md)**.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
cd desktop && npm install && npm run selftest
```

## Seguridad en una frase

Todo está protegido con **RLS** en Postgres: solo ves lo de tu estudio y los proyectos a los que te invitan; los colaboradores de proyecto no pueden ver el resto del estudio; del PC solo se expone lo que eliges en *Este equipo*.
