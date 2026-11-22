import { sb } from './supabase'
import type { TrelloImport } from './trello'

/** Crea un proyecto a partir de un tablero de Trello ya interpretado. Devuelve el id del proyecto. */
export async function importTrello(t: TrelloImport, studioId: string, userId: string, color: string): Promise<string> {
  const { data: proj, error } = await sb().from('projects').insert({ studio_id: studioId, name: t.name, description: t.description.slice(0, 2000), color, created_by: userId }).select('id').single()
  if (error) throw new Error(error.message)
  const pid = proj!.id as string
  // El proyecto nace con listas y etiquetas por defecto: se sustituyen por las de Trello
  await Promise.all([sb().from('lists').delete().eq('project_id', pid), sb().from('project_labels').delete().eq('project_id', pid)])

  const { data: lists, error: le } = await sb().from('lists').insert(t.lists.map((l, i) => ({ project_id: pid, name: l.name, position: (i + 1) * 1000 }))).select('id, position')
  if (le) throw new Error(le.message)
  const listIds = (lists ?? []).sort((a, b) => a.position - b.position).map(l => l.id as string)

  const labelIds = new Map<string, string>()
  if (t.labels.length) {
    const { data: ls, error: lbe } = await sb().from('project_labels').insert(t.labels.map(l => ({ project_id: pid, name: l.name, color: l.color }))).select('id')
    if (lbe) throw new Error(lbe.message)
    t.labels.forEach((l, i) => labelIds.set(l.key, (ls ?? [])[i].id))
  }

  // Tarjetas en bloques; la posición sigue el orden dentro de cada lista
  const perList = new Map<number, number>()
  const rows = t.cards.map(c => {
    const n = (perList.get(c.list) ?? 0) + 1; perList.set(c.list, n)
    return { project_id: pid, list_id: listIds[c.list], title: c.title, description: c.description, position: n * 1000, due_date: c.due, completed: c.completed, created_by: userId }
  })
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200)
    const { data: made, error: ce } = await sb().from('cards').insert(slice).select('id')
    if (ce) throw new Error(ce.message)
    const ids = (made ?? []).map(m => m.id as string)
    const cl: { card_id: string; label_id: string; project_id: string }[] = [], ck: { card_id: string; project_id: string; text: string; done: boolean; position: number }[] = []
    t.cards.slice(i, i + 200).forEach((c, j) => {
      for (const key of c.labels) { const lid = labelIds.get(key); if (lid) cl.push({ card_id: ids[j], label_id: lid, project_id: pid }) }
      c.checklist.forEach((it, k) => ck.push({ card_id: ids[j], project_id: pid, text: it.text, done: it.done, position: (k + 1) * 1000 }))
    })
    if (cl.length) { const r = await sb().from('card_labels').insert(cl); if (r.error) throw new Error(r.error.message) }
    if (ck.length) { const r = await sb().from('card_checklist').insert(ck); if (r.error) throw new Error(r.error.message) }
  }
  return pid
}
