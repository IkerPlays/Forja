"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/core/fsroots.js
var require_fsroots = __commonJS({
  "src/core/fsroots.js"(exports2, module2) {
    "use strict";
    var fs = require("node:fs/promises");
    var fssync = require("node:fs");
    var path = require("node:path");
    var MAX_FILE = 50 * 1024 * 1024;
    function parseRoots(list) {
      const roots = [];
      const used = /* @__PURE__ */ new Set();
      for (const raw of list || []) {
        const abs = path.resolve(String(raw));
        let alias = path.basename(abs) || abs.replace(/[^\w]+/g, "_");
        let n = 2;
        while (used.has(alias)) alias = `${path.basename(abs) || "raiz"}_${n++}`;
        used.add(alias);
        roots.push({ alias, abs });
      }
      return roots;
    }
    function systemRoots() {
      if (process.platform === "win32") {
        const out = [];
        for (let c = 67; c <= 90; c++) {
          const d = String.fromCharCode(c) + ":\\";
          try {
            if (fssync.existsSync(d)) out.push({ alias: String.fromCharCode(c), abs: d });
          } catch {
          }
        }
        return out;
      }
      return [{ alias: "Equipo", abs: "/" }];
    }
    var inside = (root, target) => {
      const rel = path.relative(root, target);
      return rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);
    };
    async function resolveVirtual(roots, vpath) {
      const parts = String(vpath || "/").split("/").filter(Boolean);
      if (!parts.length) return { root: null, abs: null };
      const root = roots.find((r) => r.alias === parts[0]);
      if (!root) throw new Error("Carpeta no permitida");
      const abs = path.resolve(root.abs, ...parts.slice(1));
      if (!inside(root.abs, abs)) throw new Error("Ruta fuera de las carpetas permitidas");
      try {
        const [realRoot, realAbs] = await Promise.all([fs.realpath(root.abs), fs.realpath(abs)]);
        if (!inside(realRoot, realAbs)) throw new Error("Ruta fuera de las carpetas permitidas");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        try {
          const [realRoot, realParent] = await Promise.all([fs.realpath(root.abs), fs.realpath(path.dirname(abs))]);
          if (!inside(realRoot, realParent)) throw new Error("Ruta fuera de las carpetas permitidas");
        } catch (e2) {
          if (e2.code !== "ENOENT") throw e2;
        }
      }
      return { root, abs };
    }
    function api(getRoots) {
      const need = (r) => {
        if (!r.abs) throw new Error("Elige primero una de las carpetas");
        return r;
      };
      const res = (p) => resolveVirtual(getRoots(), p);
      return {
        async list(vpath) {
          const r = await res(vpath);
          if (!r.abs) return { entries: getRoots().map((x) => ({ name: x.alias, type: "dir", size: 0, mtime: null })) };
          const names = await fs.readdir(r.abs, { withFileTypes: true });
          const entries = [];
          for (const d of names.slice(0, 2e3)) {
            try {
              const st = await fs.stat(path.join(r.abs, d.name));
              entries.push({ name: d.name, type: st.isDirectory() ? "dir" : "file", size: st.isFile() ? st.size : 0, mtime: st.mtimeMs });
            } catch {
            }
          }
          return { entries, truncated: names.length > 2e3 };
        },
        async size(vpath) {
          const r = need(await res(vpath));
          const st = await fs.stat(r.abs);
          if (!st.isFile()) throw new Error("No es un archivo");
          return st.size;
        },
        async read(vpath, offset, length) {
          const r = need(await res(vpath));
          const h = await fs.open(r.abs, "r");
          try {
            const buf = Buffer.alloc(length);
            const { bytesRead } = await h.read(buf, 0, length, offset);
            return buf.subarray(0, bytesRead);
          } finally {
            await h.close();
          }
        },
        async write(vpath, data, append) {
          const r = need(await res(vpath));
          await fs.writeFile(r.abs, Buffer.from(data), { flag: append ? "a" : "w" });
        },
        async mkdir(vpath) {
          await fs.mkdir(need(await res(vpath)).abs, { recursive: true });
        },
        async rename(from, to) {
          const a = need(await res(from)), b = need(await res(to));
          await fs.rename(a.abs, b.abs);
        },
        async remove(vpath) {
          const r = need(await res(vpath));
          if (r.abs === r.root.abs) throw new Error("No se puede borrar una carpeta ra\xEDz");
          await fs.rm(r.abs, { recursive: true, force: false });
        }
      };
    }
    module2.exports = { parseRoots, systemRoots, resolveVirtual, api, MAX_FILE };
  }
});

