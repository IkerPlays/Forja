// Dispositivo tipo 3DS: archivos por FTP (homebrew "ftpd") y mando por Input Redirection (UDP 4950 de Luma3DS)
import dgram from 'node:dgram'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from 'basic-ftp'
import { MAX_FILE, warn } from './util.mjs'

async function withFtp(cfg, fn) {
  if (!cfg.ip) throw new Error('Falta la IP de la 3DS (edítala en Conexión)')
  const c = new Client(20_000)
  try {
    await c.access({
      host: cfg.ip, port: Number(cfg.ftp_port) || 5000,
      user: cfg.ftp_user || 'anonymous', password: cfg.ftp_pass || 'anonymous', secure: false,
    })
    return await fn(c)
  } catch (e) {
    if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|timeout/i.test(String(e.message || e.code)))
      throw new Error(`No se pudo conectar con la 3DS en ${cfg.ip}. ¿Tiene ftpd abierto y está en la misma WiFi?`)
    throw e
  } finally { c.close() }
}

export function dsHandlers(getCfg, ctx) {
  const tmp = name => path.join(os.tmpdir(), `forja-${process.pid}-${Date.now()}-${name.replace(/[^\w.-]/g, '_')}`)
  return {
    list_dir: ({ path: p }) => withFtp(getCfg(), async c => {
      const list = await c.list(p || '/')
      return {
        entries: list.slice(0, 2000).map(f => ({ name: f.name, type: f.isDirectory ? 'dir' : 'file', size: f.size, mtime: f.modifiedAt?.getTime() ?? null })),
        truncated: list.length > 2000,
      }
    }),
    get_file: ({ path: p }, cmd) => withFtp(getCfg(), async c => {
      const size = await c.size(p)
      if (size > MAX_FILE) throw new Error('El archivo supera los 50 MB')
      const file = tmp(path.posix.basename(p))
      try {
        await c.downloadTo(fs.createWriteStream(file), p)
        return { storage: await ctx.uploadToStorage(cmd, path.posix.basename(p), await fsp.readFile(file)) }
      } finally { await fsp.rm(file, { force: true }) }
    }),
    put_file: ({ path: p, storage }) => withFtp(getCfg(), async c => {
      const file = tmp(path.posix.basename(p))
      try {
        await fsp.writeFile(file, await ctx.downloadFromStorage(storage))
        await c.uploadFrom(file, p)
        return {}
      } finally { await fsp.rm(file, { force: true }) }
    }),
    mkdir: ({ path: p }) => withFtp(getCfg(), async c => { await c.send(`MKD ${p}`); return {} }),
    rename: ({ path: p, to }) => withFtp(getCfg(), async c => { await c.rename(p, to); return {} }),
    delete: ({ path: p, type }) => withFtp(getCfg(), async c => { type === 'dir' ? await c.removeDir(p) : await c.remove(p); return {} }),
  }
}

/* ------------------------------------------------------------------ *
 * Input Redirection (Luma3DS → Rosalina → "Input Redirection").       *
 * Paquete UDP de 20 bytes al puerto 4950 (u32 little-endian ×5):      *
 *   hidPad · touchScreen · circlePad · cStick · interfaceButtons      *
 * hidPad es "activo a 0": 0xFFF = nada pulsado.                       *
 * Se reenvía ~60 veces por segundo mientras haya actividad.           *
 * ------------------------------------------------------------------ */
const HID_BITS = 12 // A,B,Select,Start,Right,Left,Up,Down,R,L,X,Y (bits 0..11)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

export function buildPacket(s) {
  let hid = 0xfff
  for (let i = 0; i < HID_BITS; i++) if (s.b & (1 << i)) hid &= ~(1 << i)

  let touch = 0x2000000
  if (s.t) {
    const x = clamp(Math.round(s.t[0] * 0xfff), 0, 0xfff)
    const y = clamp(Math.round(s.t[1] * 0xfff), 0, 0xfff)
    touch = ((1 << 24) | (y << 12) | x) >>> 0
  }

  const c = v => clamp(Math.round(0x7ff + v * 0x7ff), 0, 0xfff)
  const circle = ((c(s.cy) << 12) | c(s.cx)) >>> 0

  // C-Stick / ZL / ZR (solo New 3DS). Disposición experimental: sin usarlos se envía el valor neutro estándar.
  let cstick = 0x80800081
  const zl = (s.b & (1 << 14)) !== 0, zr = (s.b & (1 << 15)) !== 0
  if (s.sx || s.sy || zl || zr) {
    const sx = clamp(Math.round(0x80 + s.sx * 0x7f), 1, 0xff), sy = clamp(Math.round(0x80 + s.sy * 0x7f), 1, 0xff)
    cstick = ((sy << 24) | (sx << 16) | 0x81) >>> 0
    if (zl) cstick = (cstick & ~0x80) >>> 0
    if (zr) cstick = (cstick & ~0x01) >>> 0
  }

  const buttons = s.home ? 1 : 0
  const buf = Buffer.alloc(20)
  buf.writeUInt32LE(hid >>> 0, 0); buf.writeUInt32LE(touch, 4); buf.writeUInt32LE(circle, 8)
  buf.writeUInt32LE(cstick, 12); buf.writeUInt32LE(buttons, 16)
  return buf
}

const isNeutral = s => !s.b && !s.cx && !s.cy && !s.sx && !s.sy && !s.t && !s.home

export class PadSender {
  constructor(getCfg) {
    this.getCfg = getCfg
    this.sock = dgram.createSocket('udp4')
    this.sock.on('error', e => warn('UDP mando:', e.message))
    this.state = null
    this.timer = null
    this.idleSince = 0
  }
  update(state) {
    this.state = state
    this.idleSince = isNeutral(state) ? this.idleSince || Date.now() : 0
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000 / 60)
    this.tick()
  }
  tick() {
    const cfg = this.getCfg()
    if (!this.state || !cfg.ip) return
    this.sock.send(buildPacket(this.state), Number(cfg.input_port) || 4950, cfg.ip)
    // Tras soltarlo todo, unos 300 ms de paquetes neutros y se calla
    if (this.idleSince && Date.now() - this.idleSince > 300) this.stop()
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
  close() { this.stop(); try { this.sock.close() } catch { /* noop */ } }
}
