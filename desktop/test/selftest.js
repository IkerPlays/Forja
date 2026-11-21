'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const dgram = require('node:dgram')
const R = require('../src/core/fsroots')
const { buildPacket } = require('../src/core/pad')
const { keyName } = require('../src/core/input')
const relay = require('../src/core/relay')

;(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'forja-d-'))
  const games = path.join(base, 'Games'), secret = path.join(base, 'secret')
  await fs.mkdir(path.join(games, 'J1'), { recursive: true }); await fs.mkdir(secret)
  await fs.writeFile(path.join(games, 'J1', 'a.txt'), 'hola'); await fs.writeFile(path.join(secret, 'p.txt'), 'x')
  await fs.symlink(secret, path.join(games, 'enlace')).catch(() => {})
  const roots = R.parseRoots([games]); const api = R.api(() => roots)

  assert.deepEqual((await api.list('/')).entries.map(e => e.name), ['Games'])
  assert.equal((await api.list('/Games/J1')).entries[0].size, 4)
  await assert.rejects(api.list('/Games/../secret'), /fuera/)
  await assert.rejects(api.list('/Games/enlace'), /fuera/)
  await assert.rejects(api.list('/Otra'), /no permitida/)
  assert.equal(await api.size('/Games/J1/a.txt'), 4)
  assert.equal(Buffer.from(await api.read('/Games/J1/a.txt', 1, 2)).toString(), 'ol')
  await api.write('/Games/J1/n.bin', new Uint8Array([1, 2, 3]), false); await api.write('/Games/J1/n.bin', new Uint8Array([4]), true)
  assert.deepEqual([...await fs.readFile(path.join(games, 'J1', 'n.bin'))], [1, 2, 3, 4])
  await api.mkdir('/Games/J1/sub'); await api.rename('/Games/J1/n.bin', '/Games/J1/m.bin'); await api.remove('/Games/J1/m.bin')
  await assert.rejects(api.remove('/Games'), /raíz/)

  assert.equal(buildPacket({ b: 0, cx: 0, cy: 0, sx: 0, sy: 0, t: null }).readUInt32LE(0), 0xfff)
  assert.equal(buildPacket({ b: 1, cx: 0, cy: 0, sx: 0, sy: 0, t: null }).readUInt32LE(0), 0xffe)
  assert.equal(keyName('KeyA'), 'A'); assert.equal(keyName('Digit5'), 'Num5'); assert.equal(keyName('ArrowUp'), 'Up'); assert.equal(keyName('F5'), 'F5')

  // Puente local: configuración + descubrimiento UDP
  const h = relay.start({ supabaseUrl: 'https://example.supabase.co', anon: 'anon-test', httpPort: 18765, discoveryPort: 18766 })
  const cfg = await new Promise((res, rej) => http.get('http://127.0.0.1:18765/forja-config.json', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))) }).on('error', rej))
  assert.equal(cfg.anon, 'anon-test'); assert.match(cfg.url, /^http:\/\/127\.0\.0\.1:18765$/)
  const reply = await new Promise(res => { const s = dgram.createSocket('udp4'); s.on('message', m => { s.close(); res(String(m)) }); s.send('FORJA?', 18766, '127.0.0.1') })
  assert.match(reply, /^FORJA http:\/\/.+:18765$/)
  h.stop()
  // Autoactualización del núcleo: se empaqueta, se verifica el sha256 y se ejecuta con un electron simulado
  const crypto = require('node:crypto'), fssync = require('node:fs'), Module = require('node:module')
  const { semverGt, loadDownloadedCore } = require('../src/loader')
  assert.ok(semverGt('0.5.0', '0.4.9') && semverGt('1.0.0', '0.9.9') && !semverGt('0.4.0', '0.4.0') && !semverGt('0.3.9', '0.4.0'))
  require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'core', 'index.js')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron', '@nut-tree-fork/nut-js'], outfile: path.join(base, 'core.js'), logLevel: 'error' })
  const sha = crypto.createHash('sha256').update(fssync.readFileSync(path.join(base, 'core.js'))).digest('hex')
  const calls = []
  const stubElectron = { app: { requestSingleInstanceLock: () => true, on: (n) => calls.push('on:' + n), whenReady: () => new Promise(() => {}), getPath: () => base, isPackaged: false, getVersion: () => '0.0.0', quit() {}, setLoginItemSettings() {} },
    BrowserWindow: class {}, Tray: class {}, Menu: {}, ipcMain: { handle: (n) => calls.push('handle:' + n), on: () => {} }, dialog: {}, session: {}, desktopCapturer: {}, shell: {}, screen: {}, nativeImage: {}, Notification: class {} }
  const req = Module.createRequire(path.join(__dirname, '..', 'package.json'))
  const fakeReq = id => (id === 'electron' ? stubElectron : req(id))
  const start = loadDownloadedCore(path.join(base, 'core.js'), sha, { require: fakeReq, dirname: path.join(__dirname, '..', 'src'), crypto, fs: fssync })
  assert.equal(typeof start, 'function')
  start({ electron: stubElectron, shellDir: path.join(__dirname, '..', 'src'), version: '9.9.9' })
  assert.ok(calls.includes('handle:forja:update:check') && calls.includes('handle:forja:fs:list'))
  assert.equal(loadDownloadedCore(path.join(base, 'core.js'), 'f'.repeat(64), { require: fakeReq, dirname: '', crypto, fs: fssync }), null)   // sha256 incorrecto → se rechaza

  await fs.rm(base, { recursive: true, force: true })
  console.log('✔ escritorio: todas las pruebas pasan')
})().catch(e => { console.error(e); process.exit(1) })
