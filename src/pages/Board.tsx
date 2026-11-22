import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  closestCorners, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { ArrowLeft, MessageSquare, Plus, Users, CalendarDays, CheckSquare, MessageCircle, Paperclip, MoreHorizontal, Check, Settings2, Gamepad2, Search, X } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useBoard } from '../lib/board'
import { useProfiles } from '../lib/profiles'
import { useProjectPeople } from '../lib/people'
import { Avatar, AvatarStack, Empty, Spinner, useToast } from '../components/ui'
import CardModal from '../components/CardModal'
import ChatPanel from '../components/ChatPanel'
import ProjectSettings from '../components/ProjectSettings'
import { cn, errMsg, formatDate, posBetween } from '../lib/util'
import type { Card, Label } from '../lib/types'

export default function Board() {
  const { projectId = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const { session } = useAuth()
  const me = session!.user.id
  const { data, loading, error, upsert, remove } = useBoard(projectId)
  const { project, lists, cards, labels, cardLabels, assignees, checklist, comments } = data

  const [openCard, setOpenCardRaw] = useState<string | null>(() => new URLSearchParams(location.search).get('card'))
  const { search, key: locKey } = useLocation()
  useEffect(() => { const c = new URLSearchParams(search).get('card'); if (c) setOpenCardRaw(c) }, [search, locKey])
  const setOpenCard = (id: string | null) => {
    setOpenCardRaw(id)
    try { const u = new URL(location.href); if (id) u.searchParams.set('card', id); else u.searchParams.delete('card'); history.replaceState(null, '', u) } catch { /* noop */ }
  }
  useEffect(() => {
    if (!project) return
    try { const r: string[] = JSON.parse(localStorage.getItem('forja.recent') || '[]'); localStorage.setItem('forja.recent', JSON.stringify([project.id, ...r.filter(x => x !== project.id)].slice(0, 4))) } catch { /* noop */ }
  }, [project?.id])
  const lastPos = useRef<Record<string, number>>({})
  const [chat, setChat] = useState(false)
  const [settings, setSettings] = useState(false)
  const [dragging, setDragging] = useState<Card | null>(null)
  const [unread, setUnread] = useState(0)
  const [fq, setFq] = useState('')
  const [fLabel, setFLabel] = useState('')
  const [fMine, setFMine] = useState(false)
  const [fLate, setFLate] = useState(false)
  const [canEdit, setCanEdit] = useState(true)
  const [gameId, setGameId] = useState<string | null>(null)
  const online = usePresence(projectId, me)
  const people = useProjectPeople(project)
  const profile = useProfiles([...online, ...assignees.map(a => a.user_id)])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )

  const sortedLists = useMemo(() => [...lists].sort((a, b) => a.position - b.position), [lists])
  const filtering = !!(fq.trim() || fLabel || fMine || fLate)
  const matches = useCallback((c: Card) => {
    if (fq.trim() && !(c.title + ' ' + c.description).toLowerCase().includes(fq.trim().toLowerCase())) return false
    if (fLabel && !cardLabels.some(cl => cl.card_id === c.id && cl.label_id === fLabel)) return false
    if (fMine && !assignees.some(a => a.card_id === c.id && a.user_id === me)) return false
    if (fLate && !(!c.completed && c.due_date && new Date(c.due_date).getTime() < Date.now())) return false
    return true
  }, [fq, fLabel, fMine, fLate, cardLabels, assignees, me])
  const byList = useMemo(() => {
    const m = new Map<string, Card[]>()
    for (const l of lists) m.set(l.id, [])
    for (const c of cards) if (matches(c)) m.get(c.list_id)?.push(c)
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position)
    return m
  }, [lists, cards, matches])

  // ¿puedo editar? (lector de proyecto = solo comentar/chatear) y ¿hay juego enlazado?
  useEffect(() => {
    if (!project) return
    ;(async () => {
      const [{ data: pm }, { data: g }] = await Promise.all([
        sb().from('project_members').select('role').eq('project_id', project.id).eq('user_id', me).maybeSingle(),
        sb().from('games').select('id').eq('project_id', project.id).maybeSingle(),
      ])
      setCanEdit(!(pm && pm.role === 'viewer'))
      setGameId(g?.id ?? null)
    })()
  }, [project?.id, me])

  // Mensajes nuevos con el chat cerrado
  const lastMsg = useRef(0)
  useEffect(() => {
    const n = data.messages.length
    if (!chat && lastMsg.current && n > lastMsg.current) {
      const fresh = data.messages.slice(lastMsg.current).filter(m => m.user_id !== me).length
      if (fresh) setUnread(u => u + fresh)
    }
    lastMsg.current = n
  }, [data.messages, chat, me])
  useEffect(() => { if (chat) setUnread(0) }, [chat])

  if (loading) return <Spinner />
  if (error || !project) {
    return <div className="page"><Empty title="No se pudo abrir el proyecto" text={error ?? ''} action={<Link className="btn" to="/tasks">Volver a Tareas</Link>} /></div>
  }

  async function addList() {
    const name = prompt('Nombre de la lista')?.trim()
    if (!name) return
    const last = sortedLists[sortedLists.length - 1]
    const { data: row, error: e } = await sb().from('lists')
      .insert({ project_id: projectId, name, position: posBetween(last?.position, undefined) }).select().single()
    if (e) return toast(errMsg(e), 'err')
    upsert('lists', row)
  }

  async function addCard(listId: string, title: string) {
    const arr = byList.get(listId) ?? []
    const position = posBetween(Math.max(arr[arr.length - 1]?.position ?? 0, lastPos.current[listId] ?? 0) || undefined, undefined)
    lastPos.current[listId] = position
    const { data: row, error: e } = await sb().from('cards')
      .insert({ project_id: projectId, list_id: listId, title, position, created_by: me })
      .select().single()
    if (e) return toast(errMsg(e), 'err')
    upsert('cards', row)
  }

  async function moveCard(e: DragEndEvent) {
    setDragging(null)
    const { active, over } = e
    if (!over || !canEdit) return
    const card = cards.find(c => c.id === active.id)
    if (!card) return
    const overData = over.data.current as { type: 'list' | 'card'; listId: string } | undefined
    if (!overData) return
    const targetList = overData.listId
    const col = (byList.get(targetList) ?? []).filter(c => c.id !== card.id)
    let index = col.length
    if (overData.type === 'card') {
      const i = col.findIndex(c => c.id === over.id)
      index = i < 0 ? col.length : i
      // Soltar en la mitad inferior de la tarjeta → detrás de ella
      const r = e.active.rect.current.translated
      if (r && over.rect && r.top + r.height / 2 > over.rect.top + over.rect.height / 2 && i >= 0) index = i + 1
    }
    const position = posBetween(col[index - 1]?.position, col[index]?.position)
    if (card.list_id === targetList && card.position === position) return
    upsert('cards', { ...card, list_id: targetList, position })
    const { error: er } = await sb().from('cards').update({ list_id: targetList, position }).eq('id', card.id)
    if (er) { toast(errMsg(er), 'err'); upsert('cards', card) }
  }

  async function renameList(id: string, name: string) {
    upsert('lists', { id, name })
    await sb().from('lists').update({ name }).eq('id', id)
  }
  async function deleteList(id: string) {
    if (!confirm('¿Eliminar la lista y todas sus tarjetas?')) return
    remove('lists', id)
    const { error: e } = await sb().from('lists').delete().eq('id', id)
    if (e) toast(errMsg(e), 'err')
  }
  async function clearDone(id: string) {
    const done = cards.filter(c => c.list_id === id && c.completed)
    if (!done.length || !confirm(`¿Eliminar ${done.length} tarjeta(s) completada(s) de esta lista?`)) return
    done.forEach(c => remove('cards', c.id))
    const { error: e } = await sb().from('cards').delete().in('id', done.map(c => c.id))
    if (e) toast(errMsg(e), 'err')
  }
  async function sortByDue(id: string) {
    const col = cards.filter(c => c.list_id === id).sort((a, b) => (a.due_date ? Date.parse(a.due_date) : Infinity) - (b.due_date ? Date.parse(b.due_date) : Infinity))
    const moved = col.map((c, i) => ({ c, position: (i + 1) * 1000 })).filter(x => x.c.position !== x.position)
    if (!moved.length) return
    moved.forEach(x => upsert('cards', { id: x.c.id, position: x.position }))
    const res = await Promise.all(moved.map(x => sb().from('cards').update({ position: x.position }).eq('id', x.c.id)))
    const bad = res.find(r => r.error); if (bad?.error) toast(errMsg(bad.error), 'err')
  }
  async function moveList(id: string, dir: -1 | 1) {
    const i = sortedLists.findIndex(l => l.id === id)
    const j = i + dir
    if (j < 0 || j >= sortedLists.length) return
    const a = sortedLists[i], b = sortedLists[j]
    upsert('lists', { id: a.id, position: b.position })
    upsert('lists', { id: b.id, position: a.position })
    await Promise.all([
      sb().from('lists').update({ position: b.position }).eq('id', a.id),
      sb().from('lists').update({ position: a.position }).eq('id', b.id),
    ])
  }

  const labelsOf = (cardId: string): Label[] =>
    cardLabels.filter(cl => cl.card_id === cardId).map(cl => labels.find(l => l.id === cl.label_id)).filter(Boolean) as Label[]

  return (
    <div className="board-page">
      <div className="board-head" style={{ ['--accent' as string]: project.color }}>
        <button className="icon-btn" onClick={() => nav('/tasks')} aria-label="Volver"><ArrowLeft size={18} /></button>
        <span className="board-dot" />
        <h1>{project.name}</h1>
        {gameId && <Link className="chip" to={`/games/${gameId}`}><Gamepad2 size={13} /> Juego</Link>}
        <div className="spacer" />
        {online.length > 0 && <AvatarStack profiles={online.map(id => profile(id))} max={5} />}
        <button className="btn" onClick={() => setChat(c => !c)}>
          <MessageSquare size={16} /> Chat {unread > 0 && <span className="badge">{unread}</span>}
        </button>
        <button className="btn" onClick={() => setSettings(true)}><Users size={16} /> Colaboradores</button>
        <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Ajustes del proyecto"><Settings2 size={18} /></button>
      </div>

      <div className="filter-bar">
        <div className="search"><Search size={14} /><input value={fq} onChange={e => setFq(e.target.value)} placeholder="Buscar tarjetas…" aria-label="Buscar tarjetas" /></div>
        <select value={fLabel} onChange={e => setFLabel(e.target.value)} aria-label="Etiqueta"><option value="">Todas las etiquetas</option>{labels.map(l => <option key={l.id} value={l.id}>{l.name || 'Sin nombre'}</option>)}</select>
        <button className={cn('chip btn-chip', fMine && 'on')} onClick={() => setFMine(v => !v)}>Mis tarjetas</button>
        <button className={cn('chip btn-chip', fLate && 'on')} onClick={() => setFLate(v => !v)}>Vencidas</button>
        {filtering && <button className="link-btn" onClick={() => { setFq(''); setFLabel(''); setFMine(false); setFLate(false) }}><X size={12} /> Quitar filtros</button>}
        {filtering && <small className="muted">{cards.filter(matches).length} de {cards.length} tarjetas</small>}
      </div>

      <div className="board-body">
        <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={(e: DragStartEvent) => setDragging(cards.find(c => c.id === e.active.id) ?? null)}
          onDragEnd={moveCard} onDragCancel={() => setDragging(null)}>
          <div className="lists">
            {sortedLists.map((l, idx) => (
              <ListColumn key={l.id} id={l.id} name={l.name} canEdit={canEdit}
                cards={byList.get(l.id) ?? []} count={(byList.get(l.id) ?? []).length}
                first={idx === 0} last={idx === sortedLists.length - 1}
                onRename={n => renameList(l.id, n)} onDelete={() => deleteList(l.id)} onClearDone={() => clearDone(l.id)} onSortDue={() => sortByDue(l.id)} onMove={d => moveList(l.id, d)}
                onAdd={t => addCard(l.id, t)}
                renderCard={c => (
                  <CardTile card={c} labels={labelsOf(c.id)}
                    checklist={checklist.filter(i => i.card_id === c.id)}
                    comments={comments.filter(x => x.card_id === c.id).length}
                    attachments={data.attachments.filter(x => x.card_id === c.id).length}
                    people={assignees.filter(a => a.card_id === c.id).map(a => profile(a.user_id))}
                    onOpen={() => setOpenCard(c.id)} draggable={canEdit} />
                )} />
            ))}
            {canEdit && <button className="add-list" onClick={addList}><Plus size={16} /> Añadir lista</button>}
          </div>
          <DragOverlay>
            {dragging && <div className="tile-overlay"><CardTile card={dragging} labels={labelsOf(dragging.id)}
              checklist={checklist.filter(i => i.card_id === dragging.id)}
              comments={comments.filter(x => x.card_id === dragging.id).length}
              people={assignees.filter(a => a.card_id === dragging.id).map(a => profile(a.user_id))}
              onOpen={() => {}} draggable={false} /></div>}
          </DragOverlay>
        </DndContext>

        {chat && <ChatPanel projectId={projectId} messages={data.messages} upsert={upsert} people={people.all} onClose={() => setChat(false)} />}
      </div>

      {openCard && cards.find(c => c.id === openCard) && (
        <CardModal board={data} cardId={openCard} canEdit={canEdit} upsert={upsert} remove={remove} onClose={() => setOpenCard(null)} />
      )}
      {settings && <ProjectSettings board={data} canEdit={canEdit} upsert={upsert} remove={remove} onClose={() => setSettings(false)} onDeleted={() => nav('/tasks')} />}
    </div>
  )
}

