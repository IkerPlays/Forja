import { sb } from './supabase'
import { MAX_FILE, PART } from './transfer'

/**
 * Agente del PC dentro del navegador (sin instalar nada): comparte UNA carpeta que eliges
 * con el File System Access API y atiende las órdenes de archivos mientras la pestaña esté abierta.
 * Solo Chrome/Edge de escritorio.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dir = any
type Cmd = { id: string; studio_id: string; type: string; path?: string; to?: string; storage?: string; parts?: number; size?: number; kind?: string }

export const pcAgentSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

/* ---- Persistencia del permiso de carpeta (IndexedDB) ---- */
const DB = 'forja-agent', STORE = 'dirs'
const idb = (): Promise<IDBDatabase> => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1)
  r.onupgradeneeded = () => r.result.createObjectStore(STORE)
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
})
export async function saveHandle(deviceId: string, h: Dir) {
  const db = await idb(); await new Promise<void>((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(h, deviceId); t.oncomplete = () => res(); t.onerror = () => rej(t.error) })
}
export async function loadHandle(deviceId: string): Promise<Dir | null> {
  try { const db = await idb(); return await new Promise(res => { const q = db.transaction(STORE).objectStore(STORE).get(deviceId); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null) }) } catch { return null }
}

const segs = (p?: string) => String(p || '/').split('/').filter(Boolean)
const safe = (parts: string[]) => { if (parts.some(x => x === '..' || x === '.')) throw new Error('Ruta no válida'); return parts }

async function dirAt(root: Dir, parts: string[], create = false): Promise<Dir> {
  let d = root
  for (const p of safe(parts)) d = await d.getDirectoryHandle(p, { create })
  return d
}

export class PcFolderAgent {
  private stopped = false
  private busy = false
  private timers: ReturnType<typeof setInterval>[] = []
  private ch: ReturnType<ReturnType<typeof sb>['channel']> | null = null
  onLog: (s: string) => void = () => {}

  constructor(public deviceId: string, public root: Dir) {}

  async start() {
    const beat = () => void sb().rpc('device_heartbeat', {
      p_device: this.deviceId, p_info: { proto: 2, Agente: 'Navegador (carpeta compartida)', Carpeta: this.root.name },
    })
    beat(); this.timers.push(setInterval(beat, 20_000))
    this.ch = sb().channel(`agent-${this.deviceId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'device_commands', filter: `device_id=eq.${this.deviceId}` }, () => void this.pump())
      .subscribe()
    this.timers.push(setInterval(() => void this.pump(), 3000))
    void this.pump()
  }

  stop() {
    this.stopped = true
    this.timers.forEach(clearInterval)
    if (this.ch) void sb().removeChannel(this.ch)
  }

  private async pump() {
    if (this.busy || this.stopped) return
    this.busy = true
    try {
      for (;;) {
        const { data, error } = await sb().rpc('device_command_claim', { p_device: this.deviceId })
        if (error || !data) break
        await this.run(data as Cmd)
      }
    } finally { this.busy = false }
  }

  private async run(c: Cmd) {
    try {
      const fn = (this as unknown as Record<string, (c: Cmd) => Promise<unknown>>)['do_' + c.type]
      if (!fn) throw new Error(`Orden desconocida: ${c.type}`)
      this.onLog(`${c.type} ${c.path ?? ''}`)
      const result = await fn.call(this, c)
      await sb().rpc('device_command_finish', { p_id: c.id, p_status: 'done', p_result: result ?? {} })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.onLog(`error: ${msg}`)
      await sb().rpc('device_command_finish', { p_id: c.id, p_status: 'error', p_error: msg })
    }
  }

  /* ---------------- Órdenes ---------------- */
  async do_list_dir(c: Cmd) {
    const d = await dirAt(this.root, segs(c.path))
    const items: { name: string; h: Dir }[] = []
    for await (const [name, h] of d.entries()) { items.push({ name, h }); if (items.length >= 2000) break }
    const entries = await Promise.all(items.map(async ({ name, h }) => {
      if (h.kind === 'directory') return { name, type: 'dir', size: 0, mtime: null }
      try { const f = await h.getFile(); return { name, type: 'file', size: f.size, mtime: f.lastModified } } catch { return { name, type: 'file', size: 0, mtime: null } }
    }))
    return { entries, truncated: items.length >= 2000 }
  }

  private async fileAt(path?: string, create = false) {
    const parts = safe(segs(path)); const name = parts.pop()
    if (!name) throw new Error('Falta el nombre del archivo')
    const dir = await dirAt(this.root, parts, create)
    return dir.getFileHandle(name, { create })
  }

  async do_get_file(c: Cmd) {
    const file: File = await (await this.fileAt(c.path)).getFile()
    if (file.size > MAX_FILE) throw new Error('El archivo supera los 50 MB')
    const parts = Math.max(1, Math.ceil(file.size / PART))
    const prefix = `${c.studio_id}/${this.deviceId}/${c.id}`
    for (let i = 0; i < parts; i++) {
      const { error } = await sb().storage.from('transfers').upload(`${prefix}.p${i}`, file.slice(i * PART, (i + 1) * PART), { upsert: true, contentType: 'application/octet-stream' })
      if (error) throw new Error(error.message)
    }
    return { storage: prefix, parts, size: file.size }
  }

  async do_put_file(c: Cmd) {
    const fh = await this.fileAt(c.path, true)
    const w = await fh.createWritable()
    try {
      for (let i = 0; i < (c.parts ?? 0); i++) {
        const { data, error } = await sb().storage.from('transfers').download(`${c.storage}.p${i}`)
        if (error) throw new Error(error.message)
        await w.write(data)
      }
      await w.close()
    } catch (e) { try { await w.abort() } catch { /* noop */ } throw e }
    return {}
  }

  async do_mkdir(c: Cmd) { await dirAt(this.root, segs(c.path), true); return {} }

  async do_delete(c: Cmd) {
    const parts = safe(segs(c.path)); const name = parts.pop()
    if (!name) throw new Error('No se puede borrar la carpeta compartida')
    await (await dirAt(this.root, parts)).removeEntry(name, { recursive: true })
    return {}
  }

  async do_rename(c: Cmd) {
    const from = safe(segs(c.path)), to = safe(segs(c.to))
    const name = from[from.length - 1], newName = to[to.length - 1]
    if (!name || !newName) throw new Error('Ruta no válida')
    const parent = await dirAt(this.root, from.slice(0, -1))
    if (to.slice(0, -1).join('/') !== from.slice(0, -1).join('/')) throw new Error('Solo se puede renombrar dentro de la misma carpeta')
    let handle: Dir
    try { handle = await parent.getFileHandle(name) } catch { handle = await parent.getDirectoryHandle(name) }
    if (typeof handle.move === 'function') { await handle.move(newName); return {} }
    if (handle.kind === 'directory') throw new Error('Este navegador no permite renombrar carpetas')
    const file: File = await handle.getFile()
    const nh = await parent.getFileHandle(newName, { create: true })
    const w = await nh.createWritable(); await w.write(file); await w.close()
    await parent.removeEntry(name)
    return {}
  }
}

/** Un agente por dispositivo mientras la app esté abierta (sobrevive a cambiar de pestaña). */
const running = new Map<string, PcFolderAgent>()
export const getAgent = (id: string) => running.get(id)
export function startAgent(a: PcFolderAgent) { running.get(a.deviceId)?.stop(); running.set(a.deviceId, a); void a.start() }
export function stopAgent(id: string) { running.get(id)?.stop(); running.delete(id) }
