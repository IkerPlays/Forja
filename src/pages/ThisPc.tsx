import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderPlus, HardDrive, Monitor, MousePointer2, Power, Radio, Trash2, Eye } from 'lucide-react'
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
  const [relay, setRelay] = useState<{ on: boolean; addresses: string[]; requests: number } | null>(null)
  const [info, setInfo] = useState<{ hostname: string; version: string; input: boolean; lan: string[] } | null>(null)

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
          hint={s.fullAccess ? 'Cualquier miembro del estudio puede ver, subir, renombrar y borrar archivos de TODOS tus discos.' : 'Desactivado: solo las carpetas de abajo.'} danger={s.fullAccess} />
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
        <h2><Radio size={17} /> Puente para la 3DS</h2>
        <Toggle on={s.relay} onChange={v => set({ relay: v })} label="Puente local para la 3DS"
          hint="Si la consola no consigue conectarse a internet por HTTPS, se conecta a este PC por tu WiFi y este PC hace de intermediario. La consola lo encuentra sola." />
        {relay?.on && <p className="muted small">Escuchando en {relay.addresses.join(' · ') || '…'} · {relay.requests} peticiones atendidas</p>}
        <p className="muted small">El mando de la 3DS (botones y pantalla táctil) también pasa por este PC cuando la consola tiene IP en su ficha.</p>
      </section>

      <section className="panel stack">
        <h2><Power size={17} /> Inicio</h2>
        <Toggle on={s.autostart} onChange={v => set({ autostart: v })} label="Abrir Forja al iniciar sesión en el PC" hint="Se abre minimizado en la bandeja para que el PC esté siempre disponible." />
        <p className="muted small"><Eye size={13} /> Al cerrar la ventana, Forja sigue en la bandeja del sistema. Para salir del todo: icono de la bandeja → Salir.</p>
      </section>
    </div>
  )
}
