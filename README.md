# Forja

El hub personal de tu estudio, para la **tablet** y el **PC**. Un solo sitio para tus tareas, tu 3DS, tus juegos y tu equipo.

| Sección | Qué hace |
|---|---|
| **Inicio** | Tus tareas asignadas, actividad en vivo del estudio, dispositivos en línea y juegos recientes. |
| **Tareas** | Como Trello: varios proyectos, listas, tarjetas (arrastrar y soltar, etiquetas, fechas, asignados, checklist), comentarios y **chat** por proyecto, todo en **tiempo real** y con presencia. Puedes invitar colaboradores **solo a un proyecto**. |
| **3DS** | Conecta tu 3DS **sin PC**: app **Forja3DS** en la consola → explorador de la SD (subir/bajar/renombrar/borrar) desde la tablet. Pantalla en directo y mando en pantalla (el mando necesita el bridge opcional). |
| **Juegos** | Biblioteca del estudio con estado, plataforma, portada y versión. Se **sincroniza con Tareas** (un clic crea el tablero del juego y su progreso se ve en la ficha) y con tu **PC**: explora sus carpetas, importa carpetas como juegos, mira su pantalla en directo y controla ratón y teclado. |
| **Equipo** | Cuentas que gestionan **todo el estudio** (propietario / administrador / miembro). Distinto de los colaboradores de Tareas, que solo ven un proyecto. |

## Cómo está montado

```
Tablet / PC (navegador) ─► Netlify (la web)
        │
        └─► Supabase: Auth · Postgres (RLS) · Realtime · Storage  ◄─ Forja3DS (app en la 3DS, por WiFi/internet)
                                                                   ◄─ pestaña del PC compartiendo una carpeta
```

* **Web**: React + TypeScript + Vite, desplegada en Netlify.
* **Base de datos**: Supabase con **dos** scripts SQL: [`supabase/01_auth.sql`](supabase/01_auth.sql) (**solo auth**) y [`supabase/02_app.sql`](supabase/02_app.sql) (**todo lo demás**).
* **Forja3DS** ([`agent3ds/`](agent3ds)): app homebrew de la 3DS que se conecta a Supabase; se compila en GitHub Actions.
* **Pantalla en directo**: WebRTC entre navegadores (señalización por canales privados de Supabase Realtime).
* **Bridge opcional** ([`bridge/`](bridge)): solo para enviar el **mando a la 3DS** (UDP) y el **ratón/teclado al PC**, que un navegador no puede hacer. No hace falta para archivos ni pantalla.

## Puesta en marcha

Sigue **[docs/CONFIGURACION.md](docs/CONFIGURACION.md)** (Supabase → Netlify → primer arranque, ~10 minutos) y, para la consola y el PC, **[docs/3DS.md](docs/3DS.md)**.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
cd bridge && npm install && npm run selftest   # solo si usas el bridge opcional
```

## Seguridad en una frase

Todo está protegido con **RLS** en Postgres: solo ves lo de tu estudio y los proyectos a los que te invitan; los colaboradores de proyecto no pueden ver el resto del estudio; del PC solo se expone la carpeta que tú eliges en el navegador.
