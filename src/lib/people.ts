import { useCallback, useEffect, useState } from 'react'
import { sb } from './supabase'
import { primeProfiles } from './profiles'
import type { Profile, Project, ProjectInvite, ProjectMember } from './types'

export interface PeopleData {
  studio: Profile[]            // miembros del estudio del proyecto
  collaborators: ProjectMember[] // colaboradores solo de este proyecto
  invites: ProjectInvite[]
  all: Profile[]
  reload: () => Promise<void>
}

/** Quién puede acceder a un proyecto: equipo del estudio + colaboradores del proyecto. */
export function useProjectPeople(project: Project | null): PeopleData {
  const [studio, setStudio] = useState<Profile[]>([])
  const [collaborators, setCollab] = useState<ProjectMember[]>([])
  const [invites, setInvites] = useState<ProjectInvite[]>([])

  const reload = useCallback(async () => {
    if (!project) return
    const [sm, pm, inv] = await Promise.all([
      sb().from('studio_members').select('profiles(*)').eq('studio_id', project.studio_id),
      sb().from('project_members').select('*, profiles(*)').eq('project_id', project.id),
      sb().from('project_invites').select('*').eq('project_id', project.id),
    ])
    const s = ((sm.data ?? []) as unknown as { profiles: Profile | null }[]).map(r => r.profiles).filter(Boolean) as Profile[]
    const c = (pm.data ?? []) as unknown as ProjectMember[]
    primeProfiles([...s, ...c.map(x => x.profiles)])
    setStudio(s); setCollab(c); setInvites((inv.data ?? []) as ProjectInvite[])
  }, [project?.id, project?.studio_id])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (!project) return
    const ch = sb().channel(`people-${project.id}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${project.id}` }, () => { void reload() })
      .subscribe()
    return () => { void sb().removeChannel(ch) }
  }, [project?.id, reload])

  const seen = new Set<string>()
  const all = [...studio, ...collaborators.map(c => c.profiles).filter(Boolean) as Profile[]].filter(p => !seen.has(p.id) && !!seen.add(p.id))
  return { studio, collaborators, invites, all, reload }
}