// src/core/input.js
var require_input = __commonJS({
  "src/core/input.js"(exports2, module2) {
    "use strict";
    var nut = null;
    function load() {
      if (nut !== null) return nut;
      try {
        nut = require("@nut-tree-fork/nut-js");
        nut.keyboard.config.autoDelayMs = 0;
        nut.mouse.config.autoDelayMs = 0;
      } catch (e) {
        nut = false;
        console.warn("nut-js no disponible:", e.message);
      }
      return nut;
    }
    var NAMED = {
      Enter: "Enter",
      NumpadEnter: "Enter",
      Space: "Space",
      Backspace: "Backspace",
      Tab: "Tab",
      Escape: "Escape",
      Delete: "Delete",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      ShiftLeft: "LeftShift",
      ShiftRight: "RightShift",
      ControlLeft: "LeftControl",
      ControlRight: "RightControl",
      AltLeft: "LeftAlt",
      AltRight: "RightAlt",
      MetaLeft: "LeftSuper",
      MetaRight: "RightSuper",
      CapsLock: "CapsLock",
      Insert: "Insert",
      Comma: "Comma",
      Period: "Period",
      Minus: "Minus",
      Equal: "Equal",
      Slash: "Slash",
      Semicolon: "Semicolon",
      Quote: "Quote",
      BracketLeft: "LeftBracket",
      BracketRight: "RightBracket",
      Backslash: "Backslash",
      Backquote: "Grave"
    };
    function keyName(code) {
      if (NAMED[code]) return NAMED[code];
      let m;
      if (m = /^Key([A-Z])$/.exec(code)) return m[1];
      if (m = /^Digit(\d)$/.exec(code)) return "Num" + m[1];
      if (m = /^Numpad(\d)$/.exec(code)) return "NumPad" + m[1];
      if (/^F\d{1,2}$/.test(code)) return code;
      return null;
    }
    async function mouse(m, bounds) {
      const n = load();
      if (!n) return;
      const { mouse: ms, Point, Button } = n;
      try {
        const x = Math.round(bounds.x + m.x * (bounds.width - 1)), y = Math.round(bounds.y + m.y * (bounds.height - 1));
        await ms.setPosition(new Point(x, y));
        const btn = m.b === 2 ? Button.RIGHT : m.b === 1 ? Button.MIDDLE : Button.LEFT;
        if (m.a === "down") await ms.pressButton(btn);
        else if (m.a === "up") await ms.releaseButton(btn);
        else if (m.a === "wheel") {
          const steps = Math.max(1, Math.min(10, Math.round(Math.abs(m.dy) / 40)));
          m.dy > 0 ? await ms.scrollDown(steps) : await ms.scrollUp(steps);
        }
      } catch (e) {
        console.warn("rat\xF3n:", e.message);
      }
    }
    async function key(m) {
      const n = load();
      if (!n) return;
      const name = keyName(String(m.code || ""));
      if (!name || n.Key[name] === void 0) return;
      try {
        m.a === "down" ? await n.keyboard.pressKey(n.Key[name]) : await n.keyboard.releaseKey(n.Key[name]);
      } catch (e) {
        console.warn("teclado:", e.message);
      }
    }
    module2.exports = { mouse, key, keyName, available: () => !!load() };
  }
});

