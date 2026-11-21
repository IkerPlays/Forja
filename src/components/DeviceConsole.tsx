import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Activity, FolderOpen, Gamepad2, MonitorPlay, Settings2, Terminal, Trash2, Copy } from 'lucide-react'
import { sb } from '../lib/supabase'
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
  useEffect(() => {
    if (!needsLink) return
    const l = new Link(device.id, 'viewer')
    setLinkErr(null)
    l.ready.then(() => setLink(l)).catch(e => setLinkErr(errMsg(e)))
    return () => { l.close(); setLink(null) }
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
            {is3ds ? `Nintendo 3DS · ${cfg.ip || 'sin IP'}` : 'PC'} · {online ? 'bridge conectado' : device.last_seen ? `bridge visto ${timeAgo(device.last_seen)}` : 'bridge sin conectar nunca'}
          </small>
        </div>
        {!online && <button className="btn sm" onClick={() => setHelp(true)}><Terminal size={14} /> ¿Cómo conecto el bridge?</button>}
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
                <Gamepad3DS onChange={sendPad} />
              </>
            ) : <div className="center-fill muted">Abriendo canal en tiempo real…</div>}
          </div>
        )}
        {tab === 'screen' && (
          linkErr ? <div className="callout error">{linkErr}</div> : link
            ? <ScreenView link={link} kind="pc" remoteControl />
            : <div className="center-fill muted">Abriendo canal en tiempo real…</div>
        )}
        {tab === 'files' && (
          !online && is3ds === false ? <OfflineHint onHelp={() => setHelp(true)} /> :
          <FileBrowser device={device} client={client} startPath={startPath} dirActions={dirActions} />
        )}
        {tab === 'setup' && (
          <div className="stack">
            <div className="callout">
              <h4><Activity size={15} /> Estado</h4>
              <p>{online ? 'El bridge está conectado y atendiendo este dispositivo.' : 'El bridge no está conectado. Los archivos, el mando y el control no funcionarán hasta que lo ejecutes.'}</p>
              <div className="row wrap">
                <button className="btn" onClick={() => setHelp(true)}><Terminal size={15} /> Instrucciones del bridge</button>
                <button className="btn" onClick={() => setEditing(true)}><Settings2 size={15} /> Editar datos</button>
                <button className="btn danger" onClick={remove}><Trash2 size={15} /> Eliminar</button>
              </div>
            </div>
            {Object.keys(device.info).length > 0 && (
              <div className="callout"><h4>Información del equipo del bridge</h4>
                <dl className="kv">{Object.entries(device.info).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl></div>
            )}
          </div>
        )}
      </div>

      {editing && <DeviceForm studioId={device.studio_id} kind={device.kind} device={device} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }} />}
      {help && <BridgeHelp device={device} onClose={() => setHelp(false)} />}
    </div>
  )
}

function OfflineHint({ onHelp }: { onHelp: () => void }) {
  return <div className="callout">El bridge de este PC no está conectado, así que no se pueden ver sus archivos. <button className="link-btn" onClick={onHelp}>Ver cómo arrancarlo</button></div>
}

function BridgeHelp({ device, onClose }: { device: Device; onClose: () => void }) {
  const toast = useToast()
  const cmd = `node --env-file=.env src/index.mjs ${device.id}`
  const copy = (t: string) => { void navigator.clipboard.writeText(t).then(() => toast('Copiado')) }
  return (
    <Modal title="Conectar el bridge" onClose={onClose} wide>
      <div className="stack">
        <p className="muted">
          El <strong>bridge</strong> es un programita (carpeta <code>bridge/</code> del repositorio) que corre en tu PC.
          Hace de puente entre Forja y {device.kind === '3ds' ? 'tu 3DS (por tu red WiFi)' : 'los archivos y el ratón/teclado de ese PC'}.
        </p>
        <ol className="steps">
          <li>En el PC: <code>cd bridge &amp;&amp; npm install</code></li>
          <li>Copia <code>.env.example</code> a <code>.env</code> y rellena tu URL/clave de Supabase y tu correo/contraseña de Forja{device.kind === 'pc' ? ' y las carpetas que quieres exponer (PC_ROOTS)' : ''}.</li>
          <li>Arranca: <button className="code-copy" onClick={() => copy(cmd)}><code>{cmd}</code> <Copy size={13} /></button></li>
        </ol>
        {device.kind === '3ds' && <p className="muted small">En la 3DS abre <strong>ftpd</strong> (archivos) y activa <em>Input Redirection</em> en el menú Rosalina de Luma3DS (mando). Detalles en <code>docs/3DS.md</code>.</p>}
        <p className="muted small">ID del dispositivo: <code>{device.id}</code></p>
      </div>
    </Modal>
  )
}
