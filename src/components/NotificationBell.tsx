import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AtSign, Bell, CheckCheck, MessageSquare, UserPlus, MessageCircle, AlarmClock } from 'lucide-react'
import { askNotificationPermission, notices, notificationPermission, notificationsSupported, useNotices } from '../lib/notify'
import { timeAgo } from '../lib/util'

export default function NotificationBell() {
  const items = useNotices()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [perm, setPerm] = useState(notificationPermission())
  const box = useRef<HTMLDivElement>(null)
  const unread = items.filter(i => !i.read).length

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const Icon = (k: string) => (k === 'mention' ? <AtSign size={15} /> : k === 'due' ? <AlarmClock size={15} /> : k === 'assign' ? <UserPlus size={15} /> : k === 'message' ? <MessageSquare size={15} /> : <MessageCircle size={15} />)

  return (
    <div className="bell" ref={box}>
      <button className="icon-btn" onClick={() => { setOpen(o => !o); if (!open) setTimeout(() => notices.markAll(), 1500) }} aria-label="Notificaciones" title="Notificaciones">
        <Bell size={18} />{unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notificaciones">
          <div className="bell-head"><strong>Notificaciones</strong>
            <span className="spacer" />
            {items.length > 0 && <button className="link-btn" onClick={() => notices.clear()}><CheckCheck size={13} /> Vaciar</button>}
          </div>
          {notificationsSupported() && perm !== 'granted' && perm !== 'denied' && (
            <button className="btn sm block" onClick={async () => setPerm(await askNotificationPermission())}>Activar avisos del sistema</button>
          )}
          {perm === 'denied' && <p className="muted small">Los avisos del sistema están bloqueados en este navegador.</p>}
          <ul>
            {items.map(n => (
              <li key={n.id} className={n.read ? '' : 'unread'}>
                <button onClick={() => { setOpen(false); nav(n.href) }}>
                  <span className="ico">{Icon(n.kind)}</span>
                  <span className="txt"><strong>{n.title}</strong><small className="muted">{n.body}</small><small className="muted">{timeAgo(n.at)}</small></span>
                </button>
              </li>
            ))}
            {!items.length && <li className="muted small empty-li">Nada nuevo. Aquí verás tareas asignadas, comentarios en tus tarjetas y mensajes de chat.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
