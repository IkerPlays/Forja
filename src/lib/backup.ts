import { sb } from './supabase'
import type { BoardData } from './board'

function download(name: string, data: unknown) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
}
const stamp = () => new Date().toISOString().slice(0, 10)

/** Exporta un proyecto abierto (listas, tarjetas, etiquetas, checklists y comentarios). */
export function exportProject(b: BoardData) {
  download(`forja-proyecto-${(b.project?.name ?? 'proyecto').replace(/[^\w-]+/g, '_')}-${stamp()}.json`, {
    forja: 1, exportedAt: new Date().toISOString(), project: b.project, lists: b.lists, cards: b.cards, labels: b.labels,
    cardLabels: b.cardLabels, assignees: b.assignees, checklist: b.checklist, comments: b.comments,
  })
}

/** Copia de seguridad de todo el estudio (sin claves ni credenciales de dispositivos). */
export async function exportStudio(studioId: string, studioName: string) {
  const q = async (t: string, col = 'studio_id') => ((await sb().from(t).select('*').eq(col, studioId)).data ?? [])
  const projects = (await q('projects')) as { id: string }[]
  const ids = projects.map(p => p.id)
  const inP = async (t: string) => (ids.length ? ((await sb().from(t).select('*').in('project_id', ids)).data ?? []) : [])
  const [games, notes, devices, lists, cards, labels, cardLabels, assignees, checklist, comments] = await Promise.all([
    q('games'), q('notes'), q('devices'), inP('lists'), inP('cards'), inP('project_labels'), inP('card_labels'), inP('card_assignees'), inP('card_checklist'), inP('card_comments'),
  ])
  download(`forja-copia-${studioName.replace(/[^\w-]+/g, '_')}-${stamp()}.json`, {
    forja: 1, exportedAt: new Date().toISOString(), studio: studioName, projects, lists, cards, labels, cardLabels, assignees, checklist, comments, games, notes,
    devices: (devices as { config?: Record<string, unknown> }[]).map(d => ({ ...d, config: { ...d.config, ftp_pass: undefined, ftp_user: undefined } })),
  })
}
