// Pruebas locales sin red: seguridad de rutas, protocolo de mando y manejadores del PC.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseRoots, resolveVirtual, pcHandlers, mapKey } from '../src/pc.mjs'
import { buildPacket } from '../src/ds.mjs'

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'forja-test-'))
const games = path.join(base, 'Games'), secret = path.join(base, 'secret')
await fs.mkdir(path.join(games, 'Juego1'), { recursive: true })
await fs.mkdir(secret)
await fs.writeFile(path.join(games, 'Juego1', 'a.txt'), 'hola')
await fs.writeFile(path.join(secret, 'pass.txt'), 'x')
await fs.symlink(secret, path.join(games, 'enlace')).catch(() => {})

const roots = parseRoots(games)
assert.equal(roots[0].alias, 'Games')

// Rutas válidas e inválidas
assert.equal((await resolveVirtual(roots, '/')).abs, null)
assert.equal((await resolveVirtual(roots, '/Games/Juego1')).abs, path.join(games, 'Juego1'))
await assert.rejects(resolveVirtual(roots, '/Games/../secret'), /fuera/)
await assert.rejects(resolveVirtual(roots, '/Games/Juego1/../../secret/pass.txt'), /fuera/)
await assert.rejects(resolveVirtual(roots, '/Otra'), /no permitida/)
await assert.rejects(resolveVirtual(roots, '/Games/enlace/pass.txt'), /fuera/)   // symlink que escapa

// Manejadores
const ctx = { uploadToStorage: async (_c, name, buf) => `k/${name}:${buf.length}`, downloadFromStorage: async () => Buffer.from('nuevo') }
const h = pcHandlers(roots, ctx)
const top = await h.list_dir({ path: '/' }); assert.deepEqual(top.entries.map(e => e.name), ['Games'])
const ls = await h.list_dir({ path: '/Games/Juego1' }); assert.equal(ls.entries[0].name, 'a.txt'); assert.equal(ls.entries[0].size, 4)
assert.equal((await h.get_file({ path: '/Games/Juego1/a.txt' }, { id: 'c' })).storage, 'k/a.txt:4')
await h.put_file({ path: '/Games/Juego1/b.txt', storage: 'x' }); assert.equal(await fs.readFile(path.join(games, 'Juego1', 'b.txt'), 'utf8'), 'nuevo')
await h.mkdir({ path: '/Games/Juego1/sub' }); await h.rename({ path: '/Games/Juego1/b.txt', to: '/Games/Juego1/c.txt' })
await h.delete({ path: '/Games/Juego1/c.txt' }); await assert.rejects(h.delete({ path: '/Games' }), /raíz/)
await assert.rejects(h.list_dir({ path: '/Games/../secret' }), /fuera/)

// Protocolo de mando
const neutral = buildPacket({ b: 0, cx: 0, cy: 0, sx: 0, sy: 0, t: null })
assert.equal(neutral.length, 20)
assert.equal(neutral.readUInt32LE(0), 0xfff); assert.equal(neutral.readUInt32LE(8), 0x7ff7ff); assert.equal(neutral.readUInt32LE(12), 0x80800081)
assert.equal(buildPacket({ b: 1, cx: 0, cy: 0, sx: 0, sy: 0, t: null }).readUInt32LE(0), 0xffe)               // A pulsado
assert.equal(buildPacket({ b: 1 << 11, cx: 0, cy: 0, sx: 0, sy: 0, t: null }).readUInt32LE(0), 0x7ff)        // Y pulsado
assert.equal(buildPacket({ b: 0, cx: 1, cy: 1, sx: 0, sy: 0, t: null }).readUInt32LE(8), (0xffe << 12) | 0xffe)   // Circle Pad a tope
assert.equal(buildPacket({ b: 0, cx: 0, cy: 0, sx: 0, sy: 0, t: [0, 0] }).readUInt32LE(4) >>> 24, 1)         // táctil activo
assert.equal(buildPacket({ b: 0, cx: 0, cy: 0, sx: 0, sy: 0, t: null, home: true }).readUInt32LE(16), 1)
assert.equal(mapKey('Enter'), 'enter'); assert.equal(mapKey('a'), 'a'); assert.equal(mapKey('F5'), 'f5')

await fs.rm(base, { recursive: true, force: true })
console.log('✔ bridge: todas las pruebas pasan')
