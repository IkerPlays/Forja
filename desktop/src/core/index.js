'use strict'
// Núcleo de Forja para escritorio. Lo carga el "shell" (src/main.js) y puede actualizarse por internet sin reinstalar.
module.exports = function start(ctx) {
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, session, desktopCapturer, shell, screen, nativeImage, Notification } = ctx.electron
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const crypto = require('node:crypto')
const roots = require('./fsroots')
const input = require('./input')
const relay = require('./relay')
const { PadSender } = require('./pad')
const ntr = require('./ntr')
const power = require('./power')

const DEFAULT_WEB_URL = process.env.FORJA_URL || 'https://forja-hub.netlify.app'
const startHidden = process.argv.includes('--hidden')

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }

/* ---------------- Ajustes (userData/forja-desktop.json) ---------------- */
const settingsFile = () => path.join(app.getPath('userData'), 'forja-desktop.json')
let settings = { webUrl: DEFAULT_WEB_URL, roots: [], fullAccess: true, allowInput: true, allowScreen: true, shareCamera: false, shareMic: false, allowPower: false, screenQuality: 'fluid', deviceId: '', relay: true, autostart: false, hostId: '' }
function loadSettings() {
  let first = false
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } } catch { first = true }
  if (!settings.hostId) { settings.hostId = crypto.randomUUID(); saveSettings() }
  // Primera vez: el PC queda disponible "directamente" (todo el equipo + arranque con el sistema)
  if (first) { settings.autostart = true; saveSettings(); if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] }) }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)) } catch (e) { console.warn('ajustes:', e.message) }
}
const getRoots = () => (settings.fullAccess ? roots.systemRoots() : roots.parseRoots(settings.roots))
const fsApi = roots.api(getRoots)