// src/core/relay.js
var require_relay = __commonJS({
  "src/core/relay.js"(exports2, module2) {
    "use strict";
    var http = require("node:http");
    var https = require("node:https");
    var dgram = require("node:dgram");
    var os = require("node:os");
    function lanAddresses() {
      const out = [];
      for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === "IPv4" && !i.internal) out.push(i);
      return out;
    }
    var toInt = (ip) => ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
    function bestAddress(remote) {
      const all = lanAddresses();
      if (remote) {
        const r = toInt(remote);
        const hit = all.find((i) => (toInt(i.address) & toInt(i.netmask)) === (r & toInt(i.netmask)));
        if (hit) return hit.address;
      }
      return all[0] ? all[0].address : "127.0.0.1";
    }
    function start2({ supabaseUrl, anon, httpPort = 8765, discoveryPort = 8766, onLog = () => {
    } }) {
      const target = new URL(supabaseUrl);
      let requests = 0;
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, "http://x");
        if (u.pathname === "/forja-config.json") {
          const host = req.headers.host || `${bestAddress(req.socket.remoteAddress)}:${httpPort}`;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ url: `http://${host}`, anon }));
          return;
        }
        if (!/^\/(auth|rest|storage|functions)\//.test(u.pathname)) {
          res.writeHead(404);
          res.end();
          return;
        }
        requests++;
        const headers = { ...req.headers, host: target.host };
        delete headers["accept-encoding"];
        const up = https.request({ host: target.hostname, port: 443, path: req.url, method: req.method, headers }, (r) => {
          res.writeHead(r.statusCode || 502, r.headers);
          r.pipe(res);
        });
        up.on("error", (e) => {
          onLog("relay: " + e.message);
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        req.pipe(up);
      });
      server.on("error", (e) => onLog("relay http: " + e.message));
      server.listen(httpPort, "0.0.0.0");
      const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
      udp.on("message", (msg, rinfo) => {
        if (String(msg).trim() !== "FORJA?") return;
        const reply = Buffer.from(`FORJA http://${bestAddress(rinfo.address)}:${httpPort}`);
        udp.send(reply, rinfo.port, rinfo.address);
        onLog(`relay: descubierta por ${rinfo.address}`);
      });
      udp.on("error", (e) => onLog("relay udp: " + e.message));
      udp.bind(discoveryPort);
      return {
        stop() {
          try {
            server.close();
          } catch {
          }
          try {
            udp.close();
          } catch {
          }
        },
        status: () => ({ addresses: lanAddresses().map((i) => `http://${i.address}:${httpPort}`), requests })
      };
    }
    module2.exports = { start: start2, lanAddresses, bestAddress };
  }
});

// src/core/pad.js
var require_pad = __commonJS({
  "src/core/pad.js"(exports2, module2) {
    "use strict";
    var dgram = require("node:dgram");
    var clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    var CPAD_BOUND = 1488;
    var CPP_BOUND = 127;
    function buildPacket(s) {
      let hid = 4095;
      for (let i = 0; i < 12; i++) if (s.b & 1 << i) hid &= ~(1 << i);
      let touch = 33554432;
      if (s.t) {
        const x = clamp(Math.floor(4095 * clamp(s.t[0], 0, 1)), 0, 4095);
        const y = clamp(Math.floor(4095 * clamp(s.t[1], 0, 1)), 0, 4095);
        touch = (1 << 24 | y << 12 | x) >>> 0;
      }
      let circle = 8386559;
      if (s.cx || s.cy) {
        const x = clamp(Math.floor(s.cx * CPAD_BOUND + 2048), 0, 4095);
        const y = clamp(Math.floor(s.cy * CPAD_BOUND + 2048), 0, 4095);
        circle = (y << 12 | x) >>> 0;
      }
      let cstick = 2155872385;
      const zl = (s.b & 1 << 14) !== 0, zr = (s.b & 1 << 15) !== 0;
      if (s.sx || s.sy || zl || zr) {
        const rx = s.sx, ry = s.sy;
        const x = clamp(Math.floor(Math.SQRT1_2 * (rx + ry) * CPP_BOUND + 128), 0, 255);
        const y = clamp(Math.floor(Math.SQRT1_2 * (ry - rx) * CPP_BOUND + 128), 0, 255);
        const ir = (zr ? 1 << 1 : 0) | (zl ? 1 << 2 : 0);
        cstick = (y << 24 | x << 16 | ir << 8 | 129) >>> 0;
      }
      const buf = Buffer.alloc(20);
      buf.writeUInt32LE(hid >>> 0, 0);
      buf.writeUInt32LE(touch, 4);
      buf.writeUInt32LE(circle, 8);
      buf.writeUInt32LE(cstick, 12);
      buf.writeUInt32LE(s.home ? 1 : 0, 16);
      return buf;
    }
    var neutral = (s) => !s.b && !s.cx && !s.cy && !s.sx && !s.sy && !s.t && !s.home;
    var PadSender = class {
      constructor() {
        this.sock = dgram.createSocket("udp4");
        this.sock.on("error", (e) => {
          this.lastError = e.message;
        });
        this.state = null;
        this.timer = null;
        this.target = null;
        this.idleSince = 0;
        this.lastUpdate = 0;
        this.sent = 0;
        this.lastError = "";
      }
      update(ip, port, state) {
        this.target = { ip, port: Number(port) || 4950 };
        this.state = state;
        this.lastUpdate = Date.now();
        this.idleSince = neutral(state) ? this.idleSince || Date.now() : 0;
        if (!this.timer) this.timer = setInterval(() => this.tick(), 1e3 / 60);
        this.tick();
      }
      tick() {
        if (!this.state || !this.target) return;
        if (!neutral(this.state) && Date.now() - this.lastUpdate > 2e3) {
          this.state = { b: 0, cx: 0, cy: 0, sx: 0, sy: 0, t: null };
          this.idleSince = Date.now();
        }
        this.sock.send(buildPacket(this.state), this.target.port, this.target.ip, (err) => {
          if (err) this.lastError = err.message;
          else this.lastError = "";
        });
        this.sent++;
        if (this.idleSince && Date.now() - this.idleSince > 300) this.stop();
      }
      stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
      }
      close() {
        this.stop();
        try {
          this.sock.close();
        } catch {
        }
      }
    };
    module2.exports = { buildPacket, PadSender };
  }
});

