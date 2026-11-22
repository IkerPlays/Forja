import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CheckSquare, Tag, Trash2, Users, Send, Plus, X } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { BoardData } from '../lib/board'
import { useProjectPeople } from '../lib/people'
import { profileName, useProfiles } from '../lib/profiles'
import { Avatar, Modal, useToast } from './ui'
import { Markdown } from '../lib/markdown'
import { cn, errMsg, fromInputDate, timeAgo, toInputDate, posBetween } from '../lib/util'

interface Props {
  board: BoardData; cardId: string; canEdit: boolean
  upsert: (key: any, row: any) => void; remove: (key: any, id: string) => void; onClose: () => void
}

export default function CardModal({ board, cardId, canEdit, upsert, remove, onClose }: Props) {
  const { session } = useAuth()
  const me = session!.user.id
  const toast = useToast()
  const card = board.cards.find(c => c.id === cardId)!
  const people = useProjectPeople(board.project)
  const profile = useProfiles([...board.comments.map(c => c.user_id), ...board.assignees.map(a => a.user_id)])

  const [title, setTitle] = useState(card.title)
  const [desc, setDesc] = useState(card.description)
  const [picker, setPicker] = useState<null | 'people' | 'labels'>(null)
  const [editDesc, setEditDesc] = useState(!card.description)
  const [newItem, setNewItem] = useState('')
  const [comment, setComment] = useState('')
  const commentsEnd = useRef<HTMLDivElement>(null)

  useEffect(() => { setTitle(card.title) }, [card.title])
  useEffect(() => { setDesc(card.description) }, [card.description])

  const comments = useMemo(() =>
    board.comments.filter(c => c.card_id === cardId).sort((a, b) => a.created_at.localeCompare(b.created_at)), [board.comments, cardId])
  const items = useMemo(() =>
    board.checklist.filter(i => i.card_id === cardId).sort((a, b) => a.position - b.position), [board.checklist, cardId])
  const myAssignees = board.assignees.filter(a => a.card_id === cardId)
  const myLabels = board.cardLabels.filter(l => l.card_id === cardId)
  const list = board.lists.find(l => l.id === card.list_id)

  useEffect(() => { commentsEnd.current?.scrollIntoView({ block: 'nearest' }) }, [comments.length])

  async function patch(values: Record<string, unknown>) {
    upsert('cards', { id: cardId, ...values })
    const { error } = await sb().from('cards').update(values).eq('id', cardId)
    if (error) toast(errMsg(error), 'err')
  }

  async function toggleAssignee(userId: string) {
    const ex = myAssignees.find(a => a.user_id === userId)
    if (ex) {
      remove('assignees', ex.id)
      await sb().from('card_assignees').delete().eq('id', ex.id)
    } else {
      const { data, error } = await sb().from('card_assignees').insert({ card_id: cardId, user_id: userId, project_id: card.project_id }).select().single()
      if (error) return toast(errMsg(error), 'err')
      upsert('assignees', data)
    }
  }
  async function toggleLabel(labelId: string) {
    const ex = myLabels.find(l => l.label_id === labelId)
    if (ex) {
      remove('cardLabels', ex.id)
      await sb().from('card_labels').delete().eq('id', ex.id)
    } else {
      const { data, error } = await sb().from('card_labels').insert({ card_id: cardId, label_id: labelId, project_id: card.project_id }).select().single()
      if (error) return toast(errMsg(error), 'err')
      upsert('cardLabels', data)
    }
  }
  async function addItem(e: React.FormEvent) {
    e.preventDefault()
    const text = newItem.trim()
    if (!text) return
    setNewItem('')
    const { data, error } = await sb().from('card_checklist')
      .insert({ card_id: cardId, project_id: card.project_id, text, position: posBetween(items[items.length - 1]?.position, undefined) }).select().single()
    if (error) return toast(errMsg(error), 'err')
    upsert('checklist', data)
  }
  async function toggleItem(id: string, done: boolean) {
    upsert('checklist', { id, done })
    await sb().from('card_checklist').update({ done }).eq('id', id)
  }
  async function deleteItem(id: string) {
    remove('checklist', id)
    await sb().from('card_checklist').delete().eq('id', id)
  }
  async function sendComment(e: React.FormEvent) {
    e.preventDefault()
    const body = comment.trim()
    if (!body) return
    setComment('')
    const { data, error } = await sb().from('card_comments').insert({ card_id: cardId, project_id: card.project_id, user_id: me, body }).select().single()
    if (error) { setComment(body); return toast(errMsg(error), 'err') }
    upsert('comments', data)
  }
  async function deleteComment(id: string) {
    remove('comments', id)
    await sb().from('card_comments').delete().eq('id', id)
  }
  async function deleteCard() {
    if (!confirm('¿Eliminar esta tarjeta?')) return
    remove('cards', cardId)
    onClose()
    const { error } = await sb().from('cards').delete().eq('id', cardId)
    if (error) toast(errMsg(error), 'err')
  }

  const doneCount = items.filter(i => i.done).length

  return (
    <Modal wide onClose={onClose} title={
      <span className="card-modal-title">
        <input className="title-input" value={title} disabled={!canEdit} onChange={e => setTitle(e.target.value)}
          onBlur={() => { const t = title.trim(); if (t && t !== card.title) void patch({ title: t }); else setTitle(card.title) }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        {list && <small className="muted">en la lista <strong>{list.name}</strong></small>}
      </span>
    }>
      <div className="card-modal">
        <div className="card-main">
          <div className="chips-row">
            {myAssignees.map(a => <span key={a.id} className="chip"><Avatar profile={profile(a.user_id)} size={18} /> {profileName(profile(a.user_id))}</span>)}
            {myLabels.map(l => { const lb = board.labels.find(x => x.id === l.label_id); return lb ? <span key={l.id} className="chip label" style={{ background: lb.color }}>{lb.name || ' '}</span> : null })}
            {card.due_date && <span className={cn('chip', !card.completed && new Date(card.due_date) < new Date() && 'overdue')}><CalendarDays size={13} /> {new Date(card.due_date).toLocaleDateString('es')}</span>}
          </div>

          <h4>Descripción {canEdit && desc && <button className="link-btn" onClick={() => setEditDesc(v => !v)}>{editDesc ? 'ver' : 'editar'}</button>}</h4>
          {editDesc || !desc ? (
            <textarea className="desc" rows={5} value={desc} disabled={!canEdit} placeholder="Añade detalles, enlaces, notas… (admite Markdown: **negrita**, listas, - [ ] casillas, `código`)"
              onChange={e => setDesc(e.target.value)} onBlur={() => { if (desc !== card.description) void patch({ description: desc }); if (desc) setEditDesc(false) }} />
          ) : <div className="desc-view" onDoubleClick={() => canEdit && setEditDesc(true)}><Markdown text={desc} /></div>}

          <h4><CheckSquare size={15} /> Lista de comprobación {items.length > 0 && <small className="muted">{doneCount}/{items.length}</small>}</h4>
          {items.length > 0 && <div className="progress"><div style={{ width: `${(doneCount / items.length) * 100}%` }} /></div>}
          <ul className="checklist">
            {items.map(i => (
              <li key={i.id}>
                <label><input type="checkbox" checked={i.done} disabled={!canEdit} onChange={e => toggleItem(i.id, e.target.checked)} /> <span className={cn(i.done && 'struck')}>{i.text}</span></label>
                {canEdit && <button className="icon-btn sm" onClick={() => deleteItem(i.id)} aria-label="Quitar"><X size={14} /></button>}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form className="inline-form" onSubmit={addItem}>
              <input value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Añadir elemento…" />
              <button className="btn sm" disabled={!newItem.trim()}><Plus size={14} /></button>
            </form>
          )}

          <h4>Comentarios</h4>
          <div className="comments">
            {comments.map(c => (
              <div key={c.id} className="comment">
                <Avatar profile={profile(c.user_id)} size={28} />
                <div>
                  <div className="comment-head"><strong>{profileName(profile(c.user_id))}</strong> <small className="muted">{timeAgo(c.created_at)}</small>
                    {(c.user_id === me || canEdit) && <button className="link-btn" onClick={() => deleteComment(c.id)}>borrar</button>}
                  </div>
                  <Markdown text={c.body} className="inline-md" />
                </div>
              </div>
            ))}
            {!comments.length && <p className="muted small">Aún no hay comentarios.</p>}
            <div ref={commentsEnd} />
          </div>
          <form className="inline-form" onSubmit={sendComment}>
            <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Escribe un comentario…" />
            <button className="btn primary sm" disabled={!comment.trim()}><Send size={14} /></button>
          </form>
        </div>

        <aside className="card-side">
          <button className={cn('btn block', card.completed && 'primary')} disabled={!canEdit}
            onClick={() => patch({ completed: !card.completed })}>
            <CheckSquare size={15} /> {card.completed ? 'Completada' : 'Marcar completada'}
          </button>

          <label className="side-field">
            <span><CalendarDays size={14} /> Fecha límite</span>
            <input type="date" value={toInputDate(card.due_date)} disabled={!canEdit}
              onChange={e => patch({ due_date: fromInputDate(e.target.value) })} />
          </label>

          <div className="side-field">
            <span><Users size={14} /> Asignados</span>
            <button className="btn sm block" disabled={!canEdit} onClick={() => setPicker(picker === 'people' ? null : 'people')}>Elegir personas</button>
            {picker === 'people' && (
              <div className="pick">
                {people.all.map(p => (
                  <button key={p.id} onClick={() => toggleAssignee(p.id)}>
                    <Avatar profile={p} size={20} /> {profileName(p)}
                    {myAssignees.some(a => a.user_id === p.id) && <span className="tick">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="side-field">
            <span><Tag size={14} /> Etiquetas</span>
            <button className="btn sm block" disabled={!canEdit} onClick={() => setPicker(picker === 'labels' ? null : 'labels')}>Elegir etiquetas</button>
            {picker === 'labels' && (
              <div className="pick">
                {board.labels.map(l => (
                  <button key={l.id} onClick={() => toggleLabel(l.id)}>
                    <span className="swatch sm" style={{ background: l.color }} /> {l.name || 'Sin nombre'}
                    {myLabels.some(x => x.label_id === l.id) && <span className="tick">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {canEdit && <button className="btn danger block" onClick={deleteCard}><Trash2 size={15} /> Eliminar</button>}
        </aside>
      </div>
    </Modal>
  )
}