/* -------------------------------- Presencia -------------------------------- */
function usePresence(projectId: string, me: string) {
  const [ids, setIds] = useState<string[]>([])
  useEffect(() => {
    const ch = sb().channel(`project:${projectId}`, { config: { private: true, presence: { key: me } } })
    ch.on('presence', { event: 'sync' }, () => {
      setIds(Object.keys(ch.presenceState()).filter(k => k !== me))
    }).subscribe(async status => {
      if (status === 'SUBSCRIBED') await ch.track({ at: Date.now() })
    })
    return () => { void sb().removeChannel(ch) }
  }, [projectId, me])
  return ids
}

/* ---------------------------------- Lista ---------------------------------- */
function ListColumn({ id, name, cards, count, canEdit, first, last, onRename, onDelete, onClearDone, onSortDue, onMove, onAdd, renderCard }: {
  id: string; name: string; cards: Card[]; count: number; canEdit: boolean; first: boolean; last: boolean
  onRename: (n: string) => void; onDelete: () => void; onClearDone: () => void; onSortDue: () => void; onMove: (d: -1 | 1) => void; onAdd: (t: string) => void | Promise<void>
  renderCard: (c: Card) => React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `list-${id}`, data: { type: 'list', listId: id } })
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const ckey = `forja.collapsed.${id}`
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(ckey) === '1' } catch { return false } })
  const toggle = () => setCollapsed(c => { const n = !c; try { localStorage.setItem(ckey, n ? '1' : '0') } catch { /* noop */ } return n })
  const [nm, setNm] = useState(name)
  useEffect(() => setNm(name), [name])

  return (
    <section className={cn('list', isOver && 'over', collapsed && 'collapsed')}>
      <header className="list-head">
        {editing ? (
          <input className="list-title-input" value={nm} autoFocus onChange={e => setNm(e.target.value)}
            onBlur={() => { setEditing(false); if (nm.trim() && nm !== name) onRename(nm.trim()); else setNm(name) }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setNm(name); setEditing(false) } }} />
        ) : (
          <h3 onClick={() => canEdit && setEditing(true)}>{name}</h3>
        )}
        <span className="count">{count}</span>
        <button className="icon-btn sm" onClick={toggle} aria-label={collapsed ? 'Expandir lista' : 'Plegar lista'}>{collapsed ? '▸' : '▾'}</button>
        {canEdit && (
          <div className="menu-wrap">
            <button className="icon-btn sm" onClick={() => setMenu(m => !m)} aria-label="Opciones de lista"><MoreHorizontal size={16} /></button>
            {menu && (
              <div className="menu right" onMouseLeave={() => setMenu(false)} onClick={() => setMenu(false)}>
                <button onClick={() => setEditing(true)}>Renombrar</button>
                {!first && <button onClick={() => onMove(-1)}>Mover a la izquierda</button>}
                {!last && <button onClick={() => onMove(1)}>Mover a la derecha</button>}
                {cards.length > 1 && <button onClick={onSortDue}>Ordenar por fecha límite</button>}
                {cards.some(c => c.completed) && <button onClick={onClearDone}>Eliminar completadas</button>}
                <button className="danger" onClick={onDelete}>Eliminar lista</button>
              </div>
            )}
          </div>
        )}
      </header>
      <div className="list-cards" ref={setNodeRef} hidden={collapsed}>
        {cards.map(c => <div key={c.id}>{renderCard(c)}</div>)}
        {!cards.length && <div className="list-empty">Suelta tarjetas aquí</div>}
      </div>
      {canEdit && !collapsed && (adding ? (
        <form className="add-card-form" onSubmit={e => { e.preventDefault(); if (title.trim()) { onAdd(title.trim()); setTitle('') } }}>
          <textarea autoFocus rows={2} value={title} placeholder="Título de la tarjeta… (pega varias líneas para crear varias)" onChange={e => setTitle(e.target.value)}
            onPaste={e => { const lines = e.clipboardData.getData('text').split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*/, '').trim()).filter(Boolean); if (lines.length > 1 && lines.length <= 50) { e.preventDefault(); void (async () => { for (const l of lines) await onAdd(l.slice(0, 300)) })(); setAdding(false) } }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).form?.requestSubmit() } if (e.key === 'Escape') setAdding(false) }} />
          <div className="row">
            <button className="btn primary sm" type="submit">Añadir</button>
            <button className="btn ghost sm" type="button" onClick={() => { setAdding(false); setTitle('') }}>Cancelar</button>
          </div>
        </form>
      ) : (
        <button className="add-card" onClick={() => setAdding(true)}><Plus size={15} /> Añadir tarjeta</button>
      ))}
    </section>
  )
}

