import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { sb } from '../lib/supabase'
import type { Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const claimed = useRef<string | null>(null)

  const loadProfile = useCallback(async (userId: string) => {
    // El perfil lo crea un trigger al registrarse; reintenta por si tarda unos ms.
    for (let i = 0; i < 4; i++) {
      const { data } = await sb().from('profiles').select('*').eq('id', userId).maybeSingle()
      if (data) { setProfile(data as Profile); return }
      await new Promise(r => setTimeout(r, 400))
    }
    setProfile(null)
  }, [])

  useEffect(() => {
    let alive = true
    sb().auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = sb().auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) { setProfile(null); setLoading(false) }
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    let alive = true
    ;(async () => {
      // Acepta invitaciones pendientes para este correo (estudio y proyectos)
      if (claimed.current !== userId) {
        claimed.current = userId
        await sb().rpc('claim_invites')
      }
      await loadProfile(userId)
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [userId, loadProfile])

  const value = useMemo<AuthState>(() => ({
    session, profile, loading,
    refreshProfile: async () => { if (userId) await loadProfile(userId) },
    signOut: async () => { claimed.current = null; await sb().auth.signOut() },
  }), [session, profile, loading, userId, loadProfile])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth fuera de AuthProvider')
  return v
}
