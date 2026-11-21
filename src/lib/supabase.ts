import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const LS_URL = 'forja.supabase.url'
const LS_KEY = 'forja.supabase.key'

function ls(key: string): string {
  try { return localStorage.getItem(key) || '' } catch { return '' }
}

export function readConfig() {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || ls(LS_URL)
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || ls(LS_KEY)
  return { url: url.trim().replace(/\/+$/, ''), key: key.trim() }
}

export function saveConfig(url: string, key: string) {
  localStorage.setItem(LS_URL, url.trim().replace(/\/+$/, ''))
  localStorage.setItem(LS_KEY, key.trim())
}

export function clearConfig() {
  try { localStorage.removeItem(LS_URL); localStorage.removeItem(LS_KEY) } catch { /* noop */ }
}

export function configFromEnv(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}

const cfg = readConfig()

/** null mientras no haya configuración de Supabase (la app muestra la pantalla de configuración). */
export const supabase: SupabaseClient | null =
  cfg.url && cfg.key
    ? createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        realtime: { params: { eventsPerSecond: 30 } },
      })
    : null

/** Para código que solo corre con sesión (la app ya comprobó que existe). */
export function sb(): SupabaseClient {
  if (!supabase) throw new Error('Supabase no está configurado')
  return supabase
}

export const SUPABASE_URL = cfg.url