/* ---------------- Ventana y bandeja ---------------- */
let win = null, tray = null, quitting = false, padSender = null, relayHandle = null, relayError = ''
const iconPath = path.join(ctx.shellDir, 'icon.png')

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 600, show: !startHidden, backgroundColor: '#0f1115', title: 'Forja',
    icon: iconPath, autoHideMenuBar: true,
    webPreferences: { preload: path.join(ctx.shellDir, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  })
  win.removeMenu()
  win.loadURL(settings.webUrl).catch(() => {})
  const origin = new URL(settings.webUrl).origin
  const external = url => { try { return new URL(url).origin !== origin } catch { return true } }
  win.webContents.setWindowOpenHandler(({ url }) => { if (external(url)) void shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { if (external(url)) { e.preventDefault(); void shell.openExternal(url) } })
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<body style="background:#0f1115;color:#e8eaf0;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:420px"><h2>No se pudo abrir Forja</h2><p style="color:#8b93a5">${desc}. Comprueba tu conexión a internet.</p><button onclick="location.href='${settings.webUrl}'" style="padding:10px 18px;border-radius:9px;border:0;background:#ff7a2f;font-weight:700">Reintentar</button></div></body>`))
  })
  // Cerrar la ventana la oculta: el PC sigue disponible en Forja desde la bandeja
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide() } })
}

function showWindow() { if (!win) createWindow(); win.show(); win.focus() }

function rebuildTray() {
  if (!tray) return
  const items = [{ label: 'Abrir Forja', click: showWindow }]
  if (pendingUpdate) items.push({ label: `Reiniciar para actualizar a v${pendingUpdate}`, click: () => { quitting = true; app.relaunch(); app.exit(0) } })
  items.push({ type: 'separator' }, { label: 'Salir (el PC dejará de estar disponible)', click: () => { quitting = true; app.quit() } })
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function createTray() {
  let img = nativeImage.createFromPath(iconPath)
  if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 })
  tray = new Tray(img)
  tray.setToolTip('Forja — este PC está disponible')
  rebuildTray()
  tray.on('click', showWindow)
}

/* ---------------- Puente local para la 3DS ---------------- */
async function applyRelay() {
  if (relayHandle) { relayHandle.stop(); relayHandle = null }
  relayError = ''
  if (!settings.relay) return
  try {
    const cfg = await (await fetch(new URL('/forja-config.json', settings.webUrl))).json()
    relayHandle = relay.start({ supabaseUrl: cfg.url, anon: cfg.anon, onLog: m => { console.log(m); if (/relay (http|udp):/.test(m)) relayError = m } })
  } catch (e) { relayError = 'No se pudo arrancar el puente local: ' + e.message; console.warn(relayError) }
}

/* ---------------- IPC ---------------- */
const handle = (name, fn) => ipcMain.handle('forja:' + name, async (_e, ...a) => fn(...a))
const safeSettings = () => ({ ...settings })

handle('info', () => ({
  hostname: os.hostname(), platform: process.platform, version: ctx.version, shellVersion: app.getVersion(), hostId: settings.hostId,
  input: input.available(), lan: relay.lanAddresses().map(i => i.address),
}))
handle('settings:get', () => safeSettings())
handle('settings:set', async patch => {
  for (const k of ['fullAccess', 'allowInput', 'allowScreen', 'shareCamera', 'shareMic', 'allowPower', 'relay', 'autostart']) if (k in patch) settings[k] = !!patch[k]
  if (typeof patch.deviceId === 'string') settings.deviceId = patch.deviceId
  if (patch.screenQuality === 'fluid' || patch.screenQuality === 'native') settings.screenQuality = patch.screenQuality
  saveSettings()
  if ('autostart' in patch) app.setLoginItemSettings({ openAtLogin: settings.autostart, args: ['--hidden'] })
  if ('relay' in patch) await applyRelay()
  return safeSettings()
})
handle('roots:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Carpeta que quieres compartir con Forja', properties: ['openDirectory'] })
  if (!r.canceled && r.filePaths[0] && !settings.roots.includes(r.filePaths[0])) { settings.roots.push(r.filePaths[0]); saveSettings() }
  return safeSettings()
})
handle('roots:remove', p => { settings.roots = settings.roots.filter(x => x !== p); saveSettings(); return safeSettings() })
handle('roots:list', () => getRoots().map(r => r.alias))

handle('fs:list', p => fsApi.list(p))
handle('fs:size', p => fsApi.size(p))
handle('fs:read', async (p, offset, length) => new Uint8Array(await fsApi.read(p, offset, length)))
handle('fs:write', (p, data, append) => fsApi.write(p, data, append))
handle('fs:mkdir', p => fsApi.mkdir(p))
handle('fs:rename', (a, b) => fsApi.rename(a, b))
handle('fs:remove', p => fsApi.remove(p))
handle('relay:status', () => (relayHandle ? { on: true, ...relayHandle.status() } : { on: false, addresses: [], requests: 0, error: relayError }))
// Windows: abre los puertos de la 3DS en el cortafuegos (pide permiso de administrador)
handle('fw:allow', () => new Promise(resolve => {
  if (process.platform !== 'win32') return resolve(false)
  const cmd = path.join(os.tmpdir(), 'forja-firewall.cmd')
  fs.writeFileSync(cmd, [
    '@echo off',
    'netsh advfirewall firewall delete rule name="Forja puente 3DS (TCP)" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="Forja puente 3DS (UDP)" >nul 2>&1',
    'netsh advfirewall firewall add rule name="Forja puente 3DS (TCP)" dir=in action=allow protocol=TCP localport=8765 profile=any',
    'netsh advfirewall firewall add rule name="Forja puente 3DS (UDP)" dir=in action=allow protocol=UDP localport=8766 profile=any', ''].join('\r\n'))
  require('node:child_process').execFile('powershell', ['-NoProfile', '-Command', `Start-Process -FilePath '${cmd}' -Verb RunAs -Wait`], err => resolve(!err))
}))

const bounds = () => {
  const d = screen.getPrimaryDisplay(); const sf = process.platform === 'darwin' ? 1 : d.scaleFactor
  return { x: d.bounds.x * sf, y: d.bounds.y * sf, width: d.bounds.width * sf, height: d.bounds.height * sf }
}
ipcMain.on('forja:input:mouse', (_e, m) => { if (settings.allowInput) void input.mouse(m, bounds()) })
ipcMain.on('forja:input:key', (_e, m) => { if (settings.allowInput) void input.key(m) })
ipcMain.on('forja:pad', (_e, ip, port, state) => { if (!padSender) padSender = new PadSender(); padSender.update(String(ip), port, state) })

/* ---------------- Energía ---------------- */
handle('power:do', async action => {
  if (!settings.allowPower) throw new Error('Desactivado en este PC (Forja de escritorio → Este equipo → Permitir bloquear/suspender/apagar)')
  await power.runPower(action)
})

/* ---------------- Pantalla de la 3DS (NTR / NTR-HR) ---------------- */
let ntrRx = null
handle('ntr:start', async (ip, opts) => {
  if (!ntrRx) ntrRx = new ntr.NtrReceiver({ onFrame: (screen, jpeg) => { if (win && !win.isDestroyed()) win.webContents.send('forja:ntr-frame', screen, new Uint8Array(jpeg)) }, onLog: m => console.log(m) })
  const accepted = await ntr.startRemotePlay(String(ip), opts || {})
  return { accepted, frames: ntrRx.frames }
})
handle('ntr:status', () => ({ on: !!ntrRx, frames: ntrRx ? ntrRx.frames : 0, lastFrameAgoMs: ntrRx && ntrRx.lastFrameAt ? Date.now() - ntrRx.lastFrameAt : null }))
handle('ntr:stop', () => { if (ntrRx) { ntrRx.stop(); ntrRx = null } })

/* ---------------- Autoactualización del núcleo ---------------- */
// Cada release publica desktop-core.js + latest.json en la web. El shell instalado carga el núcleo más reciente
// que haya descargado (userData/core), así la lógica se actualiza sin reinstalar el programa.
const semverGt = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false }
let pendingUpdate = ''
async function checkUpdate(manual) {
  try {
    const base = settings.webUrl.replace(/\/$/, '')
    const info = await (await fetch(base + '/downloads/latest.json', { cache: 'no-store' })).json()
    const d = info.desktop
    if (!d || !d.version || !d.sha256) return { ok: true, current: ctx.version }
    if (!semverGt(d.version, ctx.version) || pendingUpdate === d.version) return { ok: true, current: ctx.version, latest: d.version }
    const res = await fetch(base + '/downloads/desktop-core.js', { cache: 'no-store' })
    const buf = Buffer.from(await res.arrayBuffer())
    const sum = crypto.createHash('sha256').update(buf).digest('hex')
    if (!res.ok || sum !== d.sha256) throw new Error('La actualización descargada no coincide con su firma (sha256)')
    const dir = path.join(app.getPath('userData'), 'core')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'core.js'), buf)
    fs.writeFileSync(path.join(dir, 'core.json'), JSON.stringify({ version: d.version, sha256: sum }))
    pendingUpdate = d.version
    rebuildTray()
    try { new Notification({ title: 'Forja se ha actualizado', body: `Versión ${d.version} lista. Se aplicará al reiniciar Forja.` }).show() } catch { /* noop */ }
    // En segundo plano (ventana oculta) se aplica sola; si estás usando Forja, tú eliges cuándo
    if (!manual && win && !win.isVisible()) setTimeout(() => { if (!win.isVisible()) { quitting = true; app.relaunch(); app.exit(0) } }, 15_000)
    return { ok: true, current: ctx.version, latest: d.version, downloaded: true }
  } catch (e) { return { ok: false, error: e.message } }
}
handle('update:check', () => checkUpdate(true))
handle('update:apply', () => { quitting = true; app.relaunch(); app.exit(0) })

/* ---------------- Arranque ---------------- */
app.on('second-instance', showWindow)
app.whenReady().then(async () => {
  loadSettings()
  const origin = new URL(settings.webUrl).origin
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    const ok = ['media', 'display-capture', 'fullscreen', 'clipboard-sanitized-write', 'notifications'].includes(permission)
    cb(ok && wc.getURL().startsWith(origin))
  })
  // Compartir pantalla sin selector: toma la pantalla principal (y el audio del sistema en Windows)
  ses.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      cb(process.platform === 'win32' ? { video: sources[0], audio: 'loopback' } : { video: sources[0] })
    } catch { cb({}) }
  })
  createTray()
  createWindow()
  await applyRelay()
  setTimeout(() => void checkUpdate(false), 20_000)
  setInterval(() => void checkUpdate(false), 6 * 3600 * 1000)
})
app.on('before-quit', () => { quitting = true; if (relayHandle) relayHandle.stop(); if (padSender) padSender.close(); if (ntrRx) ntrRx.stop() })
app.on('window-all-closed', () => { /* se queda en la bandeja */ })
}
