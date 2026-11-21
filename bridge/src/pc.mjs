// Dispositivo tipo PC: sistema de archivos (limitado a PC_ROOTS) + ratón/teclado (robotjs opcional)
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { MAX_FILE, warn } from './util.mjs'

export function parseRoots(raw) {
  const roots = []
  const used = new Set()
  for (const part of (raw || '').split(';').map(s => s.trim()).filter(Boolean)) {
    const abs = path.resolve(part)
    let alias = path.basename(abs) || abs.replace(/[^\w]+/g, '_')
    let n = 2
    while (used.has(alias)) alias = `${path.basename(abs)}_${n++}`
    used.add(alias)
    roots.push({ alias, abs })
  }
  return roots
}

const inside = (root, target) => {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Ruta virtual "/alias/sub/dir" → ruta real, garantizando que no se sale de la raíz (ni con symlinks ni "..") */
export async function resolveVirtual(roots, vpath) {
  const parts = String(vpath || '/').split('/').filter(Boolean)
  if (!parts.length) return { root: null, abs: null }
  const root = roots.find(r => r.alias === parts[0])
  if (!root) throw new Error('Carpeta no permitida')
  const abs = path.resolve(root.abs, ...parts.slice(1))
  if (!inside(root.abs, abs)) throw new Error('Ruta fuera de las carpetas permitidas')
  // Si existe, comprueba también el destino real (symlinks)
  try {
    const [realRoot, realAbs] = await Promise.all([fs.realpath(root.abs), fs.realpath(abs)])
    if (!inside(realRoot, realAbs)) throw new Error('Ruta fuera de las carpetas permitidas')
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    // No existe todavía (mkdir / put_file / rename): valida el directorio padre
    const parent = path.dirname(abs)
    try {
      const [realRoot, realParent] = await Promise.all([fs.realpath(root.abs), fs.realpath(parent)])
      if (!inside(realRoot, realParent)) throw new Error('Ruta fuera de las carpetas permitidas')
    } catch (e2) { if (e2.code !== 'ENOENT') throw e2 }
  }
  return { root, abs }
}

export function pcHandlers(roots, ctx) {
  const need = r => { if (!r.abs) throw new Error('Elige primero una de las carpetas'); return r }
  return {
    async list_dir({ path: p }) {
      const r = await resolveVirtual(roots, p)
      if (!r.abs) return { entries: roots.map(x => ({ name: x.alias, type: 'dir', size: 0, mtime: null })) }
      const names = await fs.readdir(r.abs, { withFileTypes: true })
      const entries = []
      for (const d of names.slice(0, 2000)) {
        try {
          const st = await fs.stat(path.join(r.abs, d.name))
          entries.push({ name: d.name, type: st.isDirectory() ? 'dir' : 'file', size: st.isFile() ? st.size : 0, mtime: st.mtimeMs })
        } catch { /* archivo ilegible: se omite */ }
      }
      return { entries, truncated: names.length > 2000 }
    },
    async get_file({ path: p }, cmd) {
      const r = need(await resolveVirtual(roots, p))
      const st = await fs.stat(r.abs)
      if (!st.isFile()) throw new Error('No es un archivo')
      if (st.size > MAX_FILE) throw new Error('El archivo supera los 50 MB')
      return { storage: await ctx.uploadToStorage(cmd, path.basename(r.abs), await fs.readFile(r.abs)) }
    },
    async put_file({ path: p, storage }) {
      const r = need(await resolveVirtual(roots, p))
      await fs.writeFile(r.abs, await ctx.downloadFromStorage(storage))
      return {}
    },
    async mkdir({ path: p }) { await fs.mkdir(need(await resolveVirtual(roots, p)).abs, { recursive: true }); return {} },
    async rename({ path: p, to }) {
      const a = need(await resolveVirtual(roots, p)), b = need(await resolveVirtual(roots, to))
      await fs.rename(a.abs, b.abs); return {}
    },
    async delete({ path: p }) {
      const r = need(await resolveVirtual(roots, p))
      if (r.abs === r.root.abs) throw new Error('No se puede borrar una carpeta raíz')
      await fs.rm(r.abs, { recursive: true, force: false }); return {}
    },
  }
}

export function pcInfo(roots) {
  return {
    Sistema: `${os.type()} ${os.release()} (${os.arch()})`,
    Equipo: os.hostname(),
    'Carpetas expuestas': roots.map(r => r.alias).join(', ') || 'ninguna (define PC_ROOTS)',
    Bridge: 'forja-bridge 0.1.0',
  }
}

/* ---------------- Ratón y teclado (opcional) ---------------- */
let robot = null
export async function loadRobot() {
  try { robot = (await import('@jitsi/robotjs')).default } catch { robot = null }
  return !!robot
}

const KEYS = {
  Enter: 'enter', ' ': 'space', Backspace: 'backspace', Tab: 'tab', Escape: 'escape', Delete: 'delete',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end',
  PageUp: 'pageup', PageDown: 'pagedown', Shift: 'shift', Control: 'control', Alt: 'alt', Meta: 'command',
  CapsLock: 'capslock', Insert: 'insert',
}
export const mapKey = k => KEYS[k] ?? (/^F\d{1,2}$/.test(k) ? k.toLowerCase() : k.length === 1 ? k.toLowerCase() : null)

export function handlePcInput(m) {
  if (!robot) return
  try {
    if (m.k === 'mouse') {
      const { width, height } = robot.getScreenSize()
      robot.moveMouse(Math.round(m.x * (width - 1)), Math.round(m.y * (height - 1)))
      const btn = m.b === 2 ? 'right' : m.b === 1 ? 'middle' : 'left'
      if (m.a === 'down') robot.mouseToggle('down', btn)
      else if (m.a === 'up') robot.mouseToggle('up', btn)
      else if (m.a === 'wheel') robot.scrollMouse(0, m.dy > 0 ? -3 : 3)
    } else if (m.k === 'key') {
      const key = mapKey(String(m.key))
      if (key) robot.keyToggle(key, m.a === 'down' ? 'down' : 'up')
    }
  } catch (e) { warn('entrada PC:', e.message) }
}
