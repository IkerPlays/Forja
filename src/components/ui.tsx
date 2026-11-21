import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { cn, initials } from '../lib/util'
import type { Profile } from '../lib/types'

/* ------------------------------ Toasts ------------------------------ */
type Toast = { id: number; text: string; kind: 'ok' | 'err' }
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++seq.current
    setItems(a => [...a, { id, text, kind }])
    setTimeout(() => setItems(a => a.filter(t => t.id !== id)), kind === 'err' ? 6000 : 3000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={cn('toast', t.kind)}>
            {t.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

/* ------------------------------ Modal ------------------------------- */
export function Modal({
  title, onClose, children, wide, footer,
}: { title?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={cn('modal', wide && 'wide')} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ------------------------------ Confirm ----------------------------- */
export function ConfirmModal({
  title, text, confirmLabel = 'Eliminar', danger = true, onConfirm, onClose,
}: { title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className={cn('btn', danger ? 'danger' : 'primary')} disabled={busy}
          onClick={async () => { setBusy(true); try { await onConfirm() } finally { setBusy(false); onClose() } }}>
          {busy && <Loader2 size={14} className="spin" />} {confirmLabel}
        </button>
      </>
    }>
      <p className="muted">{text}</p>
    </Modal>
  )
}

/* ------------------------------ Avatar ------------------------------ */
export function Avatar({ profile, size = 28, title }: { profile?: Partial<Profile> | null; size?: number; title?: string }) {
  const name = profile?.display_name || profile?.username || profile?.email || '?'
  return (
    <span className="avatar" title={title ?? name}
      style={{ width: size, height: size, fontSize: size * 0.4, background: profile?.avatar_url ? undefined : profile?.color || '#7c5cff' }}>
      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials(name)}
    </span>
  )
}

export function AvatarStack({ profiles, max = 4, size = 24 }: { profiles: (Partial<Profile> | null | undefined)[]; max?: number; size?: number }) {
  const shown = profiles.slice(0, max)
  const rest = profiles.length - shown.length
  return (
    <span className="avatar-stack">
      {shown.map((p, i) => <Avatar key={i} profile={p} size={size} />)}
      {rest > 0 && <span className="avatar more" style={{ width: size, height: size, fontSize: size * 0.4 }}>+{rest}</span>}
    </span>
  )
}

/* ------------------------------ Varios ------------------------------ */
export function Spinner({ label }: { label?: string }) {
  return <div className="center-fill"><Loader2 className="spin" size={22} />{label && <span className="muted">{label}</span>}</div>
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {text && <p className="muted">{text}</p>}
      {action}
    </div>
  )
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

export function ColorPicker({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <div className="color-picker">
      {colors.map(c => (
        <button key={c} type="button" className={cn('swatch', c === value && 'on')} style={{ background: c }}
          onClick={() => onChange(c)} aria-label={c} />
      ))}
    </div>
  )
}

export function StatusDot({ online }: { online: boolean }) {
  return <span className={cn('dot', online ? 'on' : 'off')} title={online ? 'En línea' : 'Sin conexión'} />
}

export function Progress({ value, total, color }: { value: number; total: number; color?: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0
  return (
    <div className="progress" title={`${value}/${total}`}>
      <div style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

/** Reloj que fuerza un re-render cada `ms` (para "en línea" / "hace X"). */
export function useTick(ms = 10000) {
  const [t, setT] = useState(() => Date.now())
  useEffect(() => { const i = setInterval(() => setT(Date.now()), ms); return () => clearInterval(i) }, [ms])
  return t
}
