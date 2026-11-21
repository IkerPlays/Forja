# Conectar dispositivos (guía paso a paso)

Forja controla tres tipos de cosas. La web también lo explica con estado en vivo en **Conectar** (menú lateral).

| Dispositivo | Qué necesita | Qué puedes hacer |
|---|---|---|
| **Tablet / navegador** | Nada (instalable como app) | Es el mando a distancia de todo lo demás |
| **PC** | **App de escritorio** (Windows/Linux) | Archivos (carpetas o todo el equipo), pantalla en directo, ratón, teclado y táctil desde la tablet |
| **3DS** | App homebrew **Forja3DS** | Explorar/subir/bajar archivos de la SD; mando y pantalla táctil (con la app de escritorio en tu PC) |

## 1 · PC → app de escritorio

1. Descarga el instalador desde **GitHub → Releases → la última versión (vX.Y.Z)**: `Forja-Setup-….exe` (Windows) o `Forja-….AppImage` (Linux). Windows avisará de «editor desconocido» → *Más información → Ejecutar de todas formas* (la app no está firmada).
2. Ábrela e **inicia sesión** con tu cuenta de Forja. El PC se registra solo y aparece en verde en *Juegos → Mi PC*.
3. En **Este equipo** eliges qué compartes: carpetas concretas o **todo el equipo** (con aviso), si se puede ver la pantalla, si se puede usar ratón/teclado/táctil, y si arranca con el PC.
4. Cierra la ventana: sigue en la **bandeja del sistema** para que el PC esté siempre disponible. Para salir: icono de la bandeja → *Salir*.

Desde la tablet (*Juegos → Mi PC → Pantalla y control*): ves la pantalla en directo y pulsas **Control**: un toque = clic, arrastrar = arrastrar, mantener = clic derecho, dos dedos = desplazar, botón **Teclado** = escribir. Con teclado físico se envía tal cual.

Sin instalar nada puedes compartir una carpeta desde Chrome/Edge (*Mi PC → Archivos → Elegir carpeta*), pero sin pantalla ni control.

## 2 · 3DS → Forja3DS (código, sin contraseñas)

1. **Una vez**: en Supabase, *Authentication → Sign In / Providers → Allow anonymous sign-ins*.
2. Descarga `Forja3DS.cia` (instálala con FBI) o `Forja3DS.3dsx` (cópiala a `/3ds/`) desde *Conectar* o *3DS → Añadir*.
3. Abre **Forja3DS** en la consola con WiFi: muestra un **código de 6 caracteres**.
4. En la web, *3DS → Añadir* → escribe el código. Ya está: archivos de la SD desde la tablet.

La consola entra con una cuenta anónima **limitada a su propio dispositivo** (no ve proyectos ni el resto del estudio). El código caduca a los 30 min y vale una sola vez.

### Si la 3DS no conecta
**Causa encontrada:** el módulo SSL del sistema de la 3DS solo soporta hasta **TLS 1.1** ([3dbrew](https://www.3dbrew.org/wiki/SSL_Services)); Netlify y Supabase exigen TLS 1.2+, así que ninguna versión que usara el SSL del sistema (hasta la v0.3) podía conectar, por mucho que se desactivara la verificación del certificado. Desde la **v0.5** Forja3DS lleva su propio TLS (libcurl + mbedTLS) y valida los certificados con las CA incluidas (si el reloj de la consola está mal, reintenta sin validar).

Si aun así falla, la pantalla inferior muestra el resultado de las dos pruebas (`TLS verificado / sin verificar`) y el código de error. **Plan B:** abre la **app de escritorio** en un PC de la **misma WiFi** (puente local, activado por defecto): la 3DS lo busca sola (UDP 8766) y habla con él por HTTP en tu red. También puedes tocar **«Escribir la IP del PC»** y teclearla con el teclado numérico en pantalla (la consola ya rellena el principio de la IP). En Windows, si no te encuentra, usa en *Este equipo* el botón **Abrir puertos en el cortafuegos**.

### Pantalla de la 3DS en el PC y la tablet (NTR / NTR-HR)
Requisitos: la 3DS con **BootNTR** (idealmente [NTR-HR](https://github.com/xzn/ntr-hr), que da 60–90 fps en New 3DS) y un juego abierto; la **app de escritorio** de Forja abierta en un PC de la misma WiFi.
1. Forja3DS informa de la IP de la consola (o pónla a mano en su ficha).
2. En *3DS → Jugar* pulsa **Ver**. La app de escritorio manda a NTR la orden de «remote play» (TCP 8000), recibe los fotogramas JPEG por UDP 8001, los recompone (las pantallas llegan giradas 90°) y los emite por WebRTC: verás la superior y, debajo, la inferior. **Tocar la inferior = pantalla táctil** de la 3DS.
3. Si no hay imagen: NTR no está activo, PC y 3DS no comparten red, o el cortafuegos bloquea UDP 8001 (usa el botón de *Este equipo*). En NTR-HR (X+Y) también puedes poner la IP del PC y arrancar el remote play desde la propia 3DS.

### Mando de la 3DS
Los navegadores no pueden enviar UDP, así que los botones pasan por la **app de escritorio** del PC (misma WiFi): activa **Input Redirection** en Luma3DS (L+↓+Select → Rosalina → Input Redirection → Start). La IP sale sola de Forja3DS (o de la ficha). Desde la tablet (*3DS → Jugar*): botones, Circle Pad, C-Stick y táctil.

## Actualizaciones automáticas
* **3DS**: al conectarse comprueba `/downloads/latest.json` de la web; si hay versión nueva descarga el `.3dsx` (si la abriste desde el Homebrew Launcher) o instala el `.cia` (si la tienes instalada) y avisa: «Reinicia la app para usarla».
* **PC**: la app de escritorio busca al abrirse y cada 6 horas. Descarga el nuevo «núcleo» (verifica su sha256), y se aplica al reiniciar (sola, en segundo plano, si la ventana está oculta). Se puede forzar en *Este equipo → Actualizaciones*. Solo si cambia el propio motor (Electron) hay que instalar el nuevo instalador.
* La web se actualiza siempre sola con cada despliegue.

## Pantalla y videollamada
Quien comparte (desde el navegador o la app de escritorio) puede incluir **pantalla + cámara + micrófono**: la cámara aparece en un recuadro y el micrófono suena. La pantalla va a hasta 1080p y 60 fps (opción «Nativa» en *Este equipo*), con bitrate alto en red local.

## Seguridad
* Cada agente se autentica con Supabase y las reglas RLS limitan qué ve: miembros del estudio → todo el estudio; consola emparejada → solo su dispositivo.
* El PC solo expone lo que eliges en *Este equipo*. «Todo el equipo» da acceso completo a los miembros del estudio: actívalo solo si confías en ellos.
* El puente local reenvía a Supabase sin añadir credenciales; la consola autentica igual que por internet. Entre la 3DS y el PC el tráfico va sin cifrar por tu WiFi local.
