import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Power, ChevronDown, Activity, FolderOpen, Gamepad2, MonitorPlay, Settings2, Terminal, Trash2, Copy, Download } from 'lucide-react'
import { sb, readConfig } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import PcFolderPanel from './PcFolderPanel'
import { Link as RouterLink } from 'react-router-dom'
import { isDesktop } from '../lib/native'
import { useHostState } from './DesktopHostMount'
import { CommandClient, Link } from '../lib/devices'
import { openP2P, type P2PClient } from '../lib/p2p'
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
  const host = useHostState()
  const isLocal = isDesktop && host.deviceId === device.id   // el PC en el que estás ahora mismo
  const [tab, setTab] = useState<Tab>(startPath || isLocal ? 'files' : is3ds ? 'play' : 'screen')
  const [editing, setEditing] = useState(false)
  const [power, setPower] = useState(false)
  const [help, setHelp] = useState(false)

  const client = useMemo(() => new CommandClient(device.id), [device.id])
  useEffect(() => () => client.dispose(), [client])

  // Canal en tiempo real (pantalla + mando). Se abre solo en pestañas que lo usan.
  const needsLink = tab === 'play' || tab === 'screen' || (tab === 'files' && !is3ds)
  const [link, setLink] = useState<Link | null>(null)
  const [linkErr, setLinkErr] = useState<string | null>(null)
  const [hasBridge, setHasBridge] = useState(false)
  const [filesHost, setFilesHost] = useState<string | null>(null)
  const [p2p, setP2p] = useState<P2PClient | null>(null)
  useEffect(() => {
    if (!needsLink) return
    const l = new Link(device.id, 'viewer')
    setLinkErr(null)
    const off = l.onPresence(peers => { setHasBridge(peers.some(p => p.roles.includes('bridge'))); setFilesHost(peers.find(p => p.roles.includes('files'))?.id ?? null) })
    l.ready.then(() => setLink(l)).catch(e => setLinkErr(errMsg(e)))
    return () => { off(); l.close(); setLink(null); setHasBridge(false); setFilesHost(null) }
  }, [device.id, needsLink])

  // Archivos directos con el PC (WebRTC): sin subir nada al servidor
  useEffect(() => {
    if (!link || !filesHost || tab !== 'files') return
    let alive = true, client: P2PClient | null = null
    openP2P(link, filesHost).then(c => { if (!alive) { c.close(); return } client = c; c.onClose = () => setP2p(null); setP2p(c) }).catch(() => { if (alive) setP2p(null) })
    return () => { alive = false; client?.close(); setP2p(null) }
  }, [link, filesHost, tab])

  // Mando → bridge (a ~60 Hz como máximo)
  const lastSent = useRef(0)
  const pending = useRef<PadState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPad = useRef<PadState>({ b: 0, cx: 0, cy: 0, sx: 0, sy: 0, t: null })
  const sendPad = useCallback((s: PadState) => {
    lastPad.current = s
    if (!link) return
    const flush = () => { timer.current = null; if (pending.current) { void link.input({ k: 'pad', s: pending.current }); pending.current = null; lastSent.current = performance.now() } }
    pending.current = s
    const wait = 16 - (performance.now() - lastSent.current)
    if (wait <= 0) flush(); else if (!timer.current) timer.current = setTimeout(flush, wait)
  }, [link])

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    ...(is3ds ? [{ id: 'play' as Tab, label: 'Jugar', icon: <Gamepad2 size={16} /> }] : isLocal ? [] : [{ id: 'screen' as Tab, label: 'Pantalla y control', icon: <MonitorPlay size={16} /> }]),
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
        {online && !is3ds && !isLocal && (
          <div className="menu-wrap">
            <button className="btn sm" onClick={() => setPower(p => !p)}><Power size={14} /> Energía</button>
            {power && (
              <div className="menu right" onMouseLeave={() => setPower(false)}>
                {([['lock', 'Bloquear sesión'], ['sleep', 'Suspender'], ['restart', 'Reiniciar'], ['shutdown', 'Apagar']] as const).map(([a, label]) => (
                  <button key={a} className={a === 'restart' || a === 'shutdown' ? 'danger' : ''} onClick={async () => {
                    setPower(false)
                    if (!confirm(`¿${label} «${device.name}»?`)) return
                    try { await client.run('power', { type: a }, 30_000); toast(`${label}: orden enviada`) } catch (e) { toast(errMsg(e), 'err') }
                  }}>{label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {!online && !is3ds && <RouterLink className="btn sm" to="/connect"><Terminal size={14} /> ¿Cómo conecto este PC?</RouterLink>}
      </div>

      <div className="tabs">
        {tabs.map(t => <button key={t.id} className={cn('tab', tab === t.id && 'on')} onClick={() => setTab(t.id)}>{t.icon} {t.label}</button>)}
      </div>

      <div className="console-body">
        {tab === 'play' && (
          <div className="play">
            {linkErr ? <div className="callout error">{linkErr}</div> : link ? (
              <>
                <details className="faq howto"><summary>¿Cómo veo la pantalla de la 3DS y uso el mando?<ChevronDown size={15} /></summary>
                  <ol className="muted small">
                    <li><strong>Pantalla:</strong> en la 3DS ejecuta <strong>BootNTR</strong> (NTR-HR) y abre un juego. Deja la <strong>app de escritorio de Forja</strong> abierta en un PC de la misma WiFi: al pulsar «Ver», Forja le pide a NTR que emita y verás las dos pantallas. Tocar la inferior = táctil.</li>
                    <li><strong>Mando:</strong> en Luma3DS activa <em>Input Redirection</em> (L+↓+Select → Rosalina). La IP de la 3DS la informa Forja3DS sola (o ponla en la ficha).</li>
                    <li>Si no hay imagen: comprueba que NTR está activo, que el PC y la 3DS comparten WiFi y que el cortafuegos permite UDP 8001 (Este equipo → botón de cortafuegos).</li>
                  </ol></details>
                <ScreenView link={link} kind="3ds" onTouch3ds={hasBridge ? (t => sendPad({ ...lastPad.current, t })) : undefined} />
                <div>
                  {!hasBridge && (
                    <div className="callout">
                      <strong>El mando necesita la app de escritorio.</strong> Un navegador no puede enviar los botones a la 3DS por tu WiFi (usa UDP).
                      Abre <strong>Forja para escritorio</strong> en un PC de tu red y pon la IP de la 3DS en su ficha (<RouterLink to="/connect">guía</RouterLink>).
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
            {isLocal && <div className="callout">Este es <strong>el PC en el que estás</strong>. Aquí ves sus archivos como los ven tus otros dispositivos; qué se comparte lo eliges en <RouterLink to="/this-pc">Este equipo</RouterLink>.</div>}
            {!is3ds && !isLocal && !online && (
              <div className="callout">
                Este PC no está conectado. Instala la <strong>app de escritorio</strong> y ábrela en él (<RouterLink to="/connect">cómo hacerlo</RouterLink>)
                {!isDesktop && <>, o comparte una carpeta desde este navegador:</>}
              </div>
            )}
            {!is3ds && !isDesktop && <PcFolderPanel deviceId={device.id} />}
            {is3ds && !online && <OfflineHint onHelp={() => setHelp(true)} />}
            {(is3ds || online || isLocal || !!p2p) && <FileBrowser device={device} client={client} p2p={p2p} startPath={startPath} dirActions={dirActions} />}
          </>
        )}
        {tab === 'setup' && (
          <div className="stack">
            <div className="callout">
              <h4><Activity size={15} /> Estado</h4>
              <p>{online ? 'El dispositivo está conectado y atendiendo órdenes.' : is3ds ? 'La 3DS no está conectada: abre la app Forja3DS en la consola (con WiFi).' : 'Este PC no está conectado: abre la app de escritorio de Forja en él.'}</p>
              <div className="row wrap">
                {is3ds && <button className="btn" onClick={() => setHelp(true)}><Terminal size={15} /> Instalar / vincular la 3DS</button>}
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
  return <div className="callout">La 3DS no está conectada, así que no se pueden ver sus archivos. Abre <strong>Forja3DS</strong> en la consola. <button className="link-btn" onClick={onHelp}>Ver cómo vincularla</button></div>
}

/** Instrucciones de la app de la 3DS + re-emparejado con código. */
function AgentHelp({ device, onClose }: { device: Device; onClose: () => void }) {
  const toast = useToast()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  async function pair(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await sb().rpc('device_pair_approve', { p_code: code, p_studio: device.studio_id, p_name: device.name, p_device: device.id })
    setBusy(false)
    if (error) return toast(errMsg(error), 'err')
    toast('Consola vinculada. En unos segundos aparecerá en línea.'); onClose()
  }
  return (
    <Modal title="Conectar la 3DS (sin PC ni contraseñas)" onClose={onClose} wide>
      <div className="stack">
        <p className="muted">
          <strong>Forja3DS</strong> se conecta a internet por WiFi y se empareja con un <strong>código</strong>, como las apps de TV.
          No hace falta ordenador, ni estar en la misma red, ni escribir contraseñas en la consola.
        </p>
        <ol className="steps">
          <li>Descarga <a className="btn sm" href="/downloads/Forja3DS.cia" download><Download size={14} /> Forja3DS.cia</a> e instálala con <strong>FBI</strong> (queda en el menú HOME), o bien <a className="btn sm" href="/downloads/Forja3DS.3dsx" download><Download size={14} /> Forja3DS.3dsx</a> y cópiala a <code>/3ds/</code> en la SD.</li>
          <li>Ábrela en la 3DS (con WiFi): te mostrará un <strong>código de 6 caracteres</strong>.</li>
          <li>Escríbelo aquí abajo (o al crear el dispositivo). La consola queda vinculada solo a <em>este</em> dispositivo.</li>
        </ol>
        <form className="inline-form wrap" onSubmit={pair}>
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={6} placeholder="K7M2QX"
            style={{ letterSpacing: '.3em', fontWeight: 700, maxWidth: 190 }} autoComplete="off" />
          <button className="btn primary" disabled={busy || code.length < 6}>Vincular esta consola</button>
        </form>
        <p className="muted small">
          Requisito (una sola vez): en Supabase → <strong>Authentication → Sign In / Providers → Allow anonymous sign-ins</strong> activado. La consola entra con una cuenta anónima que solo puede ver este dispositivo, no tus proyectos ni el resto del estudio.
        </p>
        <p className="muted small">ID del dispositivo: <code>{device.id}</code></p>
      </div>
    </Modal>
  )
}
