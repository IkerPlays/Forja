'use strict'
// Pantalla de la 3DS por NTR / NTR-HR (protocolo de Chokistream/Snickerstream):
//  · PC → 3DS por TCP 8000: paquete de 84 bytes con cmd 901 ("remote play") que arranca el streaming.
//  · 3DS → PC por UDP 8001: fotogramas JPEG en trozos (byte0 = id de fotograma; byte1 = pantalla (bajo 4 bits, 1 = superior)
//    y marca de último trozo (alto 4 bits); byte3 = nº de trozo; datos desde el byte 4).
const dgram = require('node:dgram')
const net = require('node:net')

function initPacket({ quality = 80, topPriority = true, priority = 3, qos = 16 } = {}) {
  const b = Buffer.alloc(84)
  b.writeUInt32LE(0x12345678, 0)
  b.writeUInt32LE(3000, 4)           // seq
  b.writeUInt32LE(0, 8)              // type
  b.writeUInt32LE(901, 12)           // cmd: remote play
  b.writeUInt32LE((((topPriority ? 1 : 0) << 8) | (priority % 256)) >>> 0, 16)
  b.writeUInt32LE(quality >>> 0, 20)
  b.writeUInt32LE(((qos * 2) << 16) >>> 0, 24)
  return b
}

/** Reconstruye los JPEG a partir de los trozos UDP (uno por pantalla). */
class FrameAssembler {
  constructor(onFrame) { this.onFrame = onFrame; this.state = { top: null, bottom: null } }
  push(data) {
    if (data.length < 5) return
    const frame = data[0], screen = (data[1] & 0x0f) === 1 ? 'top' : 'bottom', last = ((data[1] & 0xf0) >> 4) === 1, pn = data[3]
    let st = this.state[screen]
    if (pn === 0) st = this.state[screen] = { frame, next: 0, chunks: [] }   // un fotograma nuevo siempre empieza en el trozo 0
    if (!st || st.frame !== frame || st.next !== pn) { this.state[screen] = null; return }   // fuera de orden: se descarta
    st.chunks.push(data.subarray(4)); st.next++
    if (last) { this.state[screen] = null; this.onFrame(screen, Buffer.concat(st.chunks)) }
  }
}

class NtrReceiver {
  constructor({ port = 8001, onFrame, onLog = () => {} }) {
    this.port = port; this.onFrame = onFrame; this.onLog = onLog
    this.frames = 0; this.lastFrameAt = 0
    this.asm = new FrameAssembler((screen, jpeg) => { this.frames++; this.lastFrameAt = Date.now(); this.onFrame(screen, jpeg) })
    this.sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.sock.on('message', m => this.asm.push(m))
    this.sock.on('error', e => this.onLog('ntr udp: ' + e.message))
    this.sock.bind(port)
  }
  stop() { try { this.sock.close() } catch { /* noop */ } }
}

/** Pide a NTR de la 3DS que empiece a emitir hacia este PC. Resuelve true si NTR aceptó la conexión. */
function startRemotePlay(ip, opts, timeoutMs = 4000) {
  return new Promise(resolve => {
    const s = net.connect({ host: ip, port: 8000, timeout: timeoutMs })
    let done = false
    const end = ok => { if (done) return; done = true; try { s.destroy() } catch { /* noop */ } resolve(ok) }
    s.on('connect', () => { s.write(initPacket(opts)); setTimeout(() => end(true), 1500) })   // NTR arranca solo; el TCP no hace falta mantenerlo
    s.on('timeout', () => end(false)); s.on('error', () => end(false))
  })
}

module.exports = { initPacket, FrameAssembler, NtrReceiver, startRemotePlay }
