import { useEffect, useSyncExternalStore } from 'react'
import { desktop } from '../lib/native'
import { desktopHost } from '../lib/desktopHost'
import { useAuth } from '../context/AuthContext'
import { useStudio } from '../context/StudioContext'

export function useHostState() {
  return useSyncExternalStore(l => desktopHost.subscribe(l), () => desktopHost.state)
}

/** Solo en la app de escritorio: arranca el anfitrión cuando hay sesión y estudio. */
export default function DesktopHostMount() {
  const { session } = useAuth()
  const { active } = useStudio()
  const uid = session?.user.id
  const sid = active?.id
  useEffect(() => {
    if (!desktop || !uid || !sid) return
    void desktopHost.start(sid, uid)
  }, [uid, sid])
  useEffect(() => () => { void desktopHost.stop() }, [])
  return null
}
