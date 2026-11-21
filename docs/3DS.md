# 3DS y PC — sin bridge

Un navegador no puede abrir FTP ni UDP, ni llamar a una IP de tu WiFi (HTTPS lo bloquea). Por eso **el dispositivo se conecta hacia fuera**, a Supabase, y Forja le manda las órdenes por ahí. No hace falta ordenador intermedio ni estar en la misma red.

| | 3DS | PC |
|---|---|---|
| **Archivos** | App **Forja3DS** en la consola (WiFi) | La pestaña de Forja en el PC comparte **una carpeta** (Chrome/Edge) |
| **Pantalla en directo** | Compartir ventana/capturadora desde un navegador | Compartir pantalla desde el navegador del PC |
| **Mando / ratón y teclado** | Solo con el bridge opcional (ver abajo) | Solo con el bridge opcional |

## 3DS → Forja3DS (con código, como las apps de TV)

1. **Una vez, en Supabase:** Authentication → Sign In / Providers → activa **Allow anonymous sign-ins**.
2. En Forja: **3DS → Añadir** (o en un dispositivo: *Instalar / vincular la 3DS*). Descarga `Forja3DS.cia` (instálala con FBI) o `Forja3DS.3dsx` (cópiala a `/3ds/` en la SD).
3. Abre **Forja3DS** en la consola con WiFi: te muestra un **código de 6 caracteres**.
4. Escríbelo en la web. La consola queda vinculada y el punto del dispositivo se pone verde: ya puedes explorar, subir, bajar, renombrar y borrar archivos de la SD.

No hay contraseñas ni `config.txt`: la app lee la URL y la clave públicas de la web y entra con una cuenta anónima que **solo puede acceder a ese dispositivo** (no ve tus proyectos, juegos ni el resto del estudio). Si quieres desvincularla o pierdes la sesión, vuelve a vincularla con un código nuevo.

Detalles: [`agent3ds/README.md`](../agent3ds/README.md). Se compila solo en GitHub Actions (*Build Forja3DS*) y se publica en Releases (`forja3ds-latest`).

Límites: archivos de hasta **50 MB**, en trozos de 1 MB por Supabase Storage. La 3DS usa WiFi 802.11g, así que 50 MB tardan minutos. La verificación del certificado TLS está desactivada (la consola no trae las CA actuales).

> **No probado en hardware.** El agente compila con devkitARM/libctru (lo comprueba la CI), pero no he podido ejecutarlo en una 3DS real. Si algo falla (conexión TLS, tiempos, nombres con caracteres raros), el estado y el último error se ven en la pantalla superior; pásame lo que ponga.

## PC → carpeta compartida desde el navegador

*Juegos → Mi PC → Archivos → **Elegir carpeta*** (Chrome o Edge de escritorio). Solo se comparte esa carpeta y solo mientras la pestaña esté abierta; el navegador pide permiso y puede volver a pedirlo al reabrir (*Reanudar*). En la carpeta de juegos, el botón **+** junto a cada subcarpeta la añade a *Juegos*.

Limitación: los navegadores no pueden renombrar carpetas en todas las versiones y no pueden mover el ratón del sistema.

## Pantalla en directo

Por WebRTC entre navegadores (la señalización pasa por Supabase Realtime):
* **PC**: en el PC, *Pantalla → Compartir desde aquí* → pantalla o ventana. Desde la tablet: *Pantalla*.
* **3DS**: la consola no emite vídeo sola. Abre un visor de pantalla de 3DS (NTR/Snickerstream…) o usa una capturadora en un PC y compártelo igual (*Jugar → Compartir desde aquí*).

## Mando de la 3DS y control del PC (opcional: bridge)

Enviar botones a la 3DS necesita **UDP en tu red local** (Input Redirection de Luma3DS, puerto 4950) y mover el ratón del PC necesita acceso al sistema. Ninguna de las dos cosas es posible desde una página web, así que existe el **bridge opcional** (`bridge/`, Node): un programa que dejas abierto en un PC de la misma WiFi y que solo reenvía el mando y el ratón/teclado. **No es necesario para archivos ni pantalla.**

```bash
cd bridge && npm install && cp .env.example .env   # rellena .env
node --env-file=.env src/index.mjs <id-del-dispositivo>
```

Si no lo ejecutas, el mando aparece atenuado con un aviso. (Si usas Forja3DS para archivos, no ejecutes además el bridge con ese mismo ID de 3DS: se pisarían las órdenes; para el mando basta el canal en tiempo real.)

> Una app nativa para la tablet (Android) podría enviar esos UDP sin PC; es el siguiente paso si lo quieres.

## Seguridad

* La 3DS usa una cuenta anónima enlazada a su dispositivo (tabla `device_links`): las políticas RLS solo le dejan sus órdenes y los archivos en tránsito de ese dispositivo. El código de emparejado caduca a los 30 min y solo vale una vez.
* El PC solo expone la carpeta que eliges; el navegador valida cada ruta (sin `..`).
* Las órdenes y los canales en tiempo real están limitados a miembros del estudio (`02_app.sql`).
