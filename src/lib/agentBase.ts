import { sb } from './supabase'

export type Cmd = { id: string; studio_id: string; type: string; path?: string; to?: string; storage?: string; parts?: number; size?: number; kind?: string }

/**
 * Base de los "agentes" que atienden órdenes de un dispositivo (listar, bajar, subir, renombrar…):
 * reclama órdenes con device_command_claim, las ejecuta (métodos do_<tipo>) y devuelve el resultado.
 */
export abstract class CommandAgent {
  private stopped = false
  private busy = false
  private timers: ReturnType<typeof setInterval>[] = []
  private ch: ReturnType<ReturnType<typeof sb>['channel']> | null = null
  onLog: (s: string) => void = () => {}

  constructor(public deviceId: string) {}

  protected abstract heartbeatInfo(): Promise<Record<string, unknown>>

  async start() {
    const beat = async () => {
      try { await sb().rpc('device_heartbeat', { p_device: this.deviceId, p_info: { proto: 2, ...(await this.heartbeatInfo()) } }) } catch { /* sin red */ }
    }
    void beat(); this.timers.push(setInterval(beat, 20_000))
    this.ch = sb().channel(`agent-${this.deviceId}-${Math.random().toString(36).slice(2, 7)}`)
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
}

export const segs = (p?: string) => String(p || '/').split('/').filter(Boolean)
export const safeSegs = (parts: string[]) => { if (parts.some(x => x === '..' || x === '.')) throw new Error('Ruta no válida'); return parts }
