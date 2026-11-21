import { useEffect, useState } from 'react'
import { sb } from './supabase'
import type { Profile } from './types'

const cache = new Map<string, Profile>()
const inflight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

async function fetchMissing(ids: string[]) {
  const need = ids.filter(id => id && !cache.has(id))
  if (!need.length) return
  const key = need.sort().join(',')
  let p = inflight.get(key)
  if (!p) {
    p = (async () => {
      const { data } = await sb().from('profiles').select('*').in('id', need)
      for (const row of (data ?? []) as Profile[]) cache.set(row.id, row)
      listeners.forEach(l => l())
    })().finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  await p
}

export function primeProfiles(list: (Profile | null | undefined)[]) {
  let changed = false
  for (const p of list) if (p && !cache.has(p.id)) { cache.set(p.id, p); changed = true }
  if (changed) listeners.forEach(l => l())
}

/** Devuelve una función id → perfil que se actualiza sola al cargar los que faltan. */
export function useProfiles(ids: (string | null | undefined)[]) {
  const [, force] = useState(0)
  const key = [...new Set(ids.filter(Boolean) as string[])].sort().join(',')
  useEffect(() => {
    const l = () => force(n => n + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  useEffect(() => { if (key) void fetchMissing(key.split(',')) }, [key])
  return (id: string | null | undefined): Profile | undefined => (id ? cache.get(id) : undefined)
}

export function profileName(p?: Profile | null) {
  return p?.display_name || p?.username || p?.email?.split('@')[0] || 'Alguien'
}
