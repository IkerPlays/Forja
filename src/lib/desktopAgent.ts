import { sb } from './supabase'
import { CommandAgent, type Cmd } from './agentBase'
import { desktop } from './native'
import { MAX_FILE, PART } from './transfer'

/** Agente del PC en la app de escritorio: archivos reales del equipo (carpetas permitidas o todo el disco). */
export class DesktopPcAgent extends CommandAgent {
  constructor(deviceId: string, private meta: { hostname: string; version: string; platform: string }) { super(deviceId) }

  protected async heartbeatInfo() {
    const d = desktop!
    const [s, i] = await Promise.all([d.getSettings(), d.info()])
    return {
      Agente: `Forja Escritorio ${this.meta.version}`, Equipo: this.meta.hostname, Sistema: this.meta.platform,
      Archivos: s.fullAccess ? 'todo el equipo' : s.roots.length ? s.roots.length + ' carpeta(s)' : 'ninguna carpeta compartida todavía',
      Control: i.input && s.allowInput ? 'ratón y teclado activos' : 'desactivado',
      Pantalla: s.allowScreen ? 'visible para el estudio' : 'oculta',
    }
  }

  async do_power(c: Cmd) {
    if (!['lock', 'sleep', 'restart', 'shutdown'].includes(String(c.kind))) throw new Error('Acción no válida')
    await desktop!.power(c.kind as 'lock' | 'sleep' | 'restart' | 'shutdown'); return {}
  }
  async do_list_dir(c: Cmd) { return desktop!.fs.list(c.path || '/') }
  async do_mkdir(c: Cmd) { await desktop!.fs.mkdir(c.path || '/'); return {} }
  async do_rename(c: Cmd) { await desktop!.fs.rename(c.path || '/', c.to || '/'); return {} }
  async do_delete(c: Cmd) { await desktop!.fs.remove(c.path || '/'); return {} }

  async do_get_file(c: Cmd) {
    const size = await desktop!.fs.size(c.path || '/')
    if (size > MAX_FILE) throw new Error('El archivo supera los 50 MB')
    const parts = Math.max(1, Math.ceil(size / PART))
    const prefix = `${c.studio_id}/${this.deviceId}/${c.id}`
    for (let i = 0; i < parts; i++) {
      const data = await desktop!.fs.read(c.path || '/', i * PART, PART)
      const { error } = await sb().storage.from('transfers').upload(`${prefix}.p${i}`, new Blob([data as BlobPart]), { upsert: true, contentType: 'application/octet-stream' })
      if (error) throw new Error(error.message)
    }
    return { storage: prefix, parts, size }
  }

  async do_put_file(c: Cmd) {
    for (let i = 0; i < (c.parts ?? 0); i++) {
      const { data, error } = await sb().storage.from('transfers').download(`${c.storage}.p${i}`)
      if (error) throw new Error(error.message)
      await desktop!.fs.write(c.path || '/', new Uint8Array(await data.arrayBuffer()), i > 0)
    }
    if (!(c.parts ?? 0)) await desktop!.fs.write(c.path || '/', new Uint8Array(0), false)
    return {}
  }
}
