import { useSyncExternalStore } from 'react'
import { sb } from './supabase'

export interface Notice { id: string; at: number; kind: 'assign' | 'comment' | 'message' | 'mention' | 'due'; title: string; body: string; href: string; read: boolean }

class NoticeStore {
  items: Notice[] = []
  private listeners = new Set<() => void>()
  private key = 'forja.notices'
  load(uid: string) {
    this.key = `forja.notices.${uid}`
    try { this.items = JSON.parse(localStorage.getItem(this.key) || '[]') } catch { this.items = [] }
    this.emit()
  }
  private save() { try { localStorage.setItem(this.key, JSON.stringify(this.items.slice(0, 60))) } catch { /* noop */ } }
  private emit() { this.items = [...this.items]; this.listeners.forEach(l => l()) }
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  snapshot = () => this.items
  add(n: Omit<Notice, 'id' | 'at' | 'read'>) {
    this.items = [{ ...n, id: crypto.randomUUID(), at: Date.now(), read: false }, ...this.items].slice(0, 60)
    this.save(); this.emit()
    system(n.title, n.body, n.href)
  }
  markAll() { this.items = this.items.map(i => ({ ...i, read: true })); this.save(); this.emit() }
  clear() { this.items = []; this.save(); this.emit() }
}
export const notices = new NoticeStore()
export const useNotices = () => useSyncExternalStore(notices.subscribe, notices.snapshot)

/** Aviso del sistema (solo si el permiso está dado y no estás mirando la app). */
function system(title: string, body: string, href: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (document.visibilityState === 'visible' && document.hasFocus()) return
    const n = new Notification(title, { body, tag: href })
    n.onclick = () => { window.focus(); if (location.pathname !== href) location.assign(href); n.close() }
  } catch { /* noop */ }
}

export const notificationsSupported = () => typeof Notification !== 'undefined'
export const notificationPermission = () => (typeof Notification === 'undefined' ? 'denied' : Notification.permission)
export async function askNotificationPermission() { return typeof Notification === 'undefined' ? 'denied' : Notification.requestPermission() }

/** Suscripciones en tiempo real: tareas asignadas a ti, comentarios en tus tarjetas y mensajes de proyectos. */
export function startNotifications(uid: string) {
  notices.load(uid)
  let myName = ''
  void sb().from('profiles').select('display_name').eq('id', uid).maybeSingle().then(({ data }) => { myName = data?.display_name ?? '' })
  void remindDue(uid)
  const dueTimer = window.setInterval(() => { void remindDue(uid) }, 3600_000)
  const mentions = (body: string) => !!myName && body.includes(`@[${myName}]`)
  const lastMsg = new Map<string, number>()
  const here = (href: string) => location.pathname === href && document.visibilityState === 'visible'
  const ch = sb().channel(`notify-${uid}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'card_assignees', filter: `user_id=eq.${uid}` }, async p => {
      const a = p.new as { card_id: string }
      const { data } = await sb().from('cards').select('title, project_id, projects(name)').eq('id', a.card_id).maybeSingle()
      if (!data) return
      const row = data as unknown as { title: string; project_id: string; projects: { name: string } | null }
      const href = `/tasks/${row.project_id}`
      if (here(href)) return
      notices.add({ kind: 'assign', title: 'Te han asignado una tarea', body: `${row.title} · ${row.projects?.name ?? ''}`, href })
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'card_comments' }, async p => {
      const c = p.new as { card_id: string; user_id: string; body: string; project_id: string }
      if (c.user_id === uid) return
      const mentioned = mentions(c.body)
      const [{ data: card }, { data: mine }, { data: who }] = await Promise.all([
        sb().from('cards').select('title, created_by').eq('id', c.card_id).maybeSingle(),
        sb().from('card_assignees').select('id').eq('card_id', c.card_id).eq('user_id', uid).limit(1),
        sb().from('profiles').select('display_name').eq('id', c.user_id).maybeSingle(),
      ])
      if (!card || !(mentioned || card.created_by === uid || (mine && mine.length))) return
      const href = `/tasks/${c.project_id}`
      if (here(href)) return
      notices.add({ kind: mentioned ? 'mention' : 'comment', title: mentioned ? `${who?.display_name ?? 'Alguien'} te mencionó en «${card.title}»` : `${who?.display_name ?? 'Alguien'} comentó en «${card.title}»`, body: c.body.replace(/@\[([^\]]+)\]/g, '@$1').slice(0, 120), href })
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_messages' }, async p => {
      const m = p.new as { user_id: string; body: string; project_id: string }
      if (m.user_id === uid) return
      const href = `/tasks/${m.project_id}`
      const mentioned = mentions(m.body)
      if (here(href) || (!mentioned && Date.now() - (lastMsg.get(m.project_id) ?? 0) < 30_000)) return
      lastMsg.set(m.project_id, Date.now())
      const [{ data: who }, { data: pr }] = await Promise.all([
        sb().from('profiles').select('display_name').eq('id', m.user_id).maybeSingle(),
        sb().from('projects').select('name').eq('id', m.project_id).maybeSingle(),
      ])
      notices.add({ kind: mentioned ? 'mention' : 'message', title: mentioned ? `${who?.display_name ?? 'Alguien'} te mencionó en ${pr?.name ?? 'un chat'}` : `${who?.display_name ?? 'Alguien'} en el chat de ${pr?.name ?? 'un proyecto'}`, body: m.body.replace(/@\[([^\]]+)\]/g, '@$1').slice(0, 120), href })
    })
    .subscribe()
  return () => { window.clearInterval(dueTimer); void sb().removeChannel(ch) }
}

/** Avisa (una vez por tarjeta y fecha) de mis tarjetas que vencen en 24 h o ya vencieron. */
async function remindDue(uid: string) {
  try {
    const { data: mine } = await sb().from('card_assignees').select('card_id').eq('user_id', uid)
    const ids = (mine ?? []).map(r => r.card_id as string)
    if (!ids.length) return
    const limit = new Date(Date.now() + 24 * 3600_000).toISOString()
    const { data } = await sb().from('cards').select('id, title, due_date, project_id, completed').in('id', ids).eq('completed', false).not('due_date', 'is', null).lte('due_date', limit)
    const key = `forja.due.${uid}`
    let seen: string[] = []
    try { seen = JSON.parse(localStorage.getItem(key) || '[]') } catch { /* noop */ }
    for (const c of (data ?? []) as { id: string; title: string; due_date: string; project_id: string }[]) {
      const tag = `${c.id}:${c.due_date}`
      if (seen.includes(tag)) continue
      seen.push(tag)
      const late = new Date(c.due_date).getTime() < Date.now()
      notices.add({ kind: 'due', title: late ? 'Tarea vencida' : 'Vence en menos de 24 h', body: c.title, href: `/tasks/${c.project_id}` })
    }
    try { localStorage.setItem(key, JSON.stringify(seen.slice(-200))) } catch { /* noop */ }
  } catch { /* noop */ }
}