/* --------------------------------- Tarjeta --------------------------------- */
function CardTile({ card, labels, checklist, comments, attachments = 0, people, onOpen, draggable }: {
  card: Card; labels: Label[]; checklist: { done: boolean }[]; comments: number; attachments?: number
  people: ReturnType<ReturnType<typeof useProfiles>>[]; onOpen: () => void; draggable: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, data: { type: 'card', listId: card.list_id }, disabled: !draggable })
  const { setNodeRef: setDropRef } = useDroppable({ id: card.id, data: { type: 'card', listId: card.list_id } })
  const doneItems = checklist.filter(i => i.done).length
  const overdue = !card.completed && card.due_date && new Date(card.due_date).getTime() < Date.now()
  const ref = (el: HTMLElement | null) => { setNodeRef(el); setDropRef(el) }

  return (
    <article ref={ref} {...attributes} {...listeners} className={cn('tile', isDragging && 'ghost', card.completed && 'done')}
      onClick={onOpen} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen() }}>
      {labels.length > 0 && <div className="tile-labels">{labels.map(l => <span key={l.id} style={{ background: l.color }} title={l.name} />)}</div>}
      <div className="tile-title">
        {card.completed && <Check size={14} className="ok-icon" />}
        {card.title}
      </div>
      <div className="tile-meta">
        {card.due_date && <span className={cn('meta', overdue && 'overdue', card.completed && 'ok')}><CalendarDays size={13} /> {formatDate(card.due_date)}</span>}
        {card.description && <span className="meta" title="Tiene descripción">≡</span>}
        {checklist.length > 0 && <span className={cn('meta', doneItems === checklist.length && 'ok')}><CheckSquare size={13} /> {doneItems}/{checklist.length}</span>}
        {comments > 0 && <span className="meta"><MessageCircle size={13} /> {comments}</span>}
        {attachments > 0 && <span className="meta"><Paperclip size={13} /> {attachments}</span>}
        <div className="spacer" />
        {people.length > 0 && <AvatarStack profiles={people} size={22} max={3} />}
      </div>
    </article>
  )
}
