import { useState } from 'react'
import { Download, Loader2, Mail, Plus, Tag, Trash2, UserPlus } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useStudio } from '../context/StudioContext'
import type { BoardData } from '../lib/board'
import { useProjectPeople } from '../lib/people'
import { profileName } from '../lib/profiles'
import { Avatar, ColorPicker, Field, Modal, useToast } from './ui'
import { COLORS, errMsg } from '../lib/util'
import { exportProject } from '../lib/backup'
import type { ProjectRole } from '../lib/types'

export default function ProjectSettings({ board, canEdit, upsert, remove, onClose, onDeleted }: {
  board: BoardData; canEdit: boolean; upsert: (k: any, r: any) => void; remove: (k: any, id: string) => void; onClose: () => void; onDeleted: () => void
}) {
  const project = board.project!
  const { session } = useAuth()
  const { studios } = useStudio()
  const toast = useToast()
  const people = useProjectPeople(project)
  const inStudio = studios.some(s => s.id === project.studio_id)
  const [name, setName] = useState(project.name)
  const [desc, setDesc] = useState(project.description)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProjectRole>('editor')
  const [busy, setBusy] = useState(false)

  async function save(values: Record<string, unknown>) {
    const { error } = await sb().from('projects').update(values).eq('id', project.id)
    if (error) toast(errMsg(error), 'err'); else toast('Guardado')
  }
  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { data, error } = await sb().rpc('invite_to_project', { p_project: project.id, p_email: email, p_role: role })
    setBusy(false)
    if (error) return toast(errMsg(error), 'err')
    toast(data === 'added' ? 'Colaborador añadido al proyecto' : 'Invitación guardada: se unirá al entrar con ese correo')
    setEmail(''); await people.reload()
  }
  async function removeMember(userId: string) {
    const { error } = await sb().from('project_members').delete().eq('project_id', project.id).eq('user_id', userId)
    if (error) return toast(errMsg(error), 'err')
    await people.reload()
  }
  async function setMemberRole(userId: string, r: ProjectRole) {
    await sb().from('project_members').update({ role: r }).eq('project_id', project.id).eq('user_id', userId)
    await people.reload()
  }
  async function cancelInvite(id: string) {
    await sb().from('project_invites').delete().eq('id', id)
    await people.reload()
  }
  async function del() {
    if (!confirm(`¿Eliminar el proyecto «${project.name}» con todas sus tarjetas y chat? No se puede deshacer.`)) return
    const { error } = await sb().from('projects').delete().eq('id', project.id)
    if (error) return toast(errMsg(error), 'err')
    onDeleted()
  }

  return (
    <Modal title="Proyecto y colaboradores" wide onClose={onClose}>
      <div className="stack gap">
        {canEdit && (
          <section className="stack">
            <Field label="Nombre"><input value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== project.name && save({ name: name.trim() })} /></Field>
            <Field label="Descripción"><textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => desc !== project.description && save({ description: desc })} /></Field>
            <Field label="Color"><ColorPicker colors={COLORS} value={project.color} onChange={c => save({ color: c })} /></Field>
          </section>
        )}

        {canEdit && (
          <section className="stack">
            <h3><Tag size={15} /> Etiquetas</h3>
            <div className="labels-edit">
              {board.labels.map(l => (
                <div key={l.id} className="label-row">
                  <input type="color" value={l.color} aria-label="Color" onChange={e => { upsert('labels', { ...l, color: e.target.value }); void sb().from('project_labels').update({ color: e.target.value }).eq('id', l.id) }} />
                  <input defaultValue={l.name} placeholder="Nombre" onBlur={e => { if (e.target.value !== l.name) { upsert('labels', { ...l, name: e.target.value }); void sb().from('project_labels').update({ name: e.target.value }).eq('id', l.id) } }} />
                  <button className="icon-btn sm" aria-label="Eliminar etiqueta" onClick={async () => { remove('labels', l.id); await sb().from('project_labels').delete().eq('id', l.id) }}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <button className="btn sm" onClick={async () => {
              const { data, error } = await sb().from('project_labels').insert({ project_id: project.id, name: 'Nueva', color: COLORS[board.labels.length % COLORS.length] }).select().single()
              if (error) return toast(errMsg(error), 'err'); upsert('labels', data)
            }}><Plus size={14} /> Añadir etiqueta</button>
          </section>
        )}

        <section className="stack">
          <h3>Colaboradores de este proyecto</h3>
          <p className="muted small">
            Solo ven y editan <strong>este</strong> proyecto (no son del estudio). Para dar acceso a todo el estudio usa la sección Equipo.
          </p>
          {people.studio.length > 0 && (
            <div className="people">
              {people.studio.map(p => (
                <div key={p.id} className="person"><Avatar profile={p} /><div><strong>{profileName(p)}</strong><small className="muted">{p.email}</small></div><span className="chip">Estudio</span></div>
              ))}
            </div>
          )}
          <div className="people">
            {people.collaborators.map(m => (
              <div key={m.user_id} className="person">
                <Avatar profile={m.profiles} /><div><strong>{profileName(m.profiles)}</strong><small className="muted">{m.profiles?.email}</small></div>
                {canEdit ? (
                  <>
                    <select value={m.role} onChange={e => setMemberRole(m.user_id, e.target.value as ProjectRole)}>
                      <option value="editor">Editor</option><option value="viewer">Lector</option>
                    </select>
                    <button className="icon-btn sm" onClick={() => removeMember(m.user_id)} aria-label="Quitar"><Trash2 size={15} /></button>
                  </>
                ) : <span className="chip">{m.role === 'editor' ? 'Editor' : 'Lector'}</span>}
              </div>
            ))}
            {people.invites.map(i => (
              <div key={i.id} className="person pending"><span className="avatar"><Mail size={14} /></span><div><strong>{i.email}</strong><small className="muted">Invitación pendiente</small></div>
                <button className="icon-btn sm" onClick={() => cancelInvite(i.id)} aria-label="Cancelar"><Trash2 size={15} /></button></div>
            ))}
            {!people.collaborators.length && !people.invites.length && <p className="muted small">Todavía no hay colaboradores externos.</p>}
          </div>
          {canEdit && (
            <form className="inline-form wrap" onSubmit={invite}>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@ejemplo.com" />
              <select value={role} onChange={e => setRole(e.target.value as ProjectRole)}><option value="editor">Editor</option><option value="viewer">Lector</option></select>
              <button className="btn primary" disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} Invitar</button>
            </form>
          )}
        </section>

        <section>
          <button className="btn" onClick={() => exportProject(board)}><Download size={15} /> Exportar proyecto (JSON)</button>
        </section>

        {inStudio && (
          <section>
            <button className="btn danger" onClick={del}><Trash2 size={15} /> Eliminar proyecto</button>
          </section>
        )}
        {session && null}
      </div>
    </Modal>
  )
}
