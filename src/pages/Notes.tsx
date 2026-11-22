import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eye, FileText, Pencil, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useStudio } from '../context/StudioContext'
import { Empty, PageHeader, Spinner, useToast } from '../components/ui'
import { Markdown } from '../lib/markdown'
import { cn, errMsg, timeAgo } from '../lib/util'

interface Note { id: string; studio_id: string; title: string; body: string; pinned: boolean; updated_at: string; updated_by: string | null }

/** Notas del estudio (Markdown, en tiempo real). */
export default function Notes() {
  const { session } = useAuth()
  const { active } = useStudio()
  const toast = useToast()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(true)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)

  const load = useCallback(async () => {
    if (!active) return
    const { data, error } = await sb().from('notes').select('*').eq('studio_id', active.id).order('pinned', { ascending: false }).order('updated_at', { ascending: false })
    if (error) { toast(/notes/.test(error.message) ? 'Falta la tabla «notes»: vuelve a ejecutar supabase/02_app.sql' : errMsg(error), 'err'); setNotes([]); return }
    setNotes((data ?? []) as Note[])
  }, [active, toast])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!active) return
    const ch = sb().channel(`notes-${active.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `studio_id=eq.${active.id}` }, () => { if (!dirty.current) void load() }).subscribe()
    return () => { void sb().removeChannel(ch) }
  }, [active, load])

  const current = useMemo(() => notes?.find(n => n.id === sel) ?? null, [notes, sel])
  useEffect(() => { if (current && !dirty.current) { setTitle(current.title); setBody(current.body) } }, [current?.id, current?.updated_at])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { dirty.current = false; if (current) { setTitle(current.title); setBody(current.body) } }, [sel])  // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback((t: string, b: string, id: string) => {
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const { error } = await sb().from('notes').update({ title: t.trim() || 'Sin título', body: b, updated_by: session!.user.id }).eq('id', id)
      dirty.current = false
      if (error) toast(errMsg(error), 'err'); else void load()
    }, 700)
  }, [session, toast, load])

  async function create() {
    if (!active) return
    const { data, error } = await sb().from('notes').insert({ studio_id: active.id, title: 'Nueva nota', body: '', created_by: session!.user.id, updated_by: session!.user.id }).select().single()
    if (error) return toast(errMsg(error), 'err')
    await load(); setSel((data as Note).id); setEdit(true)
  }
  async function togglePin(n: Note) { await sb().from('notes').update({ pinned: !n.pinned }).eq('id', n.id); void load() }
  async function remove(n: Note) {
    if (!confirm(`¿Eliminar la nota «${n.title}»?`)) return
    await sb().from('notes').delete().eq('id', n.id); setSel(null); void load()
  }

  if (!active || !notes) return <Spinner />
  const shown = notes.filter(n => !q || (n.title + ' ' + n.body).toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="page">
      <PageHeader title="Notas" sub="Documentos del estudio en Markdown, compartidos en tiempo real." actions={<button className="btn primary" onClick={create}><Plus size={16} /> Nueva nota</button>} />
      {!notes.length ? (
        <Empty icon={<FileText size={28} />} title="Aún no hay notas" text="Ideas de diseño, normas del estudio, listas de compras… Soporta títulos, listas, casillas y código."
          action={<button className="btn primary" onClick={create}><Plus size={16} /> Crear la primera</button>} />
      ) : (
        <div className="notes-layout">
          <aside className="notes-list">
            <div className="search"><Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar en notas…" /></div>
            <ul>
              {shown.map(n => (
                <li key={n.id}><button className={cn(sel === n.id && 'on')} onClick={() => setSel(n.id)}>
                  {n.pinned && <Pin size={12} />}<strong>{n.title}</strong><small className="muted">{timeAgo(n.updated_at)}</small></button></li>
              ))}
            </ul>
          </aside>
          <section className="notes-editor panel">
            {!current ? <p className="muted">Elige una nota.</p> : (
              <>
                <div className="row wrap">
                  <input className="title-input" value={title} onChange={e => { setTitle(e.target.value); save(e.target.value, body, current.id) }} aria-label="Título" />
                  <div className="spacer" />
                  <button className="btn sm" onClick={() => setEdit(e => !e)}>{edit ? <><Eye size={14} /> Vista</> : <><Pencil size={14} /> Editar</>}</button>
                  <button className="icon-btn" aria-label="Descargar .md" title="Descargar como .md" onClick={() => {
                    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`# ${title}\n\n${body}`], { type: 'text/markdown' }))
                    a.download = `${(title || 'nota').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60)}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
                  }}><Download size={16} /></button>
                  <button className="icon-btn" onClick={() => togglePin(current)} aria-label="Fijar">{current.pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
                  <button className="icon-btn" onClick={() => remove(current)} aria-label="Eliminar"><Trash2 size={16} /></button>
                </div>
                {edit
                  ? <textarea className="note-area" value={body} placeholder={'# Título\n\n- [ ] tarea\n- **negrita**, *cursiva*, `código`'} onChange={e => { setBody(e.target.value); save(title, e.target.value, current.id) }} />
                  : <Markdown text={body || '*Nota vacía*'} />}
                <small className="muted">Se guarda sola · {body.trim() ? body.trim().split(/\s+/).length : 0} palabras · actualizada {timeAgo(current.updated_at)}</small>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
