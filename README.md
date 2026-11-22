# Forja

El hub personal de tu estudio, para la **tablet** y el **PC**. Un solo sitio para tus tareas, tu 3DS, tus juegos y tu equipo.

| Sección | Qué hace |
|---|---|
| **Inicio** | Tus tareas asignadas, actividad en vivo del estudio, dispositivos en línea y juegos recientes. |
| **Tareas** | Como Trello: varios proyectos, listas, tarjetas (arrastrar y soltar, etiquetas, fechas, asignados, checklist), comentarios y **chat** por proyecto, todo en **tiempo real** y con presencia. Puedes invitar colaboradores **solo a un proyecto**. |
| **3DS** | Conecta tu 3DS **sin PC**: app **Forja3DS** en la consola → explorador de la SD desde la tablet. Mando en pantalla (botones, Circle Pad, C-Stick, táctil) con la app de escritorio en tu red. |
| **Juegos** | Biblioteca del estudio con estado, plataforma, portada y versión. Se **sincroniza con Tareas** (un clic crea el tablero del juego y su progreso se ve en la ficha) y con tu **PC**: explora sus carpetas, importa carpetas como juegos, mira su pantalla en directo y controla ratón y teclado. |
| **Equipo** | Cuentas que gestionan **todo el estudio** (propietario / administrador / miembro). Distinto de los colaboradores de Tareas, que solo ven un proyecto. |

### Más funciones
* **Búsqueda global** (`Ctrl/⌘+K` o `/`): páginas, proyectos, tarjetas, juegos y dispositivos.
* **Calendario** con las fechas límite de todos tus proyectos y **Mis tareas** por urgencia (vencidas / hoy / semana).
* **Tablero**: búsqueda y filtros (etiqueta, mis tarjetas, vencidas), **gestor de etiquetas**, descripciones y comentarios en **Markdown**.
* **Notas** del estudio en Markdown, en tiempo real.
* **Importar de Trello** (JSON), exportar un proyecto y **copia de seguridad** del estudio.
* **Notificaciones**: tareas que te asignan, comentarios en tus tarjetas y mensajes del chat (también avisos del sistema).
* **Pantalla remota**: captura de pantalla y grabación en WebM; pantalla + cámara + micrófono; 3DS por NTR con táctil.
* **PC**: bloquear, suspender, reiniciar y apagar a distancia (opcional, desactivado por defecto).
* **Adjuntos** en tarjetas (subir, arrastrar o pegar capturas; miniaturas y descarga) y **@menciones** con autocompletado en comentarios y chat (avisan a la persona).
* **Plantillas** de proyecto (videojuego, sprint, lanzamiento), **duplicar proyecto** y **duplicar / mover tarjetas**.
* **PC**: diagnóstico de cada 3DS (prueba de mando y NTR) y registro de actividad; la web se puede **instalar como app** (PWA).
* Tema **automático / claro / oscuro** y gráfico de tareas completadas.

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
npm test                              # lógica pura (Markdown, Trello)
cd desktop && npm install && npm run selftest
```

## Seguridad en una frase

Todo está protegido con **RLS** en Postgres: solo ves lo de tu estudio y los proyectos a los que te invitan; los colaboradores de proyecto no pueden ver el resto del estudio; del PC solo se expone lo que eliges en *Este equipo*.
