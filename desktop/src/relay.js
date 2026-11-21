'use strict'
// Puente local para la 3DS: si la consola no logra hacer TLS con internet, habla en HTTP plano con este PC
// (misma WiFi) y este PC reenvía a Supabase. Incluye descubrimiento por UDP (puerto 8766).
const http = require('node:http')
const https = require('node:https')
const dgram = require('node:dgram')
const os = require('node:os')

function lanAddresses() {
  const out = []
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i)
  return out
}
const toInt = ip => ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0
function bestAddress(remote) {
  const all = lanAddresses()
  if (remote) {
    const r = toInt(remote)
    const hit = all.find(i => (toInt(i.address) & toInt(i.netmask)) === (r & toInt(i.netmask)))
    if (hit) return hit.address
  }
  return all[0] ? all[0].address : '127.0.0.1'
}

function start({ supabaseUrl, anon, httpPort = 8765, discoveryPort = 8766, onLog = () => {} }) {
  const target = new URL(supabaseUrl)
  let requests = 0

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/forja-config.json') {
      const host = req.headers.host || `${bestAddress(req.socket.remoteAddress)}:${httpPort}`
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ url: `http://${host}`, anon }))
      return
    }
    if (!/^\/(auth|rest|storage|functions)\//.test(u.pathname)) { res.writeHead(404); res.end(); return }
    requests++
    const headers = { ...req.headers, host: target.host }
    delete headers['accept-encoding']
    const up = https.request({ host: target.hostname, port: 443, path: req.url, method: req.method, headers }, r => {
      res.writeHead(r.statusCode || 502, r.headers)
      r.pipe(res)
    })
    up.on('error', e => { onLog('relay: ' + e.message); if (!res.headersSent) res.writeHead(502); res.end() })
    req.pipe(up)
  })
  server.on('error', e => onLog('relay http: ' + e.message))
  server.listen(httpPort, '0.0.0.0')

  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  udp.on('message', (msg, rinfo) => {
    if (String(msg).trim() !== 'FORJA?') return
    const reply = Buffer.from(`FORJA http://${bestAddress(rinfo.address)}:${httpPort}`)
    udp.send(reply, rinfo.port, rinfo.address)
    onLog(`relay: descubierta por ${rinfo.address}`)
  })
  udp.on('error', e => onLog('relay udp: ' + e.message))
  udp.bind(discoveryPort)

  return {
    stop() { try { server.close() } catch { /* noop */ } try { udp.close() } catch { /* noop */ } },
    status: () => ({ addresses: lanAddresses().map(i => `http://${i.address}:${httpPort}`), requests }),
  }
}

module.exports = { start, lanAddresses, bestAddress }
