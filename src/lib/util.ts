export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export function initials(name?: string | null) {
  const n = (name || '?').trim()
  const parts = n.split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function timeAgo(iso: string | number | Date) {
  const t = new Date(iso).getTime()
  const s = Math.max(1, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'hace un momento'
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  if (d < 30) return `hace ${d} d`
  return new Date(t).toLocaleDateString('es')
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

export function formatBytes(n: number) {
  if (!Number.isFinite(n)) return ''
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${u[i]}`
}

export function toInputDate(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function fromInputDate(v: string) {
  return v ? new Date(v + 'T12:00:00').toISOString() : null
}

export function errMsg(e: unknown): string {
  if (!e) return 'Error desconocido'
  if (typeof e === 'string') return e
  const anyE = e as { message?: string; error_description?: string }
  return anyE.message || anyE.error_description || 'Error desconocido'
}

export const COLORS = ['#ff7a2f', '#f5b83d', '#3ecf8e', '#38bdf8', '#7c5cff', '#e879a8', '#ef4444', '#94a3b8']

export function posBetween(before?: number, after?: number) {
  if (before === undefined && after === undefined) return 1000
  if (before === undefined) return (after as number) - 1000
  if (after === undefined) return before + 1000
  return (before + after) / 2
}

export function isOnline(lastSeen: string | null | undefined, now = Date.now()) {
  return !!lastSeen && now - new Date(lastSeen).getTime() < 50_000
}

export function uid() {
  return crypto.randomUUID()
}
