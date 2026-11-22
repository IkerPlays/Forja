import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, KanbanSquare, Users, Loader2, Upload } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useStudio } from '../context/StudioContext'
import { Empty, Field, Modal, PageHeader, Progress, Spinner, ColorPicker, useToast } from '../components/ui'
import type { Project, ProjectStats } from '../lib/types'
import { COLORS, errMsg } from '../lib/util'
import { parseTrello, type TrelloImport } from '../lib/trello'
import { importTrello } from '../lib/trelloImport'

export default function Projects() {
  const { session } = useAuth()
  const { active, studios, isMember } = useStudio()
  const toast = useToast()
  const nav = useNavigate()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [stats, setStats] = useState<Record<string, ProjectStats>>({})
  const [creating, setCreating] = useState(false)
  const [trello, setTrello] = useState<TrelloImport | null>(null)
  const [importing, setImporting] = useState(false)
  const [withArchived, setWithArchived] = useState(false)
  const [rawTrello, setRawTrello] = useState<unknown>(null)

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      sb().from('projects').select('*').eq('archived', false).order('created_at', { ascending: false }),
      sb().from('project_stats').select('*'),
    ])
    setProjects((p.data ?? []) as Project[])
    setStats(Object.fromEntries(((s.data ?? []) as ProjectStats[]).map(x => [x.project_id, x])))
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const ch = sb().channel('projects-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members' }, () => { void load() })
      .subscribe()
    return () => { void sb().removeChannel(ch) }
  }, [load])

  if (!projects) return <Spinner />

  const myStudioIds = new Set(studios.map(s => s.id))
  const own = projects.filter(p => p.studio_id === active?.id)
  const shared = projects.filter(p => !myStudioIds.has(p.studio_id))

  const card = (p: Project) => {
    const st = stats[p.id]
    return (
      <Link key={p.id} to={`/tasks/${p.id}`} className="card-tile project-tile" style={{ ['--accent' as string]: p.color }}>
        <div className="tile-bar" />
        <h3>{p.name}</h3>
        {p.description && <p className="muted clamp">{p.description}</p>}
        <div className="tile-foot">
          <Progress value={st?.done ?? 0} total={st?.total ?? 0} color={p.color} />
          <small className="muted">
            {st?.total ? `${st.done}/${st.total} tareas` : 'Sin tareas'}{st?.overdue ? ` · ${st.overdue} vencidas` : ''}
          </small>
        </div>
      </Link>
    )
  }

  return (
    <div className="page">
      <PageHeader title="Tareas" sub="Tus proyectos, al estilo Trello, en tiempo real."
        actions={isMember && <>
          <label className="btn"><Upload size={16} /> Importar de Trello
            <input type="file" accept=".json,application/json" hidden onChange={async e => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (!f) return
              try { const raw = JSON.parse(await f.text()); setRawTrello(raw); setTrello(parseTrello(raw)); setWithArchived(false) } catch (er) { toast(errMsg(er), 'err') }
            }} /></label>
          <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Nuevo proyecto</button>
        </>} />

      {isMember && (own.length ? <div className="grid">{own.map(card)}</div> : (
        <Empty icon={<KanbanSquare size={28} />} title="Aún no tienes proyectos"
          text="Crea uno para empezar a organizar tareas, o desde un juego para sincronizarlo."
          action={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Crear proyecto</button>} />
      ))}

      {shared.length > 0 && (
        <>
          <h2 className="section-title"><Users size={16} /> Compartidos conmigo</h2>
          <div className="grid">{shared.map(card)}</div>
        </>
      )}

      {trello && active && (
        <Modal title="Importar de Trello" onClose={() => setTrello(null)}>
          <div className="stack">
            <p><strong>{trello.name}</strong></p>
            <p className="muted small">{trello.lists.length} listas · {trello.cards.length} tarjetas · {trello.labels.length} etiquetas · {trello.cards.reduce((n, c) => n + c.checklist.length, 0)} elementos de checklist.
              {(trello.skipped.lists || trello.skipped.cards) ? ` Se omiten ${trello.skipped.lists} listas y ${trello.skipped.cards} tarjetas archivadas.` : ''}</p>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={withArchived} onChange={e => { setWithArchived(e.target.checked); try { setTrello(parseTrello(rawTrello, e.target.checked)) } catch { /* noop */ } }} /> Incluir archivadas</label>
            <p className="muted small">Se importan listas, tarjetas, descripciones, fechas, etiquetas y checklists. En Trello: menú del tablero → Imprimir y exportar → Exportar como JSON.</p>
            <button className="btn primary" disabled={importing} onClick={async () => {
              setImporting(true)
              try { const id = await importTrello(trello, active.id, session!.user.id, COLORS[4]); toast('Tablero importado'); setTrello(null); nav(`/tasks/${id}`) }
              catch (er) { toast(errMsg(er), 'err') } finally { setImporting(false) }
            }}>{importing && <Loader2 size={14} className="spin" />} Importar</button>
          </div>
        </Modal>
      )}
      {creating && active && (
        <CreateProject studioId={active.id} userId={session!.user.id} onClose={() => setCreating(false)}
          onCreated={id => { toast('Proyecto creado'); nav(`/tasks/${id}`) }} />
      )}
    </div>
  )
}

function CreateProject({ studioId, userId, onClose, onCreated }: {
  studioId: string; userId: string; onClose: () => void; onCreated: (id: string) => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { data, error } = await sb().from('projects')
      .insert({ studio_id: studioId, name: name.trim(), description: desc.trim(), color, created_by: userId })
      .select('id').single()
    setBusy(false)
    if (error) return toast(errMsg(error), 'err')
    onCreated(data!.id)
  }

  return (
    <Modal title="Nuevo proyecto" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label="Nombre"><input value={name} onChange={e => setName(e.target.value)} required maxLength={120} autoFocus /></Field>
        <Field label="Descripción (opcional)"><textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} /></Field>
        <Field label="Color"><ColorPicker value={color} onChange={setColor} colors={COLORS} /></Field>
        <button className="btn primary" disabled={busy || !name.trim()}>{busy && <Loader2 size={14} className="spin" />} Crear</button>
      </form>
    </Modal>
  )
}
