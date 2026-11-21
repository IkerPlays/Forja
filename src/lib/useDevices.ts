import { useCallback, useEffect, useState } from 'react'
import { sb } from './supabase'
import type { Device, DeviceKind } from './types'

export function useDevices(studioId: string | undefined, kind: DeviceKind) {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const load = useCallback(async () => {
    if (!studioId) return
    const { data } = await sb().from('devices').select('*').eq('studio_id', studioId).eq('kind', kind).order('created_at')
    setDevices((data ?? []) as Device[])
  }, [studioId, kind])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!studioId) return
    const ch = sb().channel(`devices-${studioId}-${kind}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `studio_id=eq.${studioId}` }, () => { void load() })
      .subscribe()
    return () => { void sb().removeChannel(ch) }
  }, [studioId, kind, load])
  return { devices, reload: load }
}
