import { sb } from './supabase'
import { desktop } from './native'
import { DesktopPcAgent } from './desktopAgent'
import { Link, ScreenSharer } from './devices'
import { P2PAnswerer } from './p2p'
import type { Device } from './types'

export interface HostState { running: boolean; deviceId?: string; hostname?: string; viewers: number; consoles: number; log: string[]; error?: string }

/**
 * Anfitrión de la app de escritorio: registra este PC como dispositivo, atiende sus órdenes de archivos,
 * comparte la pantalla bajo demanda, aplica el ratón/teclado remotos y enlaza las 3DS de tu red local (mando por UDP).
 */
class DesktopHost {
  state: HostState = { running: false, viewers: 0, consoles: 0, log: [] }
  private listeners = new Set<() => void>()
  private agent?: DesktopPcAgent
  private link?: Link
  private sharer?: ScreenSharer
  private p2p?: P2PAnswerer
  private ds = new Map<string, { link: Link; off: () => void }>()
  private dsChannel?: ReturnType<ReturnType<typeof sb>['channel']>
  private studioId?: string
  private userId?: string
  private starting = false

  subscribe(l: () => void) { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  private emit() { this.listeners.forEach(l => l()) }
  private patch(p: Partial<HostState>) { this.state = { ...this.state, ...p }; this.emit() }
  private log(m: string) { this.patch({ log: [`${new Date().toLocaleTimeString()}  ${m}`, ...this.state.log].slice(0, 30) }) }

  async start(studioId: string, userId: string) {
    if (!desktop || this.starting || (this.state.running && this.studioId === studioId)) return
    this.starting = true
    try {
      await this.stop()
      this.studioId = studioId; this.userId = userId
      const info = await desktop.info()
      const { data } = await sb().from('devices').select('*').eq('studio_id', studioId).eq('kind', 'pc')
      let dev = ((data ?? []) as Device[]).find(d => (d.config as { hostId?: string })?.hostId === info.hostId)
      if (!dev) {
        const ins = await sb().from('devices').insert({ studio_id: studioId, name: info.hostname, kind: 'pc', config: { hostId: info.hostId }, created_by: userId }).select().single()
        if (ins.error) throw new Error(ins.error.message)
        dev = ins.data as Device
        this.log(`PC registrado como «${dev.name}»`)
      }
      this.agent = new DesktopPcAgent(dev.id, { hostname: info.hostname, version: info.version, platform: info.platform })
      this.agent.onLog = m => this.log(m)
      await this.agent.start()
      this.patch({ running: true, deviceId: dev.id, hostname: info.hostname, error: undefined })
      await this.openLink(dev.id)
      await this.syncConsoles()
      this.dsChannel = sb().channel(`host-devices-${studioId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `studio_id=eq.${studioId}` }, () => void this.syncConsoles())
        .subscribe()
    } catch (e) {
      this.patch({ error: e instanceof Error ? e.message : String(e), running: false })
    } finally { this.starting = false }
  }

  /** Canal del propio PC: ratón/teclado remotos y pantalla bajo demanda. */
  private async openLink(deviceId: string) {
    this.sharer?.stop(); this.p2p?.stop(); this.link?.close(); this.sharer = undefined
    const s = await desktop!.getSettings()
    this.link = new Link(deviceId, ['bridge', 'files', ...(s.allowScreen ? ['sharer' as const] : [])])
    this.p2p = new P2PAnswerer(this.link, desktop!.fs)
    this.link.onInput(m => {
      if (m?.k === 'mouse') desktop!.inputMouse(m)
      else if (m?.k === 'key') desktop!.inputKey(m)
    })
    if (s.allowScreen) {
      this.sharer = new ScreenSharer(this.link, () => navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: true }), n => this.patch({ viewers: n }))
    }
    await this.link.ready.catch(e => this.patch({ error: e instanceof Error ? e.message : String(e) }))
  }

  /** Las 3DS del estudio con IP reciben el mando por UDP desde este PC. */
  private async syncConsoles() {
    if (!this.studioId) return
    const { data } = await sb().from('devices').select('*').eq('studio_id', this.studioId).eq('kind', '3ds')
    const wanted = new Map<string, Device>()
    for (const d of (data ?? []) as Device[]) if ((d.config as { ip?: string }).ip) wanted.set(d.id, d)
    for (const [id, h] of this.ds) if (!wanted.has(id)) { h.off(); h.link.close(); this.ds.delete(id) }
    for (const [id, d] of wanted) {
      if (this.ds.has(id)) continue
      const link = new Link(id, 'bridge')
      const cfg = d.config as { ip: string; input_port?: number }
      const off = link.onInput(m => { if (m?.k === 'pad') desktop!.padSend(cfg.ip, cfg.input_port || 4950, m.s) })
      this.ds.set(id, { link, off })
    }
    this.patch({ consoles: this.ds.size })
  }

  /** Tras cambiar ajustes (pantalla visible, etc.) */
  async applySettings() { if (this.state.deviceId) await this.openLink(this.state.deviceId) }

  async stop() {
    this.agent?.stop(); this.agent = undefined
    this.sharer?.stop(); this.sharer = undefined
    this.p2p?.stop(); this.p2p = undefined
    this.link?.close(); this.link = undefined
    for (const h of this.ds.values()) { h.off(); h.link.close() }
    this.ds.clear()
    if (this.dsChannel) { void sb().removeChannel(this.dsChannel); this.dsChannel = undefined }
    this.patch({ running: false, deviceId: undefined, viewers: 0, consoles: 0 })
  }
}

export const desktopHost = new DesktopHost()
