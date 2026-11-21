import type { RealtimeChannel } from '@supabase/supabase-js'
import { sb } from './supabase'
import { uid } from './util'
import type { DeviceCommand } from './types'

/* ------------------------------------------------------------------ *
 * Órdenes app → bridge, guardadas en la tabla device_commands.        *
 * Realtime avisa al instante; un sondeo suave cubre cualquier pérdida. *
 * ------------------------------------------------------------------ */
interface Waiter { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class CommandClient {
  private waiters = new Map<string, Waiter>()
  private ch: RealtimeChannel
  private poll: ReturnType<typeof setInterval> | null = null

  constructor(public readonly deviceId: string) {
    this.ch = sb().channel(`cmd-${deviceId}-${uid().slice(0, 6)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'device_commands', filter: `device_id=eq.${deviceId}` },
        p => this.settle(p.new as DeviceCommand))
      .subscribe()
  }

  private settle(row: DeviceCommand) {
    const w = this.waiters.get(row.id)
    if (!w) return
    if (row.status === 'done') { this.clear(row.id); w.resolve(row.result) }
    else if (row.status === 'error') { this.clear(row.id); w.reject(new Error(row.error || 'El dispositivo devolvió un error')) }
  }
  private clear(id: string) {
    const w = this.waiters.get(id)
    if (w) clearTimeout(w.timer)
    this.waiters.delete(id)
    if (!this.waiters.size && this.poll) { clearInterval(this.poll); this.poll = null }
  }
  private startPolling() {
    if (this.poll) return
    this.poll = setInterval(async () => {
      const ids = [...this.waiters.keys()]
      if (!ids.length) return
      const { data } = await sb().from('device_commands').select('*').in('id', ids)
      for (const row of (data ?? []) as DeviceCommand[]) this.settle(row)
    }, 1500)
  }

  async run<T = any>(type: string, payload: Record<string, unknown> = {}, timeoutMs = 25_000): Promise<T> {
    const { data, error } = await sb().from('device_commands')
      .insert({ device_id: this.deviceId, type, payload }).select('id').single()
    if (error) throw new Error(error.message)
    const id = data.id as string
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id)
        reject(new Error('El dispositivo no responde. ¿Está el bridge en marcha y conectado?'))
      }, timeoutMs)
      this.waiters.set(id, { resolve, reject, timer })
      this.startPolling()
    }).finally(() => { void sb().from('device_commands').delete().eq('id', id) })
  }

  dispose() {
    for (const [id] of this.waiters) this.clear(id)
    if (this.poll) clearInterval(this.poll)
    void sb().removeChannel(this.ch)
  }
}

/* ------------------------------------------------------------------ *
 * Canal privado "device:<id>": señalización WebRTC, entrada (mando,    *
 * ratón, teclado) y presencia (quién comparte pantalla).               *
 * ------------------------------------------------------------------ */
export interface Signal { from: string; to?: string; kind: 'join' | 'offer' | 'answer' | 'ice' | 'leave'; data?: any }
export type Role = 'viewer' | 'sharer' | 'bridge'

export class Link {
  readonly clientId = uid()
  private ch: RealtimeChannel
  private signalCbs = new Set<(s: Signal) => void>()
  private presenceCbs = new Set<(peers: { id: string; role: Role }[]) => void>()
  ready: Promise<void>

  constructor(deviceId: string, private role: Role) {
    this.ch = sb().channel(`device:${deviceId}`, {
      config: { private: true, broadcast: { self: false, ack: false }, presence: { key: this.clientId } },
    })
    this.ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const s = payload as Signal
      if (s.to && s.to !== this.clientId) return
      this.signalCbs.forEach(cb => cb(s))
    })
    this.ch.on('presence', { event: 'sync' }, () => {
      const state = this.ch.presenceState() as Record<string, { role: Role }[]>
      const peers = Object.entries(state).map(([id, metas]) => ({ id, role: metas[0]?.role as Role }))
      this.presenceCbs.forEach(cb => cb(peers))
    })
    this.ready = new Promise((resolve, reject) => {
      this.ch.subscribe(async (status, err) => {
        if (status === 'SUBSCRIBED') { await this.ch.track({ role: this.role }); resolve() }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(err?.message || 'No se pudo abrir el canal privado (¿ejecutaste 02_app.sql?)'))
        }
      })
    })
    this.ready.catch(() => {})
  }

  onSignal(cb: (s: Signal) => void) { this.signalCbs.add(cb); return () => { this.signalCbs.delete(cb) } }
  onPresence(cb: (peers: { id: string; role: Role }[]) => void) { this.presenceCbs.add(cb); return () => { this.presenceCbs.delete(cb) } }
  signal(s: Omit<Signal, 'from'>) { return this.ch.send({ type: 'broadcast', event: 'signal', payload: { ...s, from: this.clientId } }) }
  input(payload: Record<string, unknown>) { return this.ch.send({ type: 'broadcast', event: 'input', payload }) }
  close() { void sb().removeChannel(this.ch) }
}

export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
  const url = import.meta.env.VITE_TURN_URL as string | undefined
  if (url) servers.push({ urls: url, username: import.meta.env.VITE_TURN_USER as string, credential: import.meta.env.VITE_TURN_PASS as string })
  return servers
}

/* ------------------------------------------------------------------ *
 * Pantalla: quien comparte (PC o ventana del visor 3DS) → quien mira. *
 * ------------------------------------------------------------------ */
class Peer {
  pc: RTCPeerConnection
  private queue: RTCIceCandidateInit[] = []
  private hasRemote = false
  constructor(private link: Link, public remoteId: string, onState?: (s: RTCPeerConnectionState) => void) {
    this.pc = new RTCPeerConnection({ iceServers: iceServers() })
    this.pc.onicecandidate = e => { if (e.candidate) void link.signal({ kind: 'ice', to: remoteId, data: e.candidate.toJSON() }) }
    this.pc.onconnectionstatechange = () => onState?.(this.pc.connectionState)
  }
  async setRemote(desc: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(desc)
    this.hasRemote = true
    for (const c of this.queue.splice(0)) await this.pc.addIceCandidate(c).catch(() => {})
  }
  async addIce(c: RTCIceCandidateInit) {
    if (!this.hasRemote) this.queue.push(c)
    else await this.pc.addIceCandidate(c).catch(() => {})
  }
  close() { try { this.pc.close() } catch { /* noop */ } }
}

export class ScreenSharer {
  private peers = new Map<string, Peer>()
  private off: () => void
  constructor(private link: Link, private stream: MediaStream, private onViewers: (n: number) => void) {
    this.off = link.onSignal(async s => {
      if (s.kind === 'join') await this.offerTo(s.from)
      else if (s.kind === 'answer') await this.peers.get(s.from)?.setRemote(s.data)
      else if (s.kind === 'ice') await this.peers.get(s.from)?.addIce(s.data)
      else if (s.kind === 'leave') this.drop(s.from)
    })
  }
  private async offerTo(viewerId: string) {
    this.drop(viewerId)
    const peer = new Peer(this.link, viewerId, st => { if (st === 'failed' || st === 'closed' || st === 'disconnected') this.drop(viewerId) })
    this.peers.set(viewerId, peer)
    this.stream.getTracks().forEach(t => peer.pc.addTrack(t, this.stream))
    // Prioriza fluidez sobre nitidez cuando falta ancho de banda (juegos)
    peer.pc.getSenders().forEach(snd => {
      if (snd.track?.kind === 'video') {
        const p = snd.getParameters()
        p.degradationPreference = 'maintain-framerate'
        if (!p.encodings?.length) p.encodings = [{}]
        p.encodings[0].maxBitrate = 6_000_000
        void snd.setParameters(p).catch(() => {})
      }
    })
    const offer = await peer.pc.createOffer()
    await peer.pc.setLocalDescription(offer)
    await this.link.signal({ kind: 'offer', to: viewerId, data: offer })
    this.onViewers(this.peers.size)
  }
  private drop(id: string) { this.peers.get(id)?.close(); this.peers.delete(id); this.onViewers(this.peers.size) }
  stop() {
    this.off()
    for (const id of [...this.peers.keys()]) this.drop(id)
    this.stream.getTracks().forEach(t => t.stop())
  }
}

export class ScreenViewer {
  private peer: Peer | null = null
  private off: () => void
  private offPresence: () => void
  private joined = false
  constructor(private link: Link, private onStream: (s: MediaStream | null) => void, private onStatus: (s: string) => void) {
    this.off = link.onSignal(async s => {
      if (s.kind === 'offer') await this.accept(s.from, s.data)
      else if (s.kind === 'ice') await this.peer?.addIce(s.data)
      else if (s.kind === 'leave' && this.peer?.remoteId === s.from) this.reset('El emisor dejó de compartir')
    })
    this.offPresence = link.onPresence(peers => {
      const sharer = peers.find(p => p.role === 'sharer')
      if (sharer && !this.peer && !this.joined) { this.joined = true; this.onStatus('Conectando…'); void link.signal({ kind: 'join' }) }
      if (!sharer && this.peer) this.reset('Nadie está compartiendo pantalla')
      if (!sharer && !this.peer) { this.joined = false; this.onStatus('Nadie está compartiendo pantalla en este dispositivo') }
    })
  }
  private async accept(from: string, offer: RTCSessionDescriptionInit) {
    this.peer?.close()
    const peer = new Peer(this.link, from, st => {
      if (st === 'connected') this.onStatus('En directo')
      if (st === 'failed') this.reset('Conexión fallida. Si no estáis en la misma red hace falta un servidor TURN.')
    })
    this.peer = peer
    peer.pc.ontrack = e => this.onStream(e.streams[0] ?? new MediaStream([e.track]))
    await peer.setRemote(offer)
    const answer = await peer.pc.createAnswer()
    await peer.pc.setLocalDescription(answer)
    await this.link.signal({ kind: 'answer', to: from, data: answer })
  }
  private reset(msg: string) {
    this.peer?.close(); this.peer = null; this.joined = false
    this.onStream(null); this.onStatus(msg)
  }
  leave() {
    if (this.peer) void this.link.signal({ kind: 'leave', to: this.peer.remoteId })
    this.off(); this.offPresence(); this.peer?.close(); this.peer = null
  }
}