// src/core/ntr.js
var require_ntr = __commonJS({
  "src/core/ntr.js"(exports2, module2) {
    "use strict";
    var dgram = require("node:dgram");
    var net = require("node:net");
    function initPacket({ quality = 80, topPriority = true, priority = 3, qos = 16 } = {}) {
      const b = Buffer.alloc(84);
      b.writeUInt32LE(305419896, 0);
      b.writeUInt32LE(3e3, 4);
      b.writeUInt32LE(0, 8);
      b.writeUInt32LE(901, 12);
      b.writeUInt32LE(((topPriority ? 1 : 0) << 8 | priority % 256) >>> 0, 16);
      b.writeUInt32LE(quality >>> 0, 20);
      b.writeUInt32LE(qos * 2 << 16 >>> 0, 24);
      return b;
    }
    var FrameAssembler = class {
      constructor(onFrame) {
        this.onFrame = onFrame;
        this.state = { top: null, bottom: null };
      }
      push(data) {
        if (data.length < 5) return;
        const frame = data[0], screen = (data[1] & 15) === 1 ? "top" : "bottom", last = (data[1] & 240) >> 4 === 1, pn = data[3];
        let st = this.state[screen];
        if (pn === 0) st = this.state[screen] = { frame, next: 0, chunks: [] };
        if (!st || st.frame !== frame || st.next !== pn) {
          this.state[screen] = null;
          return;
        }
        st.chunks.push(data.subarray(4));
        st.next++;
        if (last) {
          this.state[screen] = null;
          this.onFrame(screen, Buffer.concat(st.chunks));
        }
      }
    };
    var NtrReceiver = class {
      constructor({ port = 8001, onFrame, onLog = () => {
      } }) {
        this.port = port;
        this.onFrame = onFrame;
        this.onLog = onLog;
        this.frames = 0;
        this.lastFrameAt = 0;
        this.asm = new FrameAssembler((screen, jpeg) => {
          this.frames++;
          this.lastFrameAt = Date.now();
          this.onFrame(screen, jpeg);
        });
        this.sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
        this.sock.on("message", (m) => this.asm.push(m));
        this.sock.on("error", (e) => this.onLog("ntr udp: " + e.message));
        this.sock.bind(port);
      }
      stop() {
        try {
          this.sock.close();
        } catch {
        }
      }
    };
    function startRemotePlay(ip, opts, timeoutMs = 4e3) {
      return new Promise((resolve) => {
        const s = net.connect({ host: ip, port: 8e3, timeout: timeoutMs });
        let done = false;
        const end = (ok) => {
          if (done) return;
          done = true;
          try {
            s.destroy();
          } catch {
          }
          resolve(ok);
        };
        s.on("connect", () => {
          s.write(initPacket(opts));
          setTimeout(() => end(true), 1500);
        });
        s.on("timeout", () => end(false));
        s.on("error", () => end(false));
      });
    }
    module2.exports = { initPacket, FrameAssembler, NtrReceiver, startRemotePlay };
  }
});

