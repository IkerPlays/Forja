'use strict'
// Input Redirection de Luma3DS: paquete UDP de 20 bytes (u32 LE ×5) al puerto 4950 de la consola:
// hidPad (activo a 0) · pantalla táctil · Circle Pad · C-Stick/ZL/ZR · Home. Se reenvía a ~60 Hz mientras haya actividad.
const dgram = require('node:dgram')

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

function buildPacket(s) {
  let hid = 0xfff
  for (let i = 0; i < 12; i++) if (s.b & (1 << i)) hid &= ~(1 << i)
  let touch = 0x2000000
  if (s.t) {
    const x = clamp(Math.round(s.t[0] * 0xfff), 0, 0xfff)
    const y = clamp(Math.round(s.t[1] * 0xfff), 0, 0xfff)
    touch = ((1 << 24) | (y << 12) | x) >>> 0
  }
  const c = v => clamp(Math.round(0x7ff + v * 0x7ff), 0, 0xfff)
  const circle = ((c(s.cy) << 12) | c(s.cx)) >>> 0
  let cstick = 0x80800081
  const zl = (s.b & (1 << 14)) !== 0, zr = (s.b & (1 << 15)) !== 0
  if (s.sx || s.sy || zl || zr) {
    const sx = clamp(Math.round(0x80 + s.sx * 0x7f), 1, 0xff), sy = clamp(Math.round(0x80 + s.sy * 0x7f), 1, 0xff)
    cstick = ((sy << 24) | (sx << 16) | 0x81) >>> 0
    if (zl) cstick = (cstick & ~0x80) >>> 0
    if (zr) cstick = (cstick & ~0x01) >>> 0
  }
  const buf = Buffer.alloc(20)
  buf.writeUInt32LE(hid >>> 0, 0); buf.writeUInt32LE(touch, 4); buf.writeUInt32LE(circle, 8)
  buf.writeUInt32LE(cstick, 12); buf.writeUInt32LE(s.home ? 1 : 0, 16)
  return buf
}

const neutral = s => !s.b && !s.cx && !s.cy && !s.sx && !s.sy && !s.t && !s.home

class PadSender {
  constructor() { this.sock = dgram.createSocket('udp4'); this.sock.on('error', () => {}); this.state = null; this.timer = null; this.target = null; this.idleSince = 0 }
  update(ip, port, state) {
    this.target = { ip, port: Number(port) || 4950 }
    this.state = state
    this.idleSince = neutral(state) ? this.idleSince || Date.now() : 0
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000 / 60)
    this.tick()
  }
  tick() {
    if (!this.state || !this.target) return
    this.sock.send(buildPacket(this.state), this.target.port, this.target.ip)
    if (this.idleSince && Date.now() - this.idleSince > 300) this.stop()
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
  close() { this.stop(); try { this.sock.close() } catch { /* noop */ } }
}

module.exports = { buildPacket, PadSender }
