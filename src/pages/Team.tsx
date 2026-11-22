import { useCallback, useEffect, useState } from 'react'
import { Crown, Download, Loader2, Mail, Shield, Trash2, UserPlus, Users } from 'lucide-react'
import { exportStudio } from '../lib/backup'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useStudio } from '../context/StudioContext'
import { primeProfiles, profileName } from '../lib/profiles'
import type { ProjectMember, Role, StudioInvite, StudioMember, Project } from '../lib/types'
import { Avatar, Field, PageHeader, Spinner, useToast } from '../components/ui'
import { errMsg } from '../lib/util'

const ROLE_LABEL: Record<Role, string> = { owner: 'Propietario', admin: 'Administrador', member: 'Miembro' }

export default function Team() {
  const { session } = useAuth()
  const me = session!.user.id
  const { active, isAdmin, role, reload: reloadStudios } = useStudio()
  const toast = useToast()
  const [members, setMembers] = useState<StudioMember[] | null>(null)
  const [invites, setInvites] = useState<StudioInvite[]>([])
  const [external, setExternal] = useState<(ProjectMember & { project?: string })[]>([])
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(active?.name ?? '')

  const load = useCallback(async () => {
    if (!active) return
    const [m, i, pm, p] = await Promise.all([
      sb().from('studio_members').select('*, profiles(*)').eq('studio_id', active.id).order('added_at'),
      sb().from('studio_invites').select('*').eq('studio_id', active.id),
      sb().from('project_members').select('*, profiles(*)'),
      sb().from('projects').select('id,name,studio_id').eq('studio_id', active.id),
    ])
    const ms = (m.data ?? []) as unknown as StudioMember[]
    primeProfiles(ms.map(x => x.profiles))
    setMembers(ms); setInvites((i.data ?? []) as StudioInvite[])
    const names = Object.fromEntries(((p.data ?? []) as Pick<Project, 'id' | 'name'>[]).map(x => [x.id, x.name]))
    setExternal(((pm.data ?? []) as unknown as ProjectMember[]).filter(x => names[x.project_id]).map(x => ({ ...x, project: names[x.project_id] })))
  }, [active])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setName(active?.name ?? '') }, [active?.name])
  useEffect(() => {
    if (!active) return
    const ch = sb().channel(`team-${active.id}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_members', filter: `studio_id=eq.${active.id}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members' }, () => { void load() })
      .subscribe()
    return () => { void sb().removeChannel(ch) }
  }, [active, load])

  if (!active || !members) return <Spinner />

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { data, error } = await sb().rpc('invite_to_studio', { p_studio: active!.id, p_email: email, p_role: inviteRole })
    setBusy(false)
    if (error) return toast(errMsg(error), 'err')
    toast(data === 'added' ? 'Añadido al estudio' : 'Invitación guardada: entrará al registrarse/iniciar sesión con ese correo')
    setEmail(''); void load()
  }
  async function setRole(userId: string, r: 'admin' | 'member') {
    const { error } = await sb().from('studio_members').update({ role: r }).eq('studio_id', active!.id).eq('user_id', userId)
    if (error) toast(errMsg(error), 'err'); else void load()
  }
  async function remove(userId: string, self: boolean) {
    if (!confirm(self ? '¿Salir de este estudio?' : '¿Quitar a esta persona del estudio?')) return
    const { error } = await sb().from('studio_members').delete().eq('studio_id', active!.id).eq('user_id', userId)
    if (error) return toast(errMsg(error), 'err')
    if (self) await reloadStudios(); else void load()
  }
  async function rename() {
    if (!name.trim() || name === active!.name) return
    const { error } = await sb().from('studios').update({ name: name.trim() }).eq('id', active!.id)
    if (error) toast(errMsg(error), 'err'); else { toast('Nombre actualizado'); await reloadStudios() }
  }
  async function deleteStudio() {
    if (!confirm(`¿Eliminar el estudio «${active!.name}» con TODOS sus proyectos, juegos y dispositivos? No se puede deshacer.`)) return
    if (prompt('Escribe el nombre del estudio para confirmar') !== active!.name) return
    const { error } = await sb().from('studios').delete().eq('id', active!.id)
    if (error) return toast(errMsg(error), 'err')
    await reloadStudios()
  }

  return (
    <div className="page narrow">
      <PageHeader title="Equipo" sub="Las cuentas del estudio gestionan TODO: proyectos, juegos y dispositivos." />

      <section className="panel">
        <h2><Users size={17} /> Miembros del estudio</h2>
        <div className="people">
          {members.map(m => (
            <div key={m.user_id} className="person">
              <Avatar profile={m.profiles} size={34} />
              <div><strong>{profileName(m.profiles)}{m.user_id === me && ' (tú)'}</strong><small className="muted">{m.profiles?.email}</small></div>
              {m.role === 'owner' ? <span className="chip"><Crown size={12} /> {ROLE_LABEL.owner}</span>
                : isAdmin && m.user_id !== me ? (
                  <select value={m.role} onChange={e => setRole(m.user_id, e.target.value as 'admin' | 'member')}>
                    <option value="admin">Administrador</option><option value="member">Miembro</option>
                  </select>
                ) : <span className="chip">{m.role === 'admin' && <Shield size={12} />} {ROLE_LABEL[m.role]}</span>}
              {m.role !== 'owner' && (isAdmin || m.user_id === me) && (
                <button className="icon-btn sm" onClick={() => remove(m.user_id, m.user_id === me)} aria-label="Quitar"><Trash2 size={15} /></button>
              )}
            </div>
          ))}
          {invites.map(i => (
            <div key={i.id} className="person pending">
              <span className="avatar"><Mail size={15} /></span>
              <div><strong>{i.email}</strong><small className="muted">Invitación pendiente · {ROLE_LABEL[i.role]}</small></div>
              {isAdmin && <button className="icon-btn sm" aria-label="Cancelar invitación"
                onClick={async () => { await sb().from('studio_invites').delete().eq('id', i.id); void load() }}><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>
        {isAdmin && (
          <form className="inline-form wrap" onSubmit={invite}>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="correo de la persona" />
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}>
              <option value="member">Miembro</option><option value="admin">Administrador</option>
            </select>
            <button className="btn primary" disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} Añadir</button>
          </form>
        )}
        <p className="muted small">
          <strong>Miembro</strong>: gestiona proyectos, juegos y dispositivos. <strong>Administrador</strong>: además gestiona el equipo.
          Si la persona aún no tiene cuenta, entrará sola al estudio al registrarse con ese correo.
        </p>
      </section>

      <section className="panel">
        <h2>Colaboradores solo de Tareas</h2>
        <p className="muted small">Son cuentas con acceso a proyectos concretos, <strong>no</strong> al estudio. Se añaden desde cada tablero → Colaboradores.</p>
        <div className="people">
          {external.map(x => (
            <div key={x.project_id + x.user_id} className="person">
              <Avatar profile={x.profiles} /><div><strong>{profileName(x.profiles)}</strong><small className="muted">{x.profiles?.email}</small></div>
              <span className="chip">{x.project} · {x.role === 'editor' ? 'Editor' : 'Lector'}</span>
            </div>
          ))}
          {!external.length && <p className="muted small">No hay colaboradores externos todavía.</p>}
        </div>
      </section>

      {isAdmin && (
        <section className="panel">
          <h2>Ajustes del estudio</h2>
          <Field label="Nombre del estudio">
            <div className="inline-form"><input value={name} onChange={e => setName(e.target.value)} maxLength={80} /><button className="btn" onClick={rename} type="button">Guardar</button></div>
          </Field>
          <button className="btn" onClick={async () => { try { await exportStudio(active!.id, active!.name); toast('Copia descargada') } catch (e) { toast(errMsg(e), 'err') } }}><Download size={15} /> Descargar copia de seguridad (JSON)</button>
          {role === 'owner' && <button className="btn danger" onClick={deleteStudio}><Trash2 size={15} /> Eliminar estudio</button>}
        </section>
      )}
    </div>
  )
}
