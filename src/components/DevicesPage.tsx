import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useStudio } from '../context/StudioContext'
import { useDevices } from '../lib/useDevices'
import DeviceConsole from './DeviceConsole'
import DeviceForm from './DeviceForm'
import { Empty, PageHeader, Spinner, StatusDot, useTick } from './ui'
import { cn, isOnline } from '../lib/util'
import type { DeviceKind, FileEntry } from '../lib/types'
import { useSearchParams } from 'react-router-dom'

/** Pantalla común para 3DS y PC: lista de dispositivos + consola del seleccionado. */
export default function DevicesPage({ kind, base, title, sub, icon, dirActions }: {
  kind: DeviceKind; base: string; title: string; sub: string; icon: ReactNode
  dirActions?: (deviceId: string) => (e: FileEntry, p: string) => ReactNode
}) {
  const { deviceId } = useParams()
  const nav = useNavigate()
  const [search] = useSearchParams()
  const { active } = useStudio()
  const { devices, reload } = useDevices(active?.id, kind)
  const [adding, setAdding] = useState(false)
  const now = useTick(8000)

  if (!active || !devices) return <Spinner />
  const selected = devices.find(d => d.id === deviceId) ?? (devices.length === 1 ? devices[0] : null)

  return (
    <div className="page">
      <PageHeader title={title} sub={sub} actions={<button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Añadir</button>} />
      {!devices.length ? (
        <Empty icon={icon} title={kind === '3ds' ? 'Conecta tu primera 3DS' : 'Conecta tu PC'}
          text={kind === '3ds'
            ? 'Verás sus archivos, jugarás con mando en pantalla y podrás ver su pantalla en directo.'
            : 'Navega por sus carpetas de juegos, mira su pantalla en directo y controla el ratón y el teclado.'}
          action={<div className="row wrap"><button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Añadir {kind === '3ds' ? 'una 3DS' : 'un PC'}</button><Link className="btn" to="/connect">Ver guía de conexión</Link></div>} />
      ) : (
        <div className="devices-layout">
          {devices.length > 1 && (
            <div className="device-list">
              {devices.map(d => (
                <button key={d.id} className={cn('device-item', selected?.id === d.id && 'on')} onClick={() => nav(`${base}/${d.id}`)}>
                  <StatusDot online={isOnline(d.last_seen, now)} /> {d.name}
                </button>
              ))}
            </div>
          )}
          {selected ? (
            <DeviceConsole key={selected.id} device={selected} onChanged={reload} startPath={search.get('path') ?? undefined}
              onDeleted={() => { void reload(); nav(base) }} dirActions={dirActions?.(selected.id)} />
          ) : <Empty title="Elige un dispositivo" />}
        </div>
      )}
      {adding && <DeviceForm studioId={active.id} kind={kind} existing={devices} onClose={() => setAdding(false)}
        onSaved={id => { setAdding(false); void reload(); nav(`${base}/${id}`) }} />}
    </div>
  )
}
