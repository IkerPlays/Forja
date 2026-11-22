'use strict'
// Input Redirection de Luma3DS: paquete UDP de 20 bytes (u32 LE ×5) al puerto 4950 de la consola:
// hidPad (activo a 0) · pantalla táctil · Circle Pad · C-Stick/ZL/ZR · Home. Se reenvía a ~60 Hz mientras haya actividad.
const dgram = require('node:dgram')

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// Formato verificado con Luma3DS (rosalina/input_redirection.c) y su cliente de referencia InputRedirectionClient-Qt:
//  hidPad: bits 0..11 = A B Select Start → ← ↑ ↓ R L X Y, activos a 0 · táctil: (1<<24)|(y<<12)|x con x,y en 0..0xFFF (0x2000000 = sin tocar)
//  Circle Pad: (y<<12)|x centrado en 0x800 con ±0x5D0 · C-Stick: (y<<24)|(x<<16)|(ZR<<9|ZL<<10)|0x81, girado 45° · botones de sistema: bit0 = HOME
const CPAD_BOUND = 0x5d0, CPP_BOUND = 0x7f

function buildPacket(s) {
  let hid = 0xfff
  for (let i = 0; i < 12; i++) if (s.b & (1 << i)) hid &= ~(1 << i)

  let touch = 0x2000000
  if (s.t) {
    const x = clamp(Math.floor(0xfff * clamp(s.t[0], 0, 1)), 0, 0xfff)
    const y = clamp(Math.floor(0xfff * clamp(s.t[1], 0, 1)), 0, 0xfff)
    touch = ((1 << 24) | (y << 12) | x) >>> 0
  }

  let circle = 0x7ff7ff
  if (s.cx || s.cy) {
    const x = clamp(Math.floor(s.cx * CPAD_BOUND + 0x800), 0, 0xfff)
    const y = clamp(Math.floor(s.cy * CPAD_BOUND + 0x800), 0, 0xfff)
    circle = ((y << 12) | x) >>> 0
  }

  let cstick = 0x80800081
  const zl = (s.b & (1 << 14)) !== 0, zr = (s.b & (1 << 15)) !== 0
  if (s.sx || s.sy || zl || zr) {
    const rx = s.sx, ry = s.sy
    const x = clamp(Math.floor(Math.SQRT1_2 * (rx + ry) * CPP_BOUND + 0x80), 0, 0xff)
    const y = clamp(Math.floor(Math.SQRT1_2 * (ry - rx) * CPP_BOUND + 0x80), 0, 0xff)
    const ir = (zr ? 1 << 1 : 0) | (zl ? 1 << 2 : 0)
    cstick = (((y << 24) | (x << 16) | (ir << 8) | 0x81) >>> 0)
  }

  const buf = Buffer.alloc(20)
  buf.writeUInt32LE(hid >>> 0, 0); buf.writeUInt32LE(touch, 4); buf.writeUInt32LE(circle, 8)
  buf.writeUInt32LE(cstick, 12); buf.writeUInt32LE(s.home ? 1 : 0, 16)
  return buf
}

const neutral = s => !s.b && !s.cx && !s.cy && !s.sx && !s.sy && !s.t && !s.home

class PadSender {
  constructor() { this.sock = dgram.createSocket('udp4'); this.sock.on('error', e => { this.lastError = e.message }); this.state = null; this.timer = null; this.target = null; this.idleSince = 0; this.lastUpdate = 0; this.sent = 0; this.lastError = '' }
  update(ip, port, state) {
    this.target = { ip, port: Number(port) || 4950 }
    this.state = state
    this.lastUpdate = Date.now()
    this.idleSince = neutral(state) ? this.idleSince || Date.now() : 0
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000 / 60)
    this.tick()
  }
  tick() {
    if (!this.state || !this.target) return
    // Vigilante: la web reenvía el estado cada ~0,4 s mientras hay algo pulsado; si deja de llegar (pestaña cerrada, red caída)
    // se suelta todo para no dejar un botón atascado en la consola
    if (!neutral(this.state) && Date.now() - this.lastUpdate > 2000) { this.state = { b: 0, cx: 0, cy: 0, sx: 0, sy: 0, t: null }; this.idleSince = Date.now() }
    this.sock.send(buildPacket(this.state), this.target.port, this.target.ip, err => { if (err) this.lastError = err.message; else this.lastError = '' })
    this.sent++
    if (this.idleSince && Date.now() - this.idleSince > 300) this.stop()
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
  close() { this.stop(); try { this.sock.close() } catch { /* noop */ } }
}

module.exports = { buildPacket, PadSender }
