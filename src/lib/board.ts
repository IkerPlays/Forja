import { useCallback, useEffect, useRef, useState } from 'react'
import { sb } from './supabase'
import type { Attachment, Card, CardAssignee, CardLabel, ChecklistItem, Comment, Label, List, Message, Project } from './types'

export interface BoardData {
  project: Project | null
  lists: List[]
  cards: Card[]
  labels: Label[]
  cardLabels: CardLabel[]
  assignees: CardAssignee[]
  checklist: ChecklistItem[]
  comments: Comment[]
  attachments: Attachment[]
  messages: Message[]
}

const EMPTY: BoardData = {
  project: null, lists: [], cards: [], labels: [], cardLabels: [], assignees: [], checklist: [], comments: [], attachments: [], messages: [],
}

type Key = Exclude<keyof BoardData, 'project'>
const TABLES: { table: string; key: Key }[] = [
  { table: 'lists', key: 'lists' },
  { table: 'cards', key: 'cards' },
  { table: 'project_labels', key: 'labels' },
  { table: 'card_labels', key: 'cardLabels' },
  { table: 'card_assignees', key: 'assignees' },
  { table: 'card_checklist', key: 'checklist' },
  { table: 'card_comments', key: 'comments' },
  { table: 'card_attachments', key: 'attachments' },
  { table: 'project_messages', key: 'messages' },
]

/**
 * Carga todo un tablero y lo mantiene sincronizado con Realtime.
 * `patch` permite actualizar el estado al instante (optimista); el eco de Realtime
 * llega después con los mismos datos y se fusiona por id.
 */
export function useBoard(projectId: string) {
  const [data, setData] = useState<BoardData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  const upsert = useCallback((key: Key, row: { id: string } | object) => {
    setData(d => {
      const arr = d[key] as { id: string }[]; const r = row as { id: string }
      const i = arr.findIndex(x => x.id === r.id)
      const next = i >= 0 ? arr.map((x, j) => (j === i ? { ...x, ...row } : x)) : [...arr, r]
      return { ...d, [key]: next }
    })
  }, [])
  const remove = useCallback((key: Key, id: string) => {
    setData(d => ({ ...d, [key]: (d[key] as { id: string }[]).filter(x => x.id !== id) }))
  }, [])

  useEffect(() => {
    alive.current = true
    setLoading(true); setError(null); setData(EMPTY)

    ;(async () => {
      const { data: project, error: pe } = await sb().from('projects').select('*').eq('id', projectId).maybeSingle()
      if (!alive.current) return
      if (pe || !project) { setError(pe?.message ?? 'No existe o no tienes acceso a este proyecto'); setLoading(false); return }
      const results = await Promise.all(TABLES.map(t => {
        const q = sb().from(t.table).select('*').eq('project_id', projectId)
        return t.key === 'messages' ? q.order('created_at', { ascending: true }).limit(300) : q
      }))
      if (!alive.current) return
      const next: BoardData = { ...EMPTY, project: project as Project }
      TABLES.forEach((t, i) => { (next[t.key] as unknown[]) = (results[i].data ?? []) as unknown[] })
      setData(next)
      setLoading(false)
    })()

    // Un solo canal con todas las tablas del proyecto
    let ch = sb().channel(`board-${projectId}-${Math.random().toString(36).slice(2, 7)}`)
    for (const t of TABLES) {
      ch = ch
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: t.table, filter: `project_id=eq.${projectId}` },
          p => upsert(t.key, p.new as { id: string }))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: t.table, filter: `project_id=eq.${projectId}` },
          p => upsert(t.key, p.new as { id: string }))
        // Supabase no filtra los DELETE: solo llega el id y lo quitamos si lo teníamos
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: t.table },
          p => { const id = (p.old as { id?: string }).id; if (id) remove(t.key, id) })
    }
    ch = ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
      p => setData(d => ({ ...d, project: { ...(d.project as Project), ...(p.new as Project) } })))
    ch.subscribe()

    return () => { alive.current = false; void sb().removeChannel(ch) }
  }, [projectId, upsert, remove])

  return { data, loading, error, upsert, remove }
}
