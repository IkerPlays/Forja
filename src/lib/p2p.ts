import { iceServers, type Link, type Signal } from './devices'

/**
 * Archivos directos entre el navegador (tablet) y la app de escritorio por un canal de datos WebRTC:
 * sin subir nada al servidor y sin límite de tamaño. La señalización viaja por el canal privado de Realtime.
 */
export interface FsBackend {
  list(p: string): Promise<{ entries: { name: string; type: 'dir' | 'file'; size: number; mtime: number | null }[]; truncated?: boolean }>
  size(p: string): Promise<number>
  read(p: string, offset: number, length: number): Promise<Uint8Array>
  write(p: string, data: Uint8Array, append: boolean): Promise<void>
  mkdir(p: string): Promise<void>
  rename(a: string, b: string): Promise<void>
  remove(p: string): Promise<void>
}

const CHUNK = 64 * 1024          // mensaje del canal
const READ = 512 * 1024          // lectura de disco por vuelta
const HIGH = 1024 * 1024         // contrapresión
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function drain(dc: RTCDataChannel) {
  if (dc.bufferedAmount < HIGH) return
  dc.bufferedAmountLowThreshold = HIGH / 4
  await new Promise<void>(res => { const f = () => { dc.removeEventListener('bufferedamountlow', f); res() }; dc.addEventListener('bufferedamountlow', f) })
}

/* ------------------------------------------------------------------ Anfitrión (PC) */
export class P2PHost {
  constructor(private fs: FsBackend) {}

  attach(dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer'
    let put: { id: number; path: string; first: boolean; chain: Promise<void>; error?: string } | null = null
    const reply = (o: Record<string, unknown>) => { if (dc.readyState === 'open') dc.send(JSON.stringify(o)) }

    dc.onmessage = async ev => {
      if (typeof ev.data !== 'string') {   // trozo de un archivo que se está recibiendo
        if (!put) return
        const p = put, data = new Uint8Array(ev.data as ArrayBuffer), append = !p.first
        p.first = false
        p.chain = p.chain.then(async () => { if (!p.error) await this.fs.write(p.path, data, append).catch(e => { p.error = msg(e) }) })
        return
      }
      const m = JSON.parse(ev.data) as { id: number; op: string; path?: string; to?: string }
      try {
        switch (m.op) {
          case 'list': reply({ id: m.id, ok: true, result: await this.fs.list(m.path || '/') }); break
          case 'mkdir': await this.fs.mkdir(m.path || '/'); reply({ id: m.id, ok: true }); break
          case 'rename': await this.fs.rename(m.path || '/', m.to || '/'); reply({ id: m.id, ok: true }); break
          case 'remove': await this.fs.remove(m.path || '/'); reply({ id: m.id, ok: true }); break
          case 'get': {
            const size = await this.fs.size(m.path || '/')
            reply({ id: m.id, ev: 'start', size })
            for (let off = 0; off < size; off += READ) {
              const buf = await this.fs.read(m.path || '/', off, Math.min(READ, size - off))
              for (let i = 0; i < buf.length; i += CHUNK) {
                await drain(dc)
                dc.send(buf.subarray(i, Math.min(i + CHUNK, buf.length)) as unknown as ArrayBufferView<ArrayBuffer>)
              }
            }
            reply({ id: m.id, ok: true, result: { size } })
            break
          }
          case 'put': {
            put = { id: m.id, path: m.path || '/', first: true, chain: Promise.resolve() }
            // vacía el archivo existente aunque no lleguen datos
            put.chain = this.fs.write(put.path, new Uint8Array(0), false).catch(e => { put!.error = msg(e) })
            put.first = false
            break
          }
          case 'put_end': {
            const p = put; put = null
            if (!p) { reply({ id: m.id, ok: false, error: 'No había una subida en curso' }); break }
            await p.chain
            reply(p.error ? { id: p.id, ok: false, error: p.error } : { id: p.id, ok: true })
            break
          }
          default: reply({ id: m.id, ok: false, error: 'Operación desconocida' })
        }
      } catch (e) { reply({ id: m.id, ok: false, error: msg(e) }) }
    }
  }
}

/* ------------------------------------------------------------------ Cliente (navegador) */
interface Pending { resolve: (v: any) => void; reject: (e: Error) => void; chunks?: Uint8Array[]; got?: number; size?: number; onProgress?: (done: number, total: number) => void }

export class P2PClient {
  private pending = new Map<number, Pending>()
  private next = 1
  private cur: number | null = null          // descarga en curso (los trozos binarios pertenecen a ella)
  private lock: Promise<unknown> = Promise.resolve()
  onClose: () => void = () => {}

