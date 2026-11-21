'use strict'
// Carga de un núcleo descargado: se verifica el sha256 y se ejecuta con el `require` de la app instalada
// (así encuentra electron y los módulos nativos). Si algo falla devuelve null y se usa el núcleo incluido.
function semverGt(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

function loadDownloadedCore(file, sha256, { require: req, dirname, crypto, fs }) {
  const code = fs.readFileSync(file)
  if (crypto.createHash('sha256').update(code).digest('hex') !== sha256) return null
  const m = { exports: {} }
  new Function('require', 'module', 'exports', '__dirname', '__filename', code.toString('utf8'))(req, m, m.exports, dirname, file)
  const fn = typeof m.exports === 'function' ? m.exports : m.exports && m.exports.default
  return typeof fn === 'function' ? fn : null
}

module.exports = { semverGt, loadDownloadedCore }
