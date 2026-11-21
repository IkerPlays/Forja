'use strict'
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, session, desktopCapturer, shell, screen, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const crypto = require('node:crypto')
const roots = require('./fsroots')
const input = require('./input')
const relay = require('./relay')
const { PadSender } = require('./pad')

const DEFAULT_WEB_URL = process.env.FORJA_URL || 'https://forja-hub.netlify.app'
const startHidden = process.argv.includes('--hidden')

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }

/* ---------------- Ajustes (userData/forja-desktop.json) ---------------- */
const settingsFile = () => path.join(app.getPath('userData'), 'forja-desktop.json')
let settings = { webUrl: DEFAULT_WEB_URL, roots: [], fullAccess: false, allowInput: true, allowScreen: true, relay: true, autostart: false, hostId: '' }
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } } catch { /* primera vez */ }
  if (!settings.hostId) { settings.hostId = crypto.randomUUID(); saveSettings() }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)) } catch (e) { console.warn('ajustes:', e.message) }
}
const getRoots = () => (settings.fullAccess ? roots.systemRoots() : roots.parseRoots(settings.roots))
const fsApi = roots.api(getRoots)

/* ---------------- Ventana y bandeja ---------------- */
let win = null, tray = null, quitting = false, padSender = null, relayHandle = null
const iconPath = path.join(__dirname, 'icon.png')

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 600, show: !startHidden, backgroundColor: '#0f1115', title: 'Forja',
    icon: iconPath, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
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

function createTray() {
  let img = nativeImage.createFromPath(iconPath)
  if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 })
  tray = new Tray(img)
  tray.setToolTip('Forja — este PC está disponible')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Forja', click: showWindow },
    { type: 'separator' },
    { label: 'Salir (el PC dejará de estar disponible)', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('click', showWindow)
}

/* ---------------- Puente local para la 3DS ---------------- */
async function applyRelay() {
  if (relayHandle) { relayHandle.stop(); relayHandle = null }
  if (!settings.relay) return
  try {
    const cfg = await (await fetch(new URL('/forja-config.json', settings.webUrl))).json()
    relayHandle = relay.start({ supabaseUrl: cfg.url, anon: cfg.anon, onLog: m => console.log(m) })
  } catch (e) { console.warn('No se pudo arrancar el puente local:', e.message) }
}

/* ---------------- IPC ---------------- */
const handle = (name, fn) => ipcMain.handle('forja:' + name, async (_e, ...a) => fn(...a))
const safeSettings = () => ({ ...settings })

handle('info', () => ({
  hostname: os.hostname(), platform: process.platform, version: app.getVersion(), hostId: settings.hostId,
  input: input.available(), lan: relay.lanAddresses().map(i => i.address),
}))
handle('settings:get', () => safeSettings())
handle('settings:set', async patch => {
  const allowed = ['fullAccess', 'allowInput', 'allowScreen', 'relay', 'autostart']
  for (const k of allowed) if (k in patch) settings[k] = !!patch[k]
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
handle('relay:status', () => (relayHandle ? { on: true, ...relayHandle.status() } : { on: false, addresses: [], requests: 0 }))

const bounds = () => {
  const d = screen.getPrimaryDisplay(); const sf = process.platform === 'darwin' ? 1 : d.scaleFactor
  return { x: d.bounds.x * sf, y: d.bounds.y * sf, width: d.bounds.width * sf, height: d.bounds.height * sf }
}
ipcMain.on('forja:input:mouse', (_e, m) => { if (settings.allowInput) void input.mouse(m, bounds()) })
ipcMain.on('forja:input:key', (_e, m) => { if (settings.allowInput) void input.key(m) })
ipcMain.on('forja:pad', (_e, ip, port, state) => { if (!padSender) padSender = new PadSender(); padSender.update(String(ip), port, state) })

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
})
app.on('before-quit', () => { quitting = true; if (relayHandle) relayHandle.stop(); if (padSender) padSender.close() })
app.on('window-all-closed', () => { /* se queda en la bandeja */ })
