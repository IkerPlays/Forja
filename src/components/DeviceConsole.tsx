import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Activity, FolderOpen, Gamepad2, MonitorPlay, Settings2, Terminal, Trash2, Copy, Download } from 'lucide-react'
import { sb, readConfig } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import PcFolderPanel from './PcFolderPanel'
import { CommandClient, Link } from '../lib/devices'
import type { Device, FileEntry } from '../lib/types'
import type { PadState } from '../lib/pad'
import FileBrowser from './FileBrowser'
import Gamepad3DS from './Gamepad3DS'
import ScreenView from './ScreenView'
import DeviceForm from './DeviceForm'
import { Modal, StatusDot, useTick, useToast } from './ui'
import { cn, errMsg, isOnline, timeAgo } from '../lib/util'

type Tab = 'play' | 'screen' | 'files' | 'setup'

export default function DeviceConsole({ device, onChanged, onDeleted, startPath, dirActions }: {
  device: Device; onChanged: () => void; onDeleted: () => void; startPath?: string
  dirActions?: (e: FileEntry, p: string) => ReactNode
}) {
  const toast = useToast()
  const now = useTick(8000)
  const online = isOnline(device.last_seen, now)
  const is3ds = device.kind === '3ds'
  const [tab, setTab] = useState<Tab>(startPath ? 'files' : is3ds ? 'play' : 'screen')
  const [editing, setEditing] = useState(false)
  const [help, setHelp] = useState(false)

  const client = useMemo(() => new CommandClient(device.id), [device.id])
  useEffect(() => () => client.dispose(), [client])

  // Canal en tiempo real (pantalla + mando). Se abre solo en pestañas que lo usan.
  const needsLink = tab === 'play' || tab === 'screen'
  const [link, setLink] = useState<Link | null>(null)
  const [linkErr, setLinkErr] = useState<string | null>(null)
  const [hasBridge, setHasBridge] = useState(false)
  useEffect(() => {
    if (!needsLink) return
    const l = new Link(device.id, 'viewer')
    setLinkErr(null)
    const off = l.onPresence(peers => setHasBridge(peers.some(p => p.role === 'bridge')))
    l.ready.then(() => setLink(l)).catch(e => setLinkErr(errMsg(e)))
    return () => { off(); l.close(); setLink(null); setHasBridge(false) }
  }, [device.id, needsLink])

  // Mando → bridge (a ~60 Hz como máximo)
  const lastSent = useRef(0)
  const pending = useRef<PadState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendPad = useCallback((s: PadState) => {
    if (!link) return
    const flush = () => { timer.current = null; if (pending.current) { void link.input({ k: 'pad', s: pending.current }); pending.current = null; lastSent.current = performance.now() } }
    pending.current = s
    const wait = 16 - (performance.now() - lastSent.current)
    if (wait <= 0) flush(); else if (!timer.current) timer.current = setTimeout(flush, wait)
  }, [link])

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    ...(is3ds ? [{ id: 'play' as Tab, label: 'Jugar', icon: <Gamepad2 size={16} /> }] : [{ id: 'screen' as Tab, label: 'Pantalla', icon: <MonitorPlay size={16} /> }]),
    { id: 'files', label: 'Archivos', icon: <FolderOpen size={16} /> },
    { id: 'setup', label: 'Conexión', icon: <Settings2 size={16} /> },
  ]

  async function remove() {
    if (!confirm(`¿Eliminar el dispositivo «${device.name}»?`)) return
    const { error } = await sb().from('devices').delete().eq('id', device.id)
    if (error) return toast(errMsg(error), 'err')
    onDeleted()
  }

  const cfg = device.config as Record<string, string | number | undefined>

  return (
    <div className="console">
      <div className="console-head">
        <div>
          <h2><StatusDot online={online} /> {device.name}</h2>
          <small className="muted">
            {is3ds ? `Nintendo 3DS · ${cfg.ip || 'sin IP'}` : 'PC'} · {online ? 'conectado' : device.last_seen ? `visto ${timeAgo(device.last_seen)}` : 'nunca conectado'}
          </small>
        </div>
        {!online && is3ds && <button className="btn sm" onClick={() => setHelp(true)}><Terminal size={14} /> ¿Cómo conecto la 3DS?</button>}
      </div>

      <div className="tabs">
        {tabs.map(t => <button key={t.id} className={cn('tab', tab === t.id && 'on')} onClick={() => setTab(t.id)}>{t.icon} {t.label}</button>)}
      </div>

      <div className="console-body">
        {tab === 'play' && (
          <div className="play">
            {linkErr ? <div className="callout error">{linkErr}</div> : link ? (
              <>
                <ScreenView link={link} kind="3ds" />
                <div>
                  {!hasBridge && (
                    <div className="callout">
                      <strong>El mando necesita un enlace local.</strong> Un navegador no puede enviar los botones a la 3DS por tu WiFi
                      (usa UDP). Si quieres controlarla desde aquí, ejecuta el bridge opcional en un PC de tu red
                      (<code>docs/3DS.md</code>). Archivos y pantalla funcionan sin él.
                    </div>
                  )}
                  <div className={hasBridge ? '' : 'pad-off'}><Gamepad3DS onChange={sendPad} /></div>
                </div>
              </>
            ) : <div className="center-fill muted">Abriendo canal en tiempo real…</div>}
          </div>
        )}
        {tab === 'screen' && (
          linkErr ? <div className="callout error">{linkErr}</div> : link
            ? <ScreenView link={link} kind="pc" remoteControl={hasBridge} />
            : <div className="center-fill muted">Abriendo canal en tiempo real…</div>
        )}
        {tab === 'files' && (
          <>
            {!is3ds && <PcFolderPanel deviceId={device.id} />}
            {is3ds && !online && <OfflineHint onHelp={() => setHelp(true)} />}
            {(is3ds || online) && <FileBrowser device={device} client={client} startPath={startPath} dirActions={dirActions} />}
          </>
        )}
        {tab === 'setup' && (
          <div className="stack">
            <div className="callout">
              <h4><Activity size={15} /> Estado</h4>
              <p>{online ? 'El dispositivo está conectado y atendiendo órdenes.' : is3ds ? 'La 3DS no está conectada: abre la app Forja3DS en la consola (con WiFi).' : 'Este PC no está compartiendo: abre Forja en él, pestaña Archivos, y elige una carpeta.'}</p>
              <div className="row wrap">
                {is3ds && <button className="btn" onClick={() => setHelp(true)}><Terminal size={15} /> Instrucciones de la 3DS</button>}
                <button className="btn" onClick={() => setEditing(true)}><Settings2 size={15} /> Editar datos</button>
                <button className="btn danger" onClick={remove}><Trash2 size={15} /> Eliminar</button>
              </div>
            </div>
            {Object.keys(device.info).length > 0 && (
              <div className="callout"><h4>Información del dispositivo</h4>
                <dl className="kv">{Object.entries(device.info).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl></div>
            )}
          </div>
        )}
      </div>

      {editing && <DeviceForm studioId={device.studio_id} kind={device.kind} device={device} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }} />}
      {help && <AgentHelp device={device} onClose={() => setHelp(false)} />}
    </div>
  )
}

