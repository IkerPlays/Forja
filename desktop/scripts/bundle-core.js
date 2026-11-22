'use strict'
// Empaqueta el núcleo en UN archivo (desktop-core.js) que la web sirve para la autoactualización.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const esbuild = require('esbuild')

const out = path.join(__dirname, '..', 'dist-core')
fs.mkdirSync(out, { recursive: true })
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'core', 'index.js')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  define: { __PRELOAD__: JSON.stringify(fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8')) },
  external: ['electron', '@nut-tree-fork/nut-js'], outfile: path.join(out, 'desktop-core.js'), logLevel: 'error',
})
const buf = fs.readFileSync(path.join(out, 'desktop-core.js'))
const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
fs.writeFileSync(path.join(out, 'desktop-core.sha256'), sha256 + '\n')
console.log('desktop-core.js', buf.length, 'bytes sha256', sha256)