  constructor(private dc: RTCDataChannel, private pc: RTCPeerConnection) {
    dc.binaryType = 'arraybuffer'
    dc.onmessage = ev => {
      if (typeof ev.data !== 'string') {
        const p = this.cur != null ? this.pending.get(this.cur) : undefined
        if (p?.chunks) { const u = new Uint8Array(ev.data as ArrayBuffer); p.chunks.push(u); p.got = (p.got ?? 0) + u.length; p.onProgress?.(p.got, p.size ?? 0) }
        return
      }
      const m = JSON.parse(ev.data) as { id: number; ok?: boolean; ev?: string; size?: number; result?: unknown; error?: string }
      const p = this.pending.get(m.id)
      if (!p) return
      if (m.ev === 'start') { p.size = m.size; return }
      this.pending.delete(m.id)
      if (this.cur === m.id) this.cur = null
      if (m.ok) p.resolve(p.chunks ? new Blob(p.chunks as BlobPart[]) : m.result)
      else p.reject(new Error(m.error || 'Error del PC'))
    }
    const closed = () => { for (const p of this.pending.values()) p.reject(new Error('Se cortó la conexión directa con el PC')); this.pending.clear(); this.onClose() }
    dc.onclose = closed
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closed() }
  }

  get open() { return this.dc.readyState === 'open' }

  private call<T>(op: string, args: Record<string, unknown> = {}, extra: Partial<Pending> = {}): Promise<T> {
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, ...extra })
      this.dc.send(JSON.stringify({ id, op, ...args }))
    })
  }

  /** Las transferencias van de una en una para que los trozos binarios no se mezclen. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn)
    this.lock = run.catch(() => {})
    return run
  }

  list(path: string) { return this.call<{ entries: any[]; truncated?: boolean }>('list', { path }) }
  mkdir(path: string) { return this.call<void>('mkdir', { path }) }
  rename(path: string, to: string) { return this.call<void>('rename', { path, to }) }
  remove(path: string) { return this.call<void>('remove', { path }) }

  download(path: string, onProgress?: (done: number, total: number) => void): Promise<Blob> {
    return this.serial(() => {
      const id = this.next
      this.cur = id
      return this.call<Blob>('get', { path }, { chunks: [], got: 0, onProgress })
    })
  }

  upload(path: string, file: Blob, onProgress?: (done: number, total: number) => void): Promise<void> {
    return this.serial(async () => {
      const id = this.next++
      this.dc.send(JSON.stringify({ id, op: 'put', path }))
      for (let off = 0; off < file.size; off += CHUNK) {
        await drain(this.dc)
        this.dc.send(await file.slice(off, off + CHUNK).arrayBuffer())
        onProgress?.(Math.min(off + CHUNK, file.size), file.size)
      }
      await new Promise<void>((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        this.dc.send(JSON.stringify({ id, op: 'put_end' }))
      })
    })
  }

  close() { try { this.dc.close(); this.pc.close() } catch { /* noop */ } }
}

/* ------------------------------------------------------------------ Señalización */
type SigIO = { onSignal(cb: (s: Signal) => void): () => void; signal(s: Omit<Signal, 'from'>): Promise<unknown> | unknown }

/** Navegador → PC: abre el canal de datos con el anfitrión `hostId` (cliente de presencia con rol 'files'). */
export async function openP2P(link: SigIO, hostId: string, timeoutMs = 8000, servers: RTCIceServer[] = iceServers()): Promise<P2PClient> {
  const pc = new RTCPeerConnection({ iceServers: servers })
  const dc = pc.createDataChannel('fs', { ordered: true })
  const queue: RTCIceCandidateInit[] = []
  let remote = false
  pc.onicecandidate = e => { if (e.candidate) void link.signal({ kind: 'fs-ice', to: hostId, data: e.candidate.toJSON() }) }
  const off = link.onSignal(async s => {
    if (s.from !== hostId) return
    if (s.kind === 'fs-answer') {
      await pc.setRemoteDescription(s.data); remote = true
      for (const c of queue.splice(0)) await pc.addIceCandidate(c).catch(() => {})
    } else if (s.kind === 'fs-ice') {
      if (!remote) queue.push(s.data); else await pc.addIceCandidate(s.data).catch(() => {})
    }
  })
  try {
    await pc.setLocalDescription(await pc.createOffer())
    await link.signal({ kind: 'fs-offer', to: hostId, data: pc.localDescription })
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('No hubo respuesta del PC')), timeoutMs)
      dc.onopen = () => { clearTimeout(t); resolve() }
      dc.onerror = () => { clearTimeout(t); reject(new Error('Falló el canal directo')) }
    })
    return new P2PClient(dc, pc)
  } catch (e) { pc.close(); throw e } finally { off() }
}

/** PC: acepta peticiones 'fs-offer' y sirve archivos. */
export class P2PAnswerer {
  private peers = new Map<string, { pc: RTCPeerConnection; queue: RTCIceCandidateInit[]; remote: boolean }>()
  private off: () => void
  private host: P2PHost
  constructor(private link: SigIO, fs: FsBackend, private servers: RTCIceServer[] = iceServers()) {
    this.host = new P2PHost(fs)
    this.off = link.onSignal(s => { if (s.kind === 'fs-offer' || s.kind === 'fs-ice') void this.onSignal(s) })
  }
  private async onSignal(s: Signal) {
    if (s.kind === 'fs-offer') {
      this.peers.get(s.from)?.pc.close()
      const pc = new RTCPeerConnection({ iceServers: this.servers })
      const peer = { pc, queue: [] as RTCIceCandidateInit[], remote: false }
      this.peers.set(s.from, peer)
      pc.ondatachannel = e => this.host.attach(e.channel)
      pc.onicecandidate = e => { if (e.candidate) void this.link.signal({ kind: 'fs-ice', to: s.from, data: e.candidate.toJSON() }) }
      pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) { pc.close(); this.peers.delete(s.from) } }
      await pc.setRemoteDescription(s.data); peer.remote = true
      for (const c of peer.queue.splice(0)) await pc.addIceCandidate(c).catch(() => {})
      await pc.setLocalDescription(await pc.createAnswer())
      await this.link.signal({ kind: 'fs-answer', to: s.from, data: pc.localDescription })
    } else {
      const peer = this.peers.get(s.from)
      if (!peer) return
      if (!peer.remote) peer.queue.push(s.data); else await peer.pc.addIceCandidate(s.data).catch(() => {})
    }
  }
  stop() { this.off(); for (const p of this.peers.values()) p.pc.close(); this.peers.clear() }
}
