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
  // Energía: comandos por sistema (no se ejecutan)
  const pw = require('../src/core/power')
  assert.deepEqual(pw.powerCommand('win32', 'lock'), ['rundll32.exe', ['user32.dll,LockWorkStation']])
  assert.deepEqual(pw.powerCommand('win32', 'shutdown'), ['shutdown', ['/s', '/t', '10']])
  assert.deepEqual(pw.powerCommand('linux', 'restart'), ['systemctl', ['reboot']]); assert.equal(pw.powerCommand('darwin', 'sleep')[0], 'pmset')
  assert.throws(() => pw.powerCommand('linux', 'rm -rf /'), /no válida/)

  // NTR: reconstrucción de fotogramas JPEG a partir de trozos UDP + paquete de inicio
  const ntr = require('../src/core/ntr')
  const ip = ntr.initPacket({ quality: 80, topPriority: true, priority: 3, qos: 16 })
  assert.equal(ip.length, 84); assert.equal(ip.readUInt32LE(0), 0x12345678); assert.equal(ip.readUInt32LE(12), 901)
  assert.equal(ip.readUInt32LE(16), (1 << 8) | 3); assert.equal(ip.readUInt32LE(20), 80); assert.equal(ip.readUInt32LE(24), (32 << 16) >>> 0)
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), require('node:crypto').randomBytes(5000), Buffer.from([0xff, 0xd9])])
  const got = []
  const asm = new ntr.FrameAssembler((screen, buf) => got.push({ screen, buf }))
  const frag = (frame, screenBit, data) => { const out = []; for (let i = 0, n = 0; i < data.length; i += 1444, n++) { const last = i + 1444 >= data.length; out.push(Buffer.concat([Buffer.from([frame, (last ? 0x10 : 0) | screenBit, 0, n]), data.subarray(i, i + 1444)])) } return out }
  const topPk = frag(7, 1, jpeg), botPk = frag(7, 0, jpeg.subarray(0, 2000))
  // los trozos de las dos pantallas se intercalan
  for (let i = 0; i < Math.max(topPk.length, botPk.length); i++) { if (topPk[i]) asm.push(topPk[i]); if (botPk[i]) asm.push(botPk[i]) }
  assert.equal(got.length, 2); assert.equal(got.find(g => g.screen === 'top').buf.equals(jpeg), true); assert.equal(got.find(g => g.screen === 'bottom').buf.length, 2000)
  const lost = frag(8, 1, jpeg); lost.splice(1, 1); got.length = 0; lost.forEach(p => asm.push(p)); assert.equal(got.length, 0)   // un trozo perdido descarta el fotograma
  // UDP de verdad
  const frames = []
  const rx = new ntr.NtrReceiver({ port: 18001, onFrame: (s, b) => frames.push([s, b]) })
  const tx = require('node:dgram').createSocket('udp4')
  for (const pk of frag(9, 1, jpeg)) tx.send(pk, 18001, '127.0.0.1')
  await new Promise(r => setTimeout(r, 300)); tx.close(); rx.stop()
  assert.equal(frames.length, 1); assert.equal(frames[0][1].equals(jpeg), true)
  // TCP: se envía el paquete de inicio a un "NTR" falso
  const fake = require('node:net').createServer(sock => sock.once('data', d => { fake.got = d })); await new Promise(r => fake.listen(0, '127.0.0.1', r))
  const origConnect = require('node:net').connect
  require('node:net').connect = o => origConnect({ ...o, port: fake.address().port })
  assert.equal(await ntr.startRemotePlay('127.0.0.1', { quality: 70 }, 3000), true)
  require('node:net').connect = origConnect; fake.close()
  assert.equal(fake.got.length, 84); assert.equal(fake.got.readUInt32LE(12), 901); assert.equal(fake.got.readUInt32LE(20), 70)

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
