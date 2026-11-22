/** Importación de un tablero exportado de Trello (JSON) y exportación/copia de seguridad propia. */
export interface TrelloImport {
  name: string
  description: string
  labels: { key: string; name: string; color: string }[]
  lists: { name: string }[]
  cards: { list: number; title: string; description: string; due: string | null; completed: boolean; labels: string[]; checklist: { text: string; done: boolean }[] }[]
  skipped: { lists: number; cards: number }
}

export const TRELLO_COLORS: Record<string, string> = {
  green: '#3ecf8e', yellow: '#f5b83d', orange: '#ff7a2f', red: '#ef4444', purple: '#a855f7', blue: '#3b82f6', sky: '#38bdf8',
  lime: '#84cc16', pink: '#e879a8', black: '#475569', green_dark: '#16a34a', yellow_dark: '#ca8a04', orange_dark: '#ea580c',
  red_dark: '#dc2626', purple_dark: '#7e22ce', blue_dark: '#1d4ed8', sky_dark: '#0284c7', lime_dark: '#65a30d', pink_dark: '#db2777', black_dark: '#334155',
}
const color = (c?: string | null) => (c && TRELLO_COLORS[c]) || '#94a3b8'

/** Convierte el JSON de «Exportar como JSON» de Trello. Las listas y tarjetas archivadas (closed) se omiten salvo `withArchived`. */
export function parseTrello(raw: unknown, withArchived = false): TrelloImport {
  const j = raw as Record<string, any>
  if (!j || typeof j !== 'object' || !Array.isArray(j.lists) || !Array.isArray(j.cards)) throw new Error('No parece un JSON exportado de Trello (faltan «lists» y «cards»).')
  const lists = (j.lists as any[]).filter(l => withArchived || !l.closed).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
  const listIndex = new Map<string, number>(lists.map((l, i) => [l.id, i]))
  const labelDefs: TrelloImport['labels'] = []
  const seen = new Map<string, string>()
  for (const l of (j.labels ?? []) as any[]) {
    const key = l.id as string
    const name = String(l.name ?? ''), col = color(l.color)
    if (!name && !l.color) continue
    seen.set(key, key); labelDefs.push({ key, name, color: col })
  }
  const checklists = new Map<string, { text: string; done: boolean }[]>()
  for (const cl of (j.checklists ?? []) as any[]) {
    const items = ((cl.checkItems ?? []) as any[]).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).map(i => ({ text: String(i.name ?? '').slice(0, 300) || '·', done: i.state === 'complete' }))
    checklists.set(cl.idCard, [...(checklists.get(cl.idCard) ?? []), ...items])
  }
  const cards: TrelloImport['cards'] = []
  let skippedCards = 0
  for (const c of ((j.cards as any[]).slice().sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)))) {
    const li = listIndex.get(c.idList)
    if (li === undefined || (!withArchived && c.closed)) { skippedCards++; continue }
    cards.push({
      list: li, title: String(c.name ?? 'Sin título').slice(0, 300) || 'Sin título', description: String(c.desc ?? ''),
      due: c.due ? new Date(c.due).toISOString() : null, completed: !!c.dueComplete,
      labels: ((c.idLabels ?? []) as string[]).filter(id => seen.has(id)), checklist: checklists.get(c.id) ?? [],
    })
  }
  return { name: String(j.name ?? 'Importado de Trello').slice(0, 120), description: String(j.desc ?? ''), labels: labelDefs, lists: lists.map(l => ({ name: String(l.name ?? 'Lista').slice(0, 120) })), cards, skipped: { lists: ((j.lists as any[]).length - lists.length), cards: skippedCards } }
}
