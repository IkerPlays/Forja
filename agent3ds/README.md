# Forja3DS

App homebrew (`.3dsx` / `.cia`) que conecta tu Nintendo 3DS con Forja **por internet**, sin PC y sin escribir contraseñas.
Descárgala desde la web (3DS → dispositivo → *Instalar / vincular la 3DS*) o desde GitHub → Releases (última versión vX.Y.Z).

## Usar
1. Instala `Forja3DS.cia` con FBI (queda en el menú HOME) **o** copia `Forja3DS.3dsx` a `/3ds/` en la SD.
2. Abre la app con WiFi. Muestra un **código de 6 caracteres**.
3. En Forja (web): **3DS → Añadir**, escribe el código. Listo: el punto del dispositivo se pone verde.

No hay `config.txt`: la app lee la URL y la clave públicas de la propia web (`/forja-config.json`) y entra con una **cuenta anónima** que queda vinculada solo a tu dispositivo (no ve proyectos ni el resto del estudio).
La sesión se guarda en `/3ds/forja/session.txt`; si la borras, la app pide un código nuevo.

**Requisito en Supabase (una vez):** Authentication → Sign In / Providers → **Allow anonymous sign-ins** activado.

## config.txt (opcional, `/3ds/forja/config.txt`)
```
site=https://otra-web.ejemplo.com   # si no usas forja-hub.netlify.app
url=...   anon=...                  # si no quieres leerlos de la web
email=... password=... device=...   # modo clásico, sin emparejado
```

## Qué hace
Inicia sesión, manda un latido cada 15 s y cada 2 s pide órdenes: listar carpetas, descargar/subir archivos
(en trozos de 1 MB, hasta 50 MB), crear carpetas, renombrar y borrar. Todo sobre la tarjeta SD (`sdmc:/`).
Si desvinculas la consola desde la web, vuelve a mostrar un código.

## Compilar a mano
Con [devkitPro](https://devkitpro.org) (devkitARM + libctru): `make` (.3dsx) y `make cia` (necesita `makerom` y `bannertool`; la CI los compila).
Para apuntar a otra web: `make CFLAGS_EXTRA=...` o edita `DEFAULT_SITE` en `source/main.c`.

## Notas

- No controla botones ni pantalla de otros juegos: el mando y la pantalla táctil los envía la app de escritorio de Forja desde tu PC.

## TLS y conexión (v0.5+)
El SSL del sistema de la 3DS solo llega a TLS 1.1 (3dbrew), por eso las versiones con `httpc` no podían conectar con servidores modernos. Ahora el TLS 1.2 va dentro de la app (libcurl + mbedTLS, CA de Mozilla incluidas; si falla la validación reintenta sin validar). Si no hay HTTPS, busca la app de escritorio por la WiFi o deja escribir su IP con un teclado numérico propio.
La URL de Supabase se integra al compilar (es pública), así que no depende de la web. Se autoactualiza desde `/downloads/latest.json`.
