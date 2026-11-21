import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { sb } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { Role, Studio } from '../lib/types'

interface StudioState {
  studios: Studio[]
  roles: Record<string, Role>
  active: Studio | null
  role: Role | null
  isMember: boolean
  isAdmin: boolean
  loading: boolean
  setActive: (id: string) => void
  reload: () => Promise<void>
}

const Ctx = createContext<StudioState | null>(null)
const LS = 'forja.studio'

export function StudioProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const [studios, setStudios] = useState<Studio[]>([])
  const [roles, setRoles] = useState<Record<string, Role>>({})
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem(LS) } catch { return null }
  })
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!userId) return
    const { data } = await sb()
      .from('studio_members')
      .select('role, studios(*)')
      .eq('user_id', userId)
    const rows = (data ?? []) as unknown as { role: Role; studios: Studio | null }[]
    const list = rows.filter(r => r.studios).map(r => r.studios as Studio)
    setStudios(list)
    setRoles(Object.fromEntries(rows.filter(r => r.studios).map(r => [(r.studios as Studio).id, r.role])))
    setLoading(false)
  }, [userId])

  useEffect(() => { setLoading(true); void reload() }, [reload])

  // Si te añaden/quitan de un estudio mientras la app está abierta
  useEffect(() => {
    if (!userId) return
    const ch = sb()
      .channel(`studio-members-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_members', filter: `user_id=eq.${userId}` }, () => { void reload() })
      .subscribe()
    return () => { void sb().removeChannel(ch) }
  }, [userId, reload])

  const active = useMemo(
    () => studios.find(s => s.id === activeId) ?? studios[0] ?? null,
    [studios, activeId],
  )

  const value = useMemo<StudioState>(() => ({
    studios, roles, active,
    role: active ? roles[active.id] ?? null : null,
    isMember: !!active,
    isAdmin: !!active && (roles[active.id] === 'owner' || roles[active.id] === 'admin'),
    loading,
    setActive: (id: string) => { setActiveId(id); try { localStorage.setItem(LS, id) } catch { /* noop */ } },
    reload,
  }), [studios, roles, active, loading, reload])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStudio() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStudio fuera de StudioProvider')
  return v
}