// src/core/power.js
var require_power = __commonJS({
  "src/core/power.js"(exports2, module2) {
    "use strict";
    var { execFile } = require("node:child_process");
    var ACTIONS = ["lock", "sleep", "restart", "shutdown"];
    function powerCommand(platform, action) {
      if (!ACTIONS.includes(action)) throw new Error("Acci\xF3n no v\xE1lida");
      if (platform === "win32") {
        return {
          lock: ["rundll32.exe", ["user32.dll,LockWorkStation"]],
          sleep: ["rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"]],
          restart: ["shutdown", ["/r", "/t", "10"]],
          shutdown: ["shutdown", ["/s", "/t", "10"]]
        }[action];
      }
      if (platform === "darwin") {
        return {
          lock: ["pmset", ["displaysleepnow"]],
          sleep: ["pmset", ["sleepnow"]],
          restart: ["osascript", ["-e", 'tell application "System Events" to restart']],
          shutdown: ["osascript", ["-e", 'tell application "System Events" to shut down']]
        }[action];
      }
      return {
        lock: ["loginctl", ["lock-session"]],
        sleep: ["systemctl", ["suspend"]],
        restart: ["systemctl", ["reboot"]],
        shutdown: ["systemctl", ["poweroff"]]
      }[action];
    }
    function runPower(action, platform = process.platform) {
      const [cmd, args] = powerCommand(platform, action);
      return new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true }, (err) => err ? reject(new Error("No se pudo ejecutar: " + err.message)) : resolve()));
    }
    module2.exports = { powerCommand, runPower, ACTIONS };
  }
});

