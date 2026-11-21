// Forja bridge — se ejecuta en tu PC y atiende dispositivos (PC o 3DS) de tu estudio.
import os from 'node:os'
import { createClient } from '@supabase/supabase-js'
import { log, warn, sleep } from './util.mjs'
import { handlePcInput, loadRobot, parseRoots, pcHandlers, pcInfo } from './pc.mjs'
import { dsHandlers, PadSender } from './ds.mjs'

const { SUPABASE_URL, SUPABASE_ANON_KEY, FORJA_EMAIL, FORJA_PASSWORD } = process.env
const deviceIds = process.argv.slice(2).filter(a => !a.startsWith('-'))

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !FORJA_EMAIL || !FORJA_PASSWORD) {
  console.error('Faltan variables. Copia .env.example a .env y rellénalo (SUPABASE_URL, SUPABASE_ANON_KEY, FORJA_EMAIL, FORJA_PASSWORD).')
  process.exit(1)
}
if (!deviceIds.length) {
  console.error('Uso: node --env-file=.env src/index.mjs <id-del-dispositivo> [otro-id…]\nEl ID aparece en la web: dispositivo → Conexión → Instrucciones del bridge.')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: true } })
const roots = parseRoots(process.env.PC_ROOTS)
const allowInput = process.env.ALLOW_INPUT !== '0'

async function login() {
  const { error } = await sb.auth.signInWithPassword({ email: FORJA_EMAIL, password: FORJA_PASSWORD })
  if (error) { console.error('No se pudo iniciar sesión en Forja:', error.message); process.exit(1) }
  log('Sesión iniciada como', FORJA_EMAIL)
}

async function serve(id) {
  const { data: first, error } = await sb.from('devices').select('*').eq('id', id).maybeSingle()
  if (error || !first) { warn(`Dispositivo ${id} no encontrado o sin acceso`); return }
  let device = first
  const getCfg = () => device.config || {}
  const tag = `[${device.name}]`
  log(tag, `atendiendo (${device.kind})`)

  const ctx = {
    async uploadToStorage(cmd, name, buffer) {
      const key = `${device.studio_id}/${device.id}/${cmd.id}-${name.replace(/[^\w.\- ]/g, '_')}`
      const { error: e } = await sb.storage.from('transfers').upload(key, buffer, { upsert: true, contentType: 'application/octet-stream' })
      if (e) throw new Error('No se pudo subir al almacenamiento: ' + e.message)
      return key
    },
    async downloadFromStorage(key) {
      const { data, error: e } = await sb.storage.from('transfers').download(key)
      if (e) throw new Error('No se pudo leer el archivo subido: ' + e.message)
      const buf = Buffer.from(await data.arrayBuffer())
      void sb.storage.from('transfers').remove([key])
      return buf
    },
  }
  const handlers = device.kind === 'pc' ? pcHandlers(roots, ctx) : dsHandlers(getCfg, ctx)
  const info = device.kind === 'pc'
    ? () => ({ ...pcInfo(roots), Control: robotOk && allowInput ? 'ratón y teclado activos' : 'desactivado (sin robotjs o ALLOW_INPUT=0)' })
    : () => ({ Equipo: os.hostname(), 'IP 3DS': getCfg().ip || '—', Bridge: 'forja-bridge 0.1.0' })

  const heartbeat = async () => {
    const { error: e } = await sb.rpc('device_heartbeat', { p_device: id, p_info: info() })
    if (e) warn(tag, 'latido:', e.message)
  }
  await heartbeat()
  setInterval(heartbeat, 20_000)
  // Recoge cambios de configuración hechos en la web (IP, puertos…)
  setInterval(async () => {
    const { data } = await sb.from('devices').select('*').eq('id', id).maybeSingle()
    if (data) device = data
  }, 60_000)

  /* ---- Órdenes ---- */
  const busy = new Set()
  async function run(cmd) {
    if (busy.has(cmd.id)) return
    busy.add(cmd.id)
    try {
      // Reclama la orden (solo uno la ejecuta aunque haya dos bridges)
      const { data: claimed } = await sb.from('device_commands').update({ status: 'running' }).eq('id', cmd.id).eq('status', 'pending').select().maybeSingle()
      if (!claimed) return
      const fn = handlers[cmd.type]
      if (!fn) throw new Error(`Orden desconocida: ${cmd.type}`)
      const result = await fn(cmd.payload || {}, cmd)
      await sb.from('device_commands').update({ status: 'done', result, finished_at: new Date().toISOString() }).eq('id', cmd.id)
    } catch (e) {
      warn(tag, cmd.type, '→', e.message)
      await sb.from('device_commands').update({ status: 'error', error: String(e.message || e).slice(0, 400), finished_at: new Date().toISOString() }).eq('id', cmd.id)
    } finally { busy.delete(cmd.id) }
  }
  const pending = async () => {
    const { data } = await sb.from('device_commands').select('*').eq('device_id', id).eq('status', 'pending').order('created_at')
    for (const c of data ?? []) void run(c)
  }
  sb.channel(`bridge-cmd-${id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'device_commands', filter: `device_id=eq.${id}` }, p => void run(p.new))
    .subscribe()
  setInterval(pending, 5_000) // red de seguridad por si Realtime pierde algún evento
  await pending()

  /* ---- Entrada en tiempo real (mando 3DS / ratón y teclado del PC) ---- */
  const pad = device.kind === '3ds' ? new PadSender(getCfg) : null
  const link = sb.channel(`device:${id}`, { config: { private: true, broadcast: { self: false }, presence: { key: `bridge-${os.hostname()}` } } })
  link.on('broadcast', { event: 'input' }, ({ payload: m }) => {
    if (pad && m.k === 'pad') pad.update(m.s)
    else if (!pad && allowInput && (m.k === 'mouse' || m.k === 'key')) handlePcInput(m)
  })
  link.subscribe(async st => {
    if (st === 'SUBSCRIBED') { await link.track({ role: 'bridge' }); log(tag, 'canal en tiempo real listo') }
    else if (st === 'CHANNEL_ERROR') warn(tag, 'canal privado rechazado: ¿ejecutaste 02_app.sql completo?')
  })
}

let robotOk = false
await login()
robotOk = await loadRobot()
if (!robotOk) warn('robotjs no está instalado: no se podrá controlar el ratón/teclado de este PC (el resto funciona).')
if (roots.length) log('Carpetas expuestas:', roots.map(r => `${r.alias} → ${r.abs}`).join(' | '))
for (const id of deviceIds) await serve(id)
log('Bridge en marcha. Ctrl+C para salir.')
process.on('SIGINT', () => process.exit(0))
await sleep(2 ** 31 - 1)
