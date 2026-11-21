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

### Si la 3DS no conecta (código `D8A0A03C`, «Sin conexión»)
Es un problema de certificados HTTPS de la consola. Abre la **app de escritorio** en un PC de la **misma WiFi** (con *Puente local para la 3DS* activado, que viene activado): la 3DS la encuentra sola (UDP 8766) y se conecta a través del PC por HTTP plano en tu red local. En la pantalla de la 3DS verás el servidor como `http://192.168.x.x:8765`.

### Mando y pantalla táctil de la 3DS
Los navegadores no pueden enviar UDP. Con la **app de escritorio abierta en un PC de tu red**: pon la **IP de la 3DS** en su ficha (Ajustes → Internet → Ajustes de conexión) y activa **Input Redirection** en Luma3DS (L+↓+Select → Rosalina → Input Redirection → Start). Desde la tablet (*3DS → Jugar*) tienes botones, Circle Pad, C-Stick y pantalla táctil.

### Pantalla de la 3DS
La consola no emite vídeo. Abre un visor de pantalla de 3DS (NTR/Snickerstream) o una capturadora en un PC y compártelo (*Jugar → Compartir desde aquí*).

> **Honestidad sobre las pruebas:** todo se compila y pasa pruebas automáticas (rutas seguras, protocolo del mando, puente local), pero no se ha podido probar con una 3DS ni con un PC real. Si algo falla, el estado y los errores salen en la pantalla superior de la 3DS y en *Este equipo*.

## Seguridad
* Cada agente se autentica con Supabase y las reglas RLS limitan qué ve: miembros del estudio → todo el estudio; consola emparejada → solo su dispositivo.
* El PC solo expone lo que eliges en *Este equipo*. «Todo el equipo» da acceso completo a los miembros del estudio: actívalo solo si confías en ellos.
* El puente local reenvía a Supabase sin añadir credenciales; la consola autentica igual que por internet. Entre la 3DS y el PC el tráfico va sin cifrar por tu WiFi local.