function OfflineHint({ onHelp }: { onHelp: () => void }) {
  return <div className="callout">La 3DS no está conectada, así que no se pueden ver sus archivos. Abre <strong>Forja3DS</strong> en la consola. <button className="link-btn" onClick={onHelp}>Ver cómo instalarla</button></div>
}

/** config.txt listo para la tarjeta SD: ya lleva la URL, la clave pública y el ID de este dispositivo. */
function AgentHelp({ device, onClose }: { device: Device; onClose: () => void }) {
  const { profile } = useAuth()
  const cfg = readConfig()
  const text = [
    '# Forja3DS — copia este archivo a la tarjeta SD en /3ds/forja/config.txt',
    `url=${cfg.url}`, `anon=${cfg.key}`,
    '# Cuenta de Forja que usará la consola (recomendado: una cuenta propia para la 3DS, añadida al estudio en Equipo)',
    `email=${profile?.email ?? ''}`, 'password=', `device=${device.id}`, '',
  ].join('\n')
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'config.txt'
    document.body.appendChild(a); a.click(); a.remove()
  }
  return (
    <Modal title="Conectar la 3DS (sin PC)" onClose={onClose} wide>
      <div className="stack">
        <p className="muted">
          <strong>Forja3DS</strong> es una app homebrew que se conecta <em>desde la consola</em> a internet (WiFi) y habla con Forja.
          No necesitas ordenador ni estar en la misma red que la tablet.
        </p>
        <ol className="steps">
          <li>Descarga <code>Forja3DS.3dsx</code> (GitHub → Actions → <em>Build Forja3DS</em> → artefacto, o la última Release) y cópiala a la SD en <code>/3ds/</code>.</li>
          <li>Descarga este <code>config.txt</code>, <strong>escribe la contraseña</strong> y cópialo a la SD en <code>/3ds/forja/config.txt</code>. <button className="btn sm" onClick={download}><Download size={14} /> config.txt</button></li>
          <li>En la 3DS abre <strong>Forja3DS</strong> desde el Homebrew Launcher. Cuando aparezca «Conectado», el punto de aquí se pone verde.</li>
        </ol>
        <p className="muted small">La cuenta debe ser miembro del estudio. Lo ideal es crear una cuenta solo para la consola (Equipo → Añadir) y usar esa en <code>config.txt</code>, para no dejar tu contraseña personal en la SD.</p>
        <p className="muted small">ID del dispositivo: <code>{device.id}</code></p>
      </div>
    </Modal>
  )
}
