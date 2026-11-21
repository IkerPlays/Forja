'use strict'
// Acceso a archivos del PC limitado a carpetas permitidas (o a todo el equipo si el usuario lo activa).
// Las rutas "virtuales" son /<alias>/sub/carpeta; nunca salen de su raíz (ni con ".." ni con enlaces simbólicos).
const fs = require('node:fs/promises')
const fssync = require('node:fs')
const path = require('node:path')

const MAX_FILE = 50 * 1024 * 1024

function parseRoots(list) {
  const roots = []
  const used = new Set()
  for (const raw of list || []) {
    const abs = path.resolve(String(raw))
    let alias = path.basename(abs) || abs.replace(/[^\w]+/g, '_')
    let n = 2
    while (used.has(alias)) alias = `${path.basename(abs) || 'raiz'}_${n++}`
    used.add(alias)
    roots.push({ alias, abs })
  }
  return roots
}

/** Todos los discos (Windows) o "/" (Linux/macOS) */
function systemRoots() {
  if (process.platform === 'win32') {
    const out = []
    for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; try { if (fssync.existsSync(d)) out.push({ alias: String.fromCharCode(c), abs: d }) } catch { /* noop */ } }
    return out
  }
  return [{ alias: 'Equipo', abs: '/' }]
}

const inside = (root, target) => {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

async function resolveVirtual(roots, vpath) {
  const parts = String(vpath || '/').split('/').filter(Boolean)
  if (!parts.length) return { root: null, abs: null }
  const root = roots.find(r => r.alias === parts[0])
  if (!root) throw new Error('Carpeta no permitida')
  const abs = path.resolve(root.abs, ...parts.slice(1))
  if (!inside(root.abs, abs)) throw new Error('Ruta fuera de las carpetas permitidas')
  try {
    const [realRoot, realAbs] = await Promise.all([fs.realpath(root.abs), fs.realpath(abs)])
    if (!inside(realRoot, realAbs)) throw new Error('Ruta fuera de las carpetas permitidas')
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    try {
      const [realRoot, realParent] = await Promise.all([fs.realpath(root.abs), fs.realpath(path.dirname(abs))])
      if (!inside(realRoot, realParent)) throw new Error('Ruta fuera de las carpetas permitidas')
    } catch (e2) { if (e2.code !== 'ENOENT') throw e2 }
  }
  return { root, abs }
}

function api(getRoots) {
  const need = r => { if (!r.abs) throw new Error('Elige primero una de las carpetas'); return r }
  const res = p => resolveVirtual(getRoots(), p)
  return {
    async list(vpath) {
      const r = await res(vpath)
      if (!r.abs) return { entries: getRoots().map(x => ({ name: x.alias, type: 'dir', size: 0, mtime: null })) }
      const names = await fs.readdir(r.abs, { withFileTypes: true })
      const entries = []
      for (const d of names.slice(0, 2000)) {
        try {
          const st = await fs.stat(path.join(r.abs, d.name))
          entries.push({ name: d.name, type: st.isDirectory() ? 'dir' : 'file', size: st.isFile() ? st.size : 0, mtime: st.mtimeMs })
        } catch { /* ilegible: se omite */ }
      }
      return { entries, truncated: names.length > 2000 }
    },
    async size(vpath) {
      const r = need(await res(vpath)); const st = await fs.stat(r.abs)
      if (!st.isFile()) throw new Error('No es un archivo')
      return st.size
    },
    async read(vpath, offset, length) {
      const r = need(await res(vpath))
      const h = await fs.open(r.abs, 'r')
      try {
        const buf = Buffer.alloc(length)
        const { bytesRead } = await h.read(buf, 0, length, offset)
        return buf.subarray(0, bytesRead)
      } finally { await h.close() }
    },
    async write(vpath, data, append) {
      const r = need(await res(vpath))
      await fs.writeFile(r.abs, Buffer.from(data), { flag: append ? 'a' : 'w' })
    },
    async mkdir(vpath) { await fs.mkdir(need(await res(vpath)).abs, { recursive: true }) },
    async rename(from, to) {
      const a = need(await res(from)), b = need(await res(to))
      await fs.rename(a.abs, b.abs)
    },
    async remove(vpath) {
      const r = need(await res(vpath))
      if (r.abs === r.root.abs) throw new Error('No se puede borrar una carpeta raíz')
      await fs.rm(r.abs, { recursive: true, force: false })
    },
  }
}

module.exports = { parseRoots, systemRoots, resolveVirtual, api, MAX_FILE }
