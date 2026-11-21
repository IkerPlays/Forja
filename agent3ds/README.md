# Forja3DS

App homebrew (`.3dsx`) que conecta tu Nintendo 3DS con Forja **por internet**, sin PC ni bridge.
Se descarga compilada desde la propia web (dispositivo → *Instrucciones de la 3DS*) o desde GitHub → Releases → *forja3ds-latest*.

## Instalar
1. Copia `Forja3DS.3dsx` a la SD: `/3ds/Forja3DS.3dsx`.
2. Crea `/3ds/forja/config.txt` (la web te lo genera: dispositivo → *Instrucciones de la 3DS*):
   ```
   url=https://xxxx.supabase.co
   anon=sb_publishable_...
   email=cuenta-de-la-consola@ejemplo.com
   password=...
   device=<id del dispositivo>
   ```
   La cuenta debe ser miembro del estudio (crea una solo para la consola).
3. Abre **Forja3DS** desde el Homebrew Launcher. Pantalla superior: estado. **START** sale.

## Qué hace
Inicia sesión, manda un latido cada 15 s y cada 2 s pide órdenes: listar carpetas, descargar/subir archivos
(en trozos de 1 MB, hasta 50 MB), crear carpetas, renombrar y borrar. Todo sobre la tarjeta SD (`sdmc:/`).

## Compilar a mano
Con [devkitPro](https://devkitpro.org) (devkitARM + libctru): `make`.

## Notas
- La verificación del certificado TLS está desactivada (la 3DS no trae las CA actuales). Usa una cuenta propia de la consola.
- No controla botones ni pantalla de otros juegos: eso lo hace el bridge opcional o una app en la red local.
