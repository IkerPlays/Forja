# 3DS, PC y el bridge

La web no puede hablar directamente con una consola ni con carpetas de tu PC, así que existe el **bridge**
(`bridge/`): un programa que dejas abierto en tu PC (en la misma WiFi que la 3DS). Entra en Forja con tu cuenta, recibe
las órdenes de la web y las ejecuta.

## Instalar el bridge (una vez)

Requiere Node 20 o superior.

```bash
cd bridge
npm install
cp .env.example .env     # en Windows: copy .env.example .env
```

Rellena `.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `FORJA_EMAIL` y `FORJA_PASSWORD` (tu cuenta, que debe ser miembro del estudio) y, para PC, `PC_ROOTS` (carpetas que quieres exponer, separadas por `;`).

Arráncalo con el ID que ves en la web (dispositivo → *Conexión* → *Instrucciones del bridge*):

```bash
node --env-file=.env src/index.mjs <id-del-dispositivo>
```

Puedes pasar varios IDs (una 3DS y tu PC a la vez). Cuando conecta, el punto del dispositivo se pone **verde**.

## 3DS

En la consola necesitas **Luma3DS** (CFW) y dos homebrews/funciones:

| Función en Forja | Qué usa en la 3DS |
|---|---|
| **Archivos** | **ftpd** (homebrew, App de la tarjeta SD). Ábrelo y apunta la IP que muestra. Puerto por defecto 5000. |
| **Mando** | **Input Redirection** de Luma3DS: botón **L+Down+Select** → menú Rosalina → *Input Redirection* → *Start*. Escucha por UDP en el puerto 4950. |
| **Pantalla** | La 3DS no emite vídeo sola. Abre en el PC un **visor de pantalla de 3DS** (p. ej. NTR/Snickerstream) o usa una **capturadora**, y en Forja → 3DS → *Jugar* → **Compartir desde aquí** elige esa ventana o ese dispositivo. La tablet la verá en directo. |

Al añadir la 3DS en Forja indica su **IP** (en ftpd o en Ajustes → Internet). Puedes cambiarla luego en *Conexión → Editar datos*; el bridge la recoge solo.

> **Estado de la compatibilidad**: la comunicación con la consola (FTP y el paquete UDP de Input Redirection) está implementada según el
> protocolo público, pero **no se ha podido probar con una 3DS real**. Botones, Circle Pad y pantalla táctil están cubiertos por pruebas del formato del paquete;
> el **C-Stick y ZL/ZR** (solo New 3DS) usan una disposición experimental. Si algún botón o la precisión táctil no responde como esperas,
> el ajuste está en `buildPacket()` de `bridge/src/ds.mjs`.

## PC

* **Archivos**: solo ves las carpetas de `PC_ROOTS` (se comprueba contra `..` y enlaces simbólicos; hay pruebas en `npm run selftest`). En la carpeta de juegos, el botón **+** junto a cada carpeta la añade a *Juegos*.
* **Pantalla**: abre Forja en el PC → *Juegos → Mi PC → Pantalla → Compartir desde aquí* y elige pantalla o ventana. Desde la tablet entras a *Pantalla* y la ves en directo, con sonido.
* **Ratón y teclado**: botón **Control** sobre el vídeo (requiere el bridge con `robotjs`, que se instala como dependencia opcional; si no se pudo compilar, el resto sigue funcionando). Se puede desactivar con `ALLOW_INPUT=0`.

## Seguridad

* El bridge usa **tu sesión** y las mismas reglas RLS: solo atiende dispositivos de estudios a los que perteneces.
* Qué carpetas del PC se exponen lo decide `PC_ROOTS` **en el PC**, no la web.
* Las órdenes y los canales en tiempo real están limitados a miembros del estudio (políticas en `02_app.sql`).
