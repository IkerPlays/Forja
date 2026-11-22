import { sb } from './supabase'
import { desktop } from './native'
import { DesktopPcAgent } from './desktopAgent'
import { Link, ScreenSharer, SCREEN_CONSTRAINTS, type Sources } from './devices'
import { P2PAnswerer } from './p2p'
import { NtrSource } from './ntrSource'
import type { Device } from './types'

export interface ConsoleInfo { id: string; name: string; ip: string; port: number }
export interface HostState { running: boolean; deviceId?: string; hostname?: string; viewers: number; consoles: number; list: ConsoleInfo[]; log: string[]; error?: string }

/**
 * Anfitrión de la app de escritorio: registra este PC como dispositivo, atiende sus órdenes de archivos,
 * comparte la pantalla bajo demanda, aplica el ratón/teclado remotos y enlaza las 3DS de tu red local (mando por UDP).
 */
class DesktopHost {
  state: HostState = { running: false, viewers: 0, consoles: 0, list: [], log: [] }
  private listeners = new Set<() => void>()
  private agent?: DesktopPcAgent
  private link?: Link
  private sharer?: ScreenSharer
  private p2p?: P2PAnswerer
  private ds = new Map<string, { link: Link; off: () => void; sharer?: ScreenSharer; key: string }>()
  private dsChannel?: ReturnType<ReturnType<typeof sb>['channel']>
  private studioId?: string
  private userId?: string
  private starting = false
  private retry?: ReturnType<typeof setTimeout>

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
      const dev = await this.resolveDevice(studioId, userId, info)
      this.agent = new DesktopPcAgent(dev.id, { hostname: info.hostname, version: info.version, platform: info.platform })
      this.agent.onLog = m => this.log(m)
      await this.agent.start()
      this.patch({ running: true, deviceId: dev.id, hostname: info.hostname, error: undefined })
      await this.openLink(dev.id)
      await this.syncConsoles()
      this.dsChannel = sb().channel(`host-devices-${studioId}-${Math.random().toString(36).slice(2, 7)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `studio_id=eq.${studioId}` }, () => void this.syncConsoles())
        .subscribe()
    } catch (e) {
      this.patch({ error: e instanceof Error ? e.message : String(e), running: false })
      // Sin red al arrancar con el sistema, etc.: reintenta (y NUNCA crea un dispositivo si la consulta falló)
      this.retry = setTimeout(() => { void this.start(studioId, userId) }, 10_000)
    } finally { this.starting = false }
  }

  /** Este PC = un único dispositivo: se recuerda su id y se limpian duplicados antiguos. */
  private async resolveDevice(studioId: string, userId: string, info: { hostname: string; hostId: string }): Promise<Device> {
    const settings = await desktop!.getSettings()
    const { data, error } = await sb().from('devices').select('*').eq('studio_id', studioId).eq('kind', 'pc')
    if (error) throw new Error('No se pudo consultar tus dispositivos: ' + error.message)
    const list = (data ?? []) as Device[]
    const hostOf = (d: Device) => (d.config as { hostId?: string })?.hostId
    const mine = list.filter(d => hostOf(d) === info.hostId).sort((a, b) => a.created_at.localeCompare(b.created_at))
    let dev = (settings.deviceId && list.find(d => d.id === settings.deviceId)) || mine[0]
    if (dev) {
      for (const d of mine) if (d.id !== dev.id) await sb().from('devices').delete().eq('id', d.id)   // duplicados
      if (hostOf(dev) !== info.hostId) await sb().from('devices').update({ config: { ...(dev.config as object), hostId: info.hostId } }).eq('id', dev.id)
    } else {
      const ins = await sb().from('devices').insert({ studio_id: studioId, name: info.hostname, kind: 'pc', config: { hostId: info.hostId }, created_by: userId }).select().single()
      if (ins.error) throw new Error(ins.error.message)
      dev = ins.data as Device
      this.log(`PC registrado como «${dev.name}»`)
    }
    if (settings.deviceId !== dev.id) await desktop!.setSettings({ deviceId: dev.id })
    return dev
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
      this.sharer = new ScreenSharer(this.link, async (): Promise<Sources> => {
        const cur = await desktop!.getSettings()
        const src: Sources = { screen: await navigator.mediaDevices.getDisplayMedia(SCREEN_CONSTRAINTS(cur.screenQuality === 'native')) }
        if (cur.shareCamera || cur.shareMic) {
          try { src.camera = await navigator.mediaDevices.getUserMedia({ video: cur.shareCamera ? { width: { ideal: 1280 }, frameRate: { ideal: 30 } } : false, audio: cur.shareMic }) } catch { /* sin permiso o sin cámara */ }
        }
        return src
      }, n => this.patch({ viewers: n }))
    }
    await this.link.ready.catch(e => this.patch({ error: e instanceof Error ? e.message : String(e) }))
  }

  /**
   * Todas las 3DS del estudio se enlazan (con o sin IP) para que la web sepa que este PC está disponible.
   * Con IP (la de su ficha o la que informa Forja3DS) reciben el mando por UDP y emiten su pantalla por NTR.
   */
  private async syncConsoles() {
    if (!this.studioId) return
    const { data } = await sb().from('devices').select('*').eq('studio_id', this.studioId).eq('kind', '3ds')
    const wanted = new Map<string, { d: Device; ip: string; port: number }>()
    for (const d of (data ?? []) as Device[]) {
      const cfg = d.config as { ip?: string; input_port?: number }
      wanted.set(d.id, { d, ip: (cfg.ip || (d.info as { ip?: string }).ip || '').trim(), port: cfg.input_port || 4950 })
    }
    for (const [id, h] of this.ds) {
      const w = wanted.get(id)
      if (!w || h.key !== `${w.ip}:${w.port}`) { h.off(); h.sharer?.stop(); h.link.close(); this.ds.delete(id) }
    }
    const pc = this.state.hostname ?? ''
    for (const [id, w] of wanted) {
      if (this.ds.has(id)) continue
      const hasIp = !!w.ip
      const link = new Link(id, hasIp ? ['bridge', 'sharer'] : ['bridge'], hasIp ? { pc, ip: w.ip, port: w.port } : { pc, noip: true })
      let lastAck = 0
      const ack = async (force = false) => {
        if (!force && Date.now() - lastAck < 800) return
        lastAck = Date.now()
        const st = await desktop!.padStatus().catch(() => ({ sent: 0, error: '' }))
        void link.input({ k: 'pad-ack', pc, ip: w.ip, port: w.port, sent: st.sent, err: st.error })
      }
      const off = link.onInput(m => {
        if (!hasIp) return
        if (m?.k === 'pad') { desktop!.padSend(w.ip, w.port, m.s); void ack() }
        else if (m?.k === 'pad-test') { desktop!.padSend(w.ip, w.port, { b: 0, cx: 0, cy: 0, sx: 0, sy: 0, t: null }); void ack(true) }
      })
      // La pantalla se pide por NTR/NTR-HR solo cuando alguien mira
      const sharer = hasIp ? new ScreenSharer(link, async (): Promise<Sources> => ({ screen: await new NtrSource(w.ip).start() }), () => {}) : undefined
      this.ds.set(id, { link, off, sharer, key: `${w.ip}:${w.port}` })
      this.log(hasIp ? `3DS «${w.d.name}» enlazada (${w.ip}): mando y pantalla` : `3DS «${w.d.name}» sin IP: pon su IP en la ficha`)
    }
    this.patch({ consoles: [...wanted.values()].filter(w => w.ip).length, list: [...wanted.values()].map(w => ({ id: w.d.id, name: w.d.name, ip: w.ip, port: w.port })) })
  }

  /** Diagnóstico: manda un paquete neutro a la 3DS y dice si el sistema pudo enviarlo. */
  async testPad(c: ConsoleInfo): Promise<{ ok: boolean; msg: string }> {
    if (!c.ip) return { ok: false, msg: 'Falta la IP de la 3DS (ponla en su ficha).' }
    desktop!.padSend(c.ip, c.port, { b: 0, cx: 0, cy: 0, sx: 0, sy: 0, t: null })
    await new Promise(r => setTimeout(r, 400))
    const st = await desktop!.padStatus()
    return st.error ? { ok: false, msg: `El sistema no pudo enviar a ${c.ip}:${c.port}: ${st.error}` } : { ok: true, msg: `Paquete enviado a ${c.ip}:${c.port}. Si la 3DS tiene Input Redirection activo, ya lo recibe.` }
  }

  /** Diagnóstico: pide imagen a NTR unos segundos y cuenta fotogramas. */
  async testNtr(c: ConsoleInfo): Promise<{ ok: boolean; msg: string }> {
    if (!c.ip) return { ok: false, msg: 'Falta la IP de la 3DS (ponla en su ficha).' }
    const src = new NtrSource(c.ip)
    try {
      const stream = await src.start()
      await new Promise(r => setTimeout(r, 1500))
      const frames = src.frames
      stream.getTracks().forEach(t => t.stop())
      return { ok: true, msg: `Recibiendo imagen de ${c.ip}: ${frames} fotogramas en 1,5 s.` }
    } catch (e) { src.stop(); return { ok: false, msg: e instanceof Error ? e.message : String(e) } }
  }

  /** Tras cambiar ajustes (pantalla visible, etc.) */
  async applySettings() { if (this.state.deviceId) await this.openLink(this.state.deviceId) }

  async stop() {
    if (this.retry) { clearTimeout(this.retry); this.retry = undefined }
    this.agent?.stop(); this.agent = undefined
    this.sharer?.stop(); this.sharer = undefined
    this.p2p?.stop(); this.p2p = undefined
    this.link?.close(); this.link = undefined
    for (const h of this.ds.values()) { h.off(); h.sharer?.stop(); h.link.close() }
    this.ds.clear()
    if (this.dsChannel) { void sb().removeChannel(this.dsChannel); this.dsChannel = undefined }
    this.patch({ running: false, deviceId: undefined, viewers: 0, consoles: 0 })
  }
}

export const desktopHost = new DesktopHost()