// src/core/index.js
module.exports = function start(ctx) {
  const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, session, desktopCapturer, shell, screen, nativeImage, Notification } = ctx.electron;
  const path = require("node:path");
  const fs = require("node:fs");
  const os = require("node:os");
  const crypto = require("node:crypto");
  const roots = require_fsroots();
  const input = require_input();
  const relay = require_relay();
  const { PadSender } = require_pad();
  const ntr = require_ntr();
  const power = require_power();
  const DEFAULT_WEB_URL = process.env.FORJA_URL || "https://forja-hub.netlify.app";
  const startHidden = process.argv.includes("--hidden");
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
  }
  const settingsFile = () => path.join(app.getPath("userData"), "forja-desktop.json");
  let settings = { webUrl: DEFAULT_WEB_URL, roots: [], fullAccess: true, allowInput: true, allowScreen: true, shareCamera: false, shareMic: false, allowPower: false, screenQuality: "fluid", deviceId: "", relay: true, autostart: false, hostId: "" };
  function loadSettings() {
    let first = false;
    try {
      settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) };
    } catch {
      first = true;
    }
    if (!settings.hostId) {
      settings.hostId = crypto.randomUUID();
      saveSettings();
    }
    if (first) {
      settings.autostart = true;
      saveSettings();
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
    }
  }
  function saveSettings() {
    try {
      fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
      fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
    } catch (e) {
      console.warn("ajustes:", e.message);
    }
  }
  const getRoots = () => settings.fullAccess ? roots.systemRoots() : roots.parseRoots(settings.roots);
  const fsApi = roots.api(getRoots);
  let win = null, tray = null, quitting = false, padSender = null, relayHandle = null, relayError = "";
  const iconPath = path.join(ctx.shellDir, "icon.png");
  function preloadPath() {
    const shellCopy = path.join(ctx.shellDir, "preload.js");
    try {
      const src = true ? "'use strict'\nconst { contextBridge, ipcRenderer } = require('electron')\nconst inv = (n, ...a) => ipcRenderer.invoke('forja:' + n, ...a)\n\ncontextBridge.exposeInMainWorld('forjaDesktop', {\n  isDesktop: true,\n  info: () => inv('info'),\n  getSettings: () => inv('settings:get'),\n  setSettings: patch => inv('settings:set', patch),\n  pickRoot: () => inv('roots:pick'),\n  removeRoot: p => inv('roots:remove', p),\n  fs: {\n    list: p => inv('fs:list', p),\n    size: p => inv('fs:size', p),\n    read: (p, offset, length) => inv('fs:read', p, offset, length),\n    write: (p, data, append) => inv('fs:write', p, data, append),\n    mkdir: p => inv('fs:mkdir', p),\n    rename: (a, b) => inv('fs:rename', a, b),\n    remove: p => inv('fs:remove', p),\n  },\n  relayStatus: () => inv('relay:status'),\n  openFirewall: () => inv('fw:allow'),\n  padStatus: () => inv('pad:status'),\n  power: action => inv('power:do', action),\n  ntrStart: (ip, opts) => inv('ntr:start', ip, opts),\n  ntrStatus: () => inv('ntr:status'),\n  ntrStop: () => inv('ntr:stop'),\n  onNtrFrame: cb => { const f = (_e, screen, data) => cb(screen, data); ipcRenderer.on('forja:ntr-frame', f); return () => ipcRenderer.removeListener('forja:ntr-frame', f) },\n  checkUpdate: () => inv('update:check'),\n  applyUpdate: () => inv('update:apply'),\n  inputMouse: m => ipcRenderer.send('forja:input:mouse', m),\n  inputKey: m => ipcRenderer.send('forja:input:key', m),\n  padSend: (ip, port, state) => ipcRenderer.send('forja:pad', ip, port, state),\n})\n" : fs.readFileSync(shellCopy, "utf8");
      const file = path.join(app.getPath("userData"), "forja-preload.js");
      let cur = "";
      try {
        cur = fs.readFileSync(file, "utf8");
      } catch {
      }
      if (cur !== src) fs.writeFileSync(file, src);
      return file;
    } catch {
      return shellCopy;
    }
  }
  function createWindow() {
    win = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 420,
      minHeight: 600,
      show: !startHidden,
      backgroundColor: "#0f1115",
      title: "Forja",
      icon: iconPath,
      autoHideMenuBar: true,
      webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
    });
    win.removeMenu();
    win.loadURL(settings.webUrl).catch(() => {
    });
    const origin = new URL(settings.webUrl).origin;
    const external = (url) => {
      try {
        return new URL(url).origin !== origin;
      } catch {
        return true;
      }
    };
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (external(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, url) => {
      if (external(url)) {
        e.preventDefault();
        void shell.openExternal(url);
      }
    });
    win.webContents.on("did-fail-load", (_e, code, desc, url, isMain) => {
      if (!isMain || code === -3) return;
      win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
        `<body style="background:#0f1115;color:#e8eaf0;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:420px"><h2>No se pudo abrir Forja</h2><p style="color:#8b93a5">${desc}. Comprueba tu conexi\xF3n a internet.</p><button onclick="location.href='${settings.webUrl}'" style="padding:10px 18px;border-radius:9px;border:0;background:#ff7a2f;font-weight:700">Reintentar</button></div></body>`
      ));
    });
    win.on("close", (e) => {
      if (!quitting) {
        e.preventDefault();
        win.hide();
      }
    });
  }
  function showWindow() {
    if (!win) createWindow();
    win.show();
    win.focus();
  }
  function rebuildTray() {
    if (!tray) return;
    const items = [{ label: "Abrir Forja", click: showWindow }];
    if (pendingUpdate) items.push({ label: `Reiniciar para actualizar a v${pendingUpdate}`, click: () => {
      quitting = true;
      app.relaunch();
      app.exit(0);
    } });
    items.push({ type: "separator" }, { label: "Salir (el PC dejar\xE1 de estar disponible)", click: () => {
      quitting = true;
      app.quit();
    } });
    tray.setContextMenu(Menu.buildFromTemplate(items));
  }
  function createTray() {
    let img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 });
    tray = new Tray(img);
    tray.setToolTip("Forja \u2014 este PC est\xE1 disponible");
    rebuildTray();
    tray.on("click", showWindow);
  }
  async function applyRelay() {
    if (relayHandle) {
      relayHandle.stop();
      relayHandle = null;
    }
    relayError = "";
    if (!settings.relay) return;
    try {
      const cfg = await (await fetch(new URL("/forja-config.json", settings.webUrl))).json();
      relayHandle = relay.start({ supabaseUrl: cfg.url, anon: cfg.anon, onLog: (m) => {
        console.log(m);
        if (/relay (http|udp):/.test(m)) relayError = m;
      } });
    } catch (e) {
      relayError = "No se pudo arrancar el puente local: " + e.message;
      console.warn(relayError);
    }
  }
  const handle = (name, fn) => ipcMain.handle("forja:" + name, async (_e, ...a) => fn(...a));
  const safeSettings = () => ({ ...settings });
  handle("info", () => ({
    hostname: os.hostname(),
    platform: process.platform,
    version: ctx.version,
    shellVersion: app.getVersion(),
    hostId: settings.hostId,
    input: input.available(),
    lan: relay.lanAddresses().map((i) => i.address)
  }));
  handle("settings:get", () => safeSettings());
  handle("settings:set", async (patch) => {
    for (const k of ["fullAccess", "allowInput", "allowScreen", "shareCamera", "shareMic", "allowPower", "relay", "autostart"]) if (k in patch) settings[k] = !!patch[k];
    if (typeof patch.deviceId === "string") settings.deviceId = patch.deviceId;
    if (patch.screenQuality === "fluid" || patch.screenQuality === "native") settings.screenQuality = patch.screenQuality;
    saveSettings();
    if ("autostart" in patch) app.setLoginItemSettings({ openAtLogin: settings.autostart, args: ["--hidden"] });
    if ("relay" in patch) await applyRelay();
    return safeSettings();
  });
  handle("roots:pick", async () => {
    const r = await dialog.showOpenDialog(win, { title: "Carpeta que quieres compartir con Forja", properties: ["openDirectory"] });
    if (!r.canceled && r.filePaths[0] && !settings.roots.includes(r.filePaths[0])) {
      settings.roots.push(r.filePaths[0]);
      saveSettings();
    }
    return safeSettings();
  });
  handle("roots:remove", (p) => {
    settings.roots = settings.roots.filter((x) => x !== p);
    saveSettings();
    return safeSettings();
  });
  handle("roots:list", () => getRoots().map((r) => r.alias));
  handle("fs:list", (p) => fsApi.list(p));
  handle("fs:size", (p) => fsApi.size(p));
  handle("fs:read", async (p, offset, length) => new Uint8Array(await fsApi.read(p, offset, length)));
  handle("fs:write", (p, data, append) => fsApi.write(p, data, append));
  handle("fs:mkdir", (p) => fsApi.mkdir(p));
  handle("fs:rename", (a, b) => fsApi.rename(a, b));
  handle("fs:remove", (p) => fsApi.remove(p));
  handle("relay:status", () => relayHandle ? { on: true, ...relayHandle.status() } : { on: false, addresses: [], requests: 0, error: relayError });
  handle("fw:allow", () => new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(false);
    const cmd = path.join(os.tmpdir(), "forja-firewall.cmd");
    fs.writeFileSync(cmd, [
      "@echo off",
      'netsh advfirewall firewall delete rule name="Forja puente 3DS (TCP)" >nul 2>&1',
      'netsh advfirewall firewall delete rule name="Forja puente 3DS (UDP)" >nul 2>&1',
      'netsh advfirewall firewall add rule name="Forja puente 3DS (TCP)" dir=in action=allow protocol=TCP localport=8765 profile=any',
      'netsh advfirewall firewall add rule name="Forja puente 3DS (UDP)" dir=in action=allow protocol=UDP localport=8766 profile=any',
      ""
    ].join("\r\n"));
    require("node:child_process").execFile("powershell", ["-NoProfile", "-Command", `Start-Process -FilePath '${cmd}' -Verb RunAs -Wait`], (err) => resolve(!err));
  }));
  const bounds = () => {
    const d = screen.getPrimaryDisplay();
    const sf = process.platform === "darwin" ? 1 : d.scaleFactor;
    return { x: d.bounds.x * sf, y: d.bounds.y * sf, width: d.bounds.width * sf, height: d.bounds.height * sf };
  };
  ipcMain.on("forja:input:mouse", (_e, m) => {
    if (settings.allowInput) void input.mouse(m, bounds());
  });
  ipcMain.on("forja:input:key", (_e, m) => {
    if (settings.allowInput) void input.key(m);
  });
  ipcMain.on("forja:pad", (_e, ip, port, state) => {
    if (!padSender) padSender = new PadSender();
    padSender.update(String(ip), port, state);
  });
  handle("pad:status", () => ({ sent: padSender ? padSender.sent : 0, error: padSender ? padSender.lastError : "" }));
  handle("power:do", async (action) => {
    if (!settings.allowPower) throw new Error("Desactivado en este PC (Forja de escritorio \u2192 Este equipo \u2192 Permitir bloquear/suspender/apagar)");
    await power.runPower(action);
  });
  let ntrRx = null;
  handle("ntr:start", async (ip, opts) => {
    if (!ntrRx) ntrRx = new ntr.NtrReceiver({ onFrame: (screen2, jpeg) => {
      if (win && !win.isDestroyed()) win.webContents.send("forja:ntr-frame", screen2, new Uint8Array(jpeg));
    }, onLog: (m) => console.log(m) });
    const accepted = await ntr.startRemotePlay(String(ip), opts || {});
    return { accepted, frames: ntrRx.frames };
  });
  handle("ntr:status", () => ({ on: !!ntrRx, frames: ntrRx ? ntrRx.frames : 0, lastFrameAgoMs: ntrRx && ntrRx.lastFrameAt ? Date.now() - ntrRx.lastFrameAt : null }));
  handle("ntr:stop", () => {
    if (ntrRx) {
      ntrRx.stop();
      ntrRx = null;
    }
  });
  const semverGt = (a, b) => {
    const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };
  let pendingUpdate = "";
  async function checkUpdate(manual) {
    try {
      const base = settings.webUrl.replace(/\/$/, "");
      const info = await (await fetch(base + "/downloads/latest.json", { cache: "no-store" })).json();
      const d = info.desktop;
      if (!d || !d.version || !d.sha256) return { ok: true, current: ctx.version };
      if (!semverGt(d.version, ctx.version) || pendingUpdate === d.version) return { ok: true, current: ctx.version, latest: d.version };
      const res = await fetch(base + "/downloads/desktop-core.js", { cache: "no-store" });
      const buf = Buffer.from(await res.arrayBuffer());
      const sum = crypto.createHash("sha256").update(buf).digest("hex");
      if (!res.ok || sum !== d.sha256) throw new Error("La actualizaci\xF3n descargada no coincide con su firma (sha256)");
      const dir = path.join(app.getPath("userData"), "core");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "core.js"), buf);
      fs.writeFileSync(path.join(dir, "core.json"), JSON.stringify({ version: d.version, sha256: sum }));
      pendingUpdate = d.version;
      rebuildTray();
      try {
        new Notification({ title: "Forja se ha actualizado", body: `Versi\xF3n ${d.version} lista. Se aplicar\xE1 al reiniciar Forja.` }).show();
      } catch {
      }
      if (!manual && win && !win.isVisible()) setTimeout(() => {
        if (!win.isVisible()) {
          quitting = true;
          app.relaunch();
          app.exit(0);
        }
      }, 15e3);
      return { ok: true, current: ctx.version, latest: d.version, downloaded: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  handle("update:check", () => checkUpdate(true));
  handle("update:apply", () => {
    quitting = true;
    app.relaunch();
    app.exit(0);
  });
  app.on("second-instance", showWindow);
  app.whenReady().then(async () => {
    loadSettings();
    const origin = new URL(settings.webUrl).origin;
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, cb) => {
      const ok = ["media", "display-capture", "fullscreen", "clipboard-sanitized-write", "notifications"].includes(permission);
      cb(ok && wc.getURL().startsWith(origin));
    });
    ses.setDisplayMediaRequestHandler(async (_req, cb) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        cb(process.platform === "win32" ? { video: sources[0], audio: "loopback" } : { video: sources[0] });
      } catch {
        cb({});
      }
    });
    createTray();
    createWindow();
    await applyRelay();
    setTimeout(() => void checkUpdate(false), 2e4);
    setInterval(() => void checkUpdate(false), 6 * 3600 * 1e3);
  });
  app.on("before-quit", () => {
    quitting = true;
    if (relayHandle) relayHandle.stop();
    if (padSender) padSender.close();
    if (ntrRx) ntrRx.stop();
  });
  app.on("window-all-closed", () => {
  });
};
