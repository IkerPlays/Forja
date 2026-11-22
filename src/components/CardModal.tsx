import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CheckSquare, Tag, Trash2, Users, Send, Plus, X, Paperclip, Download, Copy, ArrowRightLeft, FileText, Loader2 } from 'lucide-react'
import MentionInput from './MentionInput'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { BoardData } from '../lib/board'
import { useProjectPeople } from '../lib/people'
import { profileName, useProfiles } from '../lib/profiles'
import { Avatar, Modal, useToast } from './ui'
import { Markdown } from '../lib/markdown'
import { cn, errMsg, fromInputDate, timeAgo, toInputDate, posBetween, formatBytes, uid } from '../lib/util'

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
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
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
  const atts = useMemo(() => board.attachments.filter(a => a.card_id === cardId).sort((a, b) => a.created_at.localeCompare(b.created_at)), [board.attachments, cardId])

  // Vistas previas de las imágenes (enlaces firmados de 1 hora)
  const imgPaths = atts.filter(a => a.mime.startsWith('image/')).map(a => a.path).join('|')
  useEffect(() => {
    if (!imgPaths) return
    let alive = true
    void sb().storage.from('attachments').createSignedUrls(imgPaths.split('|'), 3600).then(({ data }) => {
      if (alive && data) setUrls(Object.fromEntries(data.filter(d => d.signedUrl && d.path).map(d => [d.path as string, d.signedUrl as string])))
    })
    return () => { alive = false }
  }, [imgPaths])

  async function addFiles(files: File[]) {
    if (!canEdit || !files.length) return
    setUploading(true)
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) { toast(`${f.name}: máximo 10 MB por adjunto`, 'err'); continue }
      const name = f.name || `pegado-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
      const path = `${card.project_id}/${cardId}/${uid()}-${name.replace(/[^\w.\- ]/g, '_')}`
      const up = await sb().storage.from('attachments').upload(path, f, { contentType: f.type || 'application/octet-stream' })
      if (up.error) { toast(errMsg(up.error), 'err'); continue }
      const { data, error } = await sb().from('card_attachments').insert({ card_id: cardId, project_id: card.project_id, name, path, size: f.size, mime: f.type || 'application/octet-stream', created_by: me }).select().single()
      if (error) { toast(errMsg(error), 'err'); void sb().storage.from('attachments').remove([path]); continue }
      upsert('attachments', data)
    }
    setUploading(false)
  }
  async function openAttachment(a: { path: string; name: string }) {
    const { data, error } = await sb().storage.from('attachments').createSignedUrl(a.path, 60, { download: a.name })
    if (error || !data) return toast(errMsg(error), 'err')
    const link = document.createElement('a'); link.href = data.signedUrl; link.download = a.name; document.body.appendChild(link); link.click(); link.remove()
  }
  async function deleteAttachment(a: { id: string; path: string }) {
    remove('attachments', a.id)
    await sb().storage.from('attachments').remove([a.path])
    await sb().from('card_attachments').delete().eq('id', a.id)
  }

  // Mover y duplicar
  async function moveTo(listId: string) {
    if (listId === card.list_id) return
    const col = board.cards.filter(c => c.list_id === listId).sort((a, b) => a.position - b.position)
    await patch({ list_id: listId, position: posBetween(col[col.length - 1]?.position, undefined) })
    toast('Tarjeta movida')
  }
  async function duplicate() {
    const col = board.cards.filter(c => c.list_id === card.list_id).sort((a, b) => a.position - b.position)
    const { data, error } = await sb().from('cards').insert({ project_id: card.project_id, list_id: card.list_id, title: `${card.title} (copia)`.slice(0, 300), description: card.description, due_date: card.due_date, position: posBetween(col[col.length - 1]?.position, undefined), created_by: me }).select().single()
    if (error) return toast(errMsg(error), 'err')
    upsert('cards', data)
    if (items.length) {
      const { data: rows } = await sb().from('card_checklist').insert(items.map((i, k) => ({ card_id: data.id, project_id: card.project_id, text: i.text, done: false, position: (k + 1) * 1000 }))).select()
      rows?.forEach(r => upsert('checklist', r))
    }
    toast('Tarjeta duplicada')
  }

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
      <div className="card-modal" onPaste={e => { const files = Array.from(e.clipboardData?.files ?? []); if (files.length) { e.preventDefault(); void addFiles(files) } }}>
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

          <h4><Paperclip size={15} /> Adjuntos {atts.length > 0 && <small className="muted">{atts.length}</small>}</h4>
          <div className={cn('attach-zone', dragOver && 'over')}
            onDragOver={e => { if (canEdit) { e.preventDefault(); setDragOver(true) } }} onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); void addFiles(Array.from(e.dataTransfer.files)) }}>
            <ul className="attachments">
              {atts.map(a => (
                <li key={a.id}>
                  {a.mime.startsWith('image/') && urls[a.path] ? <img src={urls[a.path]} alt={a.name} onClick={() => void openAttachment(a)} /> : <span className="file-ico"><FileText size={22} /></span>}
                  <div className="att-info"><strong title={a.name}>{a.name}</strong><small className="muted">{formatBytes(a.size)} · {timeAgo(a.created_at)}</small></div>
                  <button className="icon-btn sm" onClick={() => void openAttachment(a)} aria-label="Descargar"><Download size={15} /></button>
                  {canEdit && <button className="icon-btn sm" onClick={() => void deleteAttachment(a)} aria-label="Quitar adjunto"><Trash2 size={14} /></button>}
                </li>
              ))}
            </ul>
            {canEdit && (
              <label className="btn sm">{uploading ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Añadir archivo
                <input type="file" multiple hidden onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} /></label>
            )}
            {canEdit && <small className="muted"> o arrastra / pega una imagen (máx. 10 MB)</small>}
          </div>

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
            <MentionInput value={comment} onChange={setComment} people={people.all} placeholder="Escribe un comentario… (@ para mencionar)" />
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
            {canEdit && (
              <span className="quick-dates">
                {([['Hoy', 0], ['Mañana', 1], ['+1 sem', 7]] as const).map(([l, d]) => (
                  <button key={l} type="button" className="chip" onClick={() => { const t = new Date(); t.setDate(t.getDate() + d); patch({ due_date: fromInputDate(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`) }) }}>{l}</button>
                ))}
                {card.due_date && <button type="button" className="chip" onClick={() => patch({ due_date: null })}>Quitar</button>}
              </span>
            )}
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

          {canEdit && (
            <label className="side-field"><span><ArrowRightLeft size={14} /> Mover a</span>
              <select value={card.list_id} onChange={e => void moveTo(e.target.value)}>{[...board.lists].sort((a, b) => a.position - b.position).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          )}
          {canEdit && <button className="btn block" onClick={() => void duplicate()}><Copy size={15} /> Duplicar tarjeta</button>}
          {canEdit && <button className="btn danger block" onClick={deleteCard}><Trash2 size={15} /> Eliminar</button>}
        </aside>
      </div>
    </Modal>
  )
}
