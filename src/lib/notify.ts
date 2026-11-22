import { useSyncExternalStore } from 'react'
import { sb } from './supabase'

export interface Notice { id: string; at: number; kind: 'assign' | 'comment' | 'message'; title: string; body: string; href: string; read: boolean }

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
      const [{ data: card }, { data: mine }, { data: who }] = await Promise.all([
        sb().from('cards').select('title, created_by').eq('id', c.card_id).maybeSingle(),
        sb().from('card_assignees').select('id').eq('card_id', c.card_id).eq('user_id', uid).limit(1),
        sb().from('profiles').select('display_name').eq('id', c.user_id).maybeSingle(),
      ])
      if (!card || !(card.created_by === uid || (mine && mine.length))) return
      const href = `/tasks/${c.project_id}`
      if (here(href)) return
      notices.add({ kind: 'comment', title: `${who?.display_name ?? 'Alguien'} comentó en «${card.title}»`, body: c.body.slice(0, 120), href })
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_messages' }, async p => {
      const m = p.new as { user_id: string; body: string; project_id: string }
      if (m.user_id === uid) return
      const href = `/tasks/${m.project_id}`
      if (here(href) || Date.now() - (lastMsg.get(m.project_id) ?? 0) < 30_000) return
      lastMsg.set(m.project_id, Date.now())
      const [{ data: who }, { data: pr }] = await Promise.all([
        sb().from('profiles').select('display_name').eq('id', m.user_id).maybeSingle(),
        sb().from('projects').select('name').eq('id', m.project_id).maybeSingle(),
      ])
      notices.add({ kind: 'message', title: `${who?.display_name ?? 'Alguien'} en el chat de ${pr?.name ?? 'un proyecto'}`, body: m.body.slice(0, 120), href })
    })
    .subscribe()
  return () => { void sb().removeChannel(ch) }
}
