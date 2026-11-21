# Forja para escritorio

Electron: abre la web de Forja y añade lo que un navegador no puede hacer — archivos reales del PC, pantalla, ratón/teclado, y puente local para la 3DS.
Instaladores en GitHub → Releases → `desktop-latest` (Windows `.exe`, Linux `.AppImage`).

```bash
npm install
npm run selftest   # pruebas sin interfaz (rutas, mando 3DS, puente local)
npm start          # arranca (FORJA_URL=… para otra web)
npm run dist       # instalador en dist/
```

- `src/main.js` ventana, bandeja, ajustes, IPC, captura de pantalla sin selector.
- `src/fsroots.js` archivos limitados a carpetas permitidas (sin `..` ni enlaces simbólicos).
- `src/input.js` ratón/teclado (nut-js). `src/pad.js` mando 3DS por UDP. `src/relay.js` puente HTTP + descubrimiento UDP.
- La lógica de órdenes (listar, subir, bajar…) y la pantalla viven en la web (`src/lib/desktopHost.ts`) y llaman a estas funciones por `window.forjaDesktop`.
