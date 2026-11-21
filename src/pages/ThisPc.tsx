import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, FolderPlus, HardDrive, Monitor, MousePointer2, Power, Radio, Trash2, Eye, Video } from 'lucide-react'
import { desktop, type DesktopSettings } from '../lib/native'
import { useHostState } from '../components/DesktopHostMount'
import { desktopHost } from '../lib/desktopHost'
import { PageHeader, StatusDot, useToast } from '../components/ui'
import { errMsg } from '../lib/util'

function Toggle({ on, onChange, label, hint, danger }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; danger?: boolean }) {
  return (
    <label className="toggle-row">
      <div><strong>{label}</strong>{hint && <small className={danger ? 'error' : 'muted'}>{hint}</small>}</div>
      <input type="checkbox" role="switch" checked={on} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}

/** Ajustes de la app de escritorio: qué comparte este PC y cómo se enlaza con la 3DS. */
export default function ThisPc() {
  const toast = useToast()
  const host = useHostState()
  const [s, setS] = useState<DesktopSettings | null>(null)
  const [relay, setRelay] = useState<{ on: boolean; addresses: string[]; requests: number; error?: string } | null>(null)
  const [info, setInfo] = useState<{ hostname: string; version: string; shellVersion?: string; input: boolean; lan: string[] } | null>(null)

  const load = useCallback(async () => {
    if (!desktop) return
    setS(await desktop.getSettings()); setRelay(await desktop.relayStatus()); setInfo(await desktop.info())
  }, [])
  useEffect(() => { void load(); const t = setInterval(() => { void desktop?.relayStatus().then(setRelay) }, 5000); return () => clearInterval(t) }, [load])

  if (!desktop) return <div className="page"><p className="muted">Esta sección solo existe en la app de escritorio.</p></div>
  if (!s || !info) return null

  async function set(patch: Parameters<NonNullable<typeof desktop>['setSettings']>[0]) {
    try {
      setS(await desktop!.setSettings(patch))
      if ('allowScreen' in patch) await desktopHost.applySettings()
      setRelay(await desktop!.relayStatus())
    } catch (e) { toast(errMsg(e), 'err') }
  }

  return (
    <div className="page narrow">
      <PageHeader title="Este equipo" sub="Lo que este PC comparte con tu estudio mientras Forja está abierto (también en la bandeja)." />

      <section className="panel">
        <div className="row wrap">
          <StatusDot online={host.running} />
          <strong>{host.running ? `${host.hostname} está conectado a Forja` : host.error ? 'No se pudo conectar' : 'Conectando…'}</strong>
          <div className="spacer" />
          {host.deviceId && <Link className="btn sm" to={`/games/pc/${host.deviceId}`}><Monitor size={14} /> Abrir en Forja</Link>}
        </div>
        {host.error && <p className="error small">{host.error}</p>}
        <p className="muted small">Versión {info.version} · {host.viewers} {host.viewers === 1 ? 'espectador' : 'espectadores'} viendo la pantalla · {host.consoles} 3DS enlazada(s) para el mando</p>
      </section>

      <section className="panel stack">
        <h2><HardDrive size={17} /> Archivos</h2>
        <Toggle on={s.fullAccess} onChange={v => set({ fullAccess: v })} label="Acceso a todo el equipo"
          hint={s.fullAccess ? 'Activado: los miembros del estudio ven y gestionan TODOS tus discos desde Forja (sin subir nada: va directo). Desactívalo para limitarlo a carpetas.' : 'Desactivado: solo las carpetas de abajo.'} danger={s.fullAccess} />
        {!s.fullAccess && (
          <>
            <div className="people">
              {s.roots.map(r => (
                <div key={r} className="person"><HardDrive size={18} /><div><strong>{r}</strong></div>
                  <button className="icon-btn sm" onClick={async () => setS(await desktop!.removeRoot(r))} aria-label="Quitar"><Trash2 size={15} /></button></div>
              ))}
              {!s.roots.length && <p className="muted small">Aún no compartes ninguna carpeta.</p>}
            </div>
            <button className="btn" onClick={async () => setS(await desktop!.pickRoot())}><FolderPlus size={15} /> Añadir carpeta</button>
          </>
        )}
      </section>

      <section className="panel stack">
        <h2><MousePointer2 size={17} /> Control remoto</h2>
        <Toggle on={s.allowScreen} onChange={v => set({ allowScreen: v })} label="Dejar ver la pantalla"
          hint="Los miembros del estudio verán tu pantalla en directo cuando abran este PC en Forja (solo mientras alguien mira)." />
        <Toggle on={s.allowInput} onChange={v => set({ allowInput: v })} label="Dejar usar ratón, teclado y táctil"
          hint={info.input ? 'Desde la tablet puedes tocar la pantalla del PC, escribir y mover el ratón.' : 'No disponible en este sistema (falta el módulo de control).'} />
      </section>

      <section className="panel stack">
        <h2><Video size={17} /> Vídeo y videollamada</h2>
        <Toggle on={s.shareCamera} onChange={v => set({ shareCamera: v })} label="Incluir mi cámara" hint="Quien mire este PC verá también tu cámara en un recuadro (como una videollamada)." />
        <Toggle on={s.shareMic} onChange={v => set({ shareMic: v })} label="Incluir mi micrófono" hint="Se oirá tu voz mientras alguien mira." />
        <label className="toggle-row"><div><strong>Calidad de la pantalla</strong><small className="muted">Fluida: hasta 1080p a 60 fps (recomendada). Nativa: resolución completa; puede ir a menos fps.</small></div>
          <select value={s.screenQuality} onChange={e => set({ screenQuality: e.target.value as 'fluid' | 'native' })}><option value="fluid">Fluida (1080p · 60 fps)</option><option value="native">Nativa</option></select></label>
      </section>

      <section className="panel stack">
        <h2><Radio size={17} /> Puente para la 3DS</h2>
        <Toggle on={s.relay} onChange={v => set({ relay: v })} label="Puente local para la 3DS"
          hint="Si la consola no consigue conectarse a internet por HTTPS, se conecta a este PC por tu WiFi y este PC hace de intermediario. La consola lo encuentra sola." />
        {relay?.on && (
          <div className="callout">
            <strong>Dirección de este PC para la 3DS:</strong> <code>{relay.addresses[0]?.replace('http://', '') || '…'}</code>
            <small className="muted"> · {relay.requests} peticiones atendidas. En la 3DS, si no me encuentra sola, pulsa A y escribe la IP (sin el puerto).</small>
          </div>
        )}
        {(relay?.error || (relay?.on && relay.requests === 0)) && (
          <div className="callout">
            {relay?.error && <p className="error small">{relay.error}</p>}
            <p className="small muted">Si la 3DS no me encuentra, casi siempre es el cortafuegos de Windows (pide permiso la primera vez y suele denegarse en redes «públicas»).</p>
            <button className="btn sm" onClick={async () => { const ok = await desktop!.openFirewall(); toast(ok ? 'Puertos abiertos en el cortafuegos' : 'No se pudo (¿has aceptado el permiso de administrador?)', ok ? 'ok' : 'err') }}>Abrir puertos en el cortafuegos (Windows)</button>
          </div>
        )}
        <p className="muted small">El mando de la 3DS (botones y pantalla táctil) también pasa por este PC cuando la consola tiene IP en su ficha.</p>
      </section>

      <section className="panel stack">
        <h2><RefreshCw size={17} /> Actualizaciones</h2>
        <p className="muted small">Versión {info.version}{info.shellVersion && info.shellVersion !== info.version ? ` (instalador ${info.shellVersion})` : ''}. Forja busca actualizaciones sola al abrirse y cada 6 horas; si hay una, se descarga y se aplica al reiniciar (en segundo plano, sola).</p>
        <div className="row wrap">
          <button className="btn" onClick={async () => {
            const r = await desktop!.checkUpdate()
            if (!r.ok) return toast('No se pudo comprobar: ' + (r.error || ''), 'err')
            if (r.downloaded) toast(`Actualización a v${r.latest} descargada. Reinicia para aplicarla.`)
            else toast(r.latest && r.latest !== r.current ? `Hay v${r.latest} (ya descargada)` : 'Ya tienes la última versión')
          }}><RefreshCw size={14} /> Buscar actualizaciones</button>
          <button className="btn" onClick={() => void desktop!.applyUpdate()}>Reiniciar Forja</button>
        </div>
        <p className="muted small">Se actualiza la lógica (archivos, control, puente 3DS…). La interfaz web se actualiza siempre sola. Si cambia el propio motor (Electron), se avisa de instalar el nuevo instalador.</p>
      </section>

      <section className="panel stack">
        <h2><Power size={17} /> Inicio</h2>
        <Toggle on={s.autostart} onChange={v => set({ autostart: v })} label="Abrir Forja al iniciar sesión en el PC" hint="Se abre minimizado en la bandeja para que el PC esté siempre disponible." />
        <p className="muted small"><Eye size={13} /> Al cerrar la ventana, Forja sigue en la bandeja del sistema. Para salir del todo: icono de la bandeja → Salir.</p>
      </section>
    </div>
  )
}
