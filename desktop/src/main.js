'use strict'
// Shell mínimo de Forja para escritorio. Carga el "núcleo": el más reciente entre el incluido en el instalador
// y el que se haya descargado solo (userData/core). Así la lógica se actualiza sin reinstalar el programa.
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const Module = require('node:module')
const { semverGt, loadDownloadedCore } = require('./loader')

const shellVersion = require('../package.json').version

function pickCore() {
  try {
    const dir = path.join(app.getPath('userData'), 'core')
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'core.json'), 'utf8'))
    if (semverGt(meta.version, shellVersion)) {
      const start = loadDownloadedCore(path.join(dir, 'core.js'), meta.sha256, {
        require: Module.createRequire(path.join(app.getAppPath(), 'package.json')), dirname: __dirname, crypto, fs,
      })
      if (start) return { start, version: meta.version }
    }
  } catch { /* sin núcleo descargado o dañado: se usa el incluido */ }
  return { start: require('./core/index.js'), version: shellVersion }
}

const core = pickCore()
core.start({ electron: require('electron'), shellDir: __dirname, version: core.version })
