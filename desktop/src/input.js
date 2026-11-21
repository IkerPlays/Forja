'use strict'
// Ratón y teclado del PC (nut-js, binarios precompilados). Todo es opcional: si no carga, se ignora.
let nut = null
function load() {
  if (nut !== null) return nut
  try {
    nut = require('@nut-tree-fork/nut-js')
    nut.keyboard.config.autoDelayMs = 0
    nut.mouse.config.autoDelayMs = 0
  } catch (e) { nut = false; console.warn('nut-js no disponible:', e.message) }
  return nut
}

const NAMED = {
  Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', Delete: 'Delete',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ShiftLeft: 'LeftShift', ShiftRight: 'RightShift', ControlLeft: 'LeftControl', ControlRight: 'RightControl',
  AltLeft: 'LeftAlt', AltRight: 'RightAlt', MetaLeft: 'LeftSuper', MetaRight: 'RightSuper', CapsLock: 'CapsLock', Insert: 'Insert',
  Comma: 'Comma', Period: 'Period', Minus: 'Minus', Equal: 'Equal', Slash: 'Slash', Semicolon: 'Semicolon', Quote: 'Quote',
  BracketLeft: 'LeftBracket', BracketRight: 'RightBracket', Backslash: 'Backslash', Backquote: 'Grave',
}
function keyName(code) {
  if (NAMED[code]) return NAMED[code]
  let m
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1]
  if ((m = /^Digit(\d)$/.exec(code))) return 'Num' + m[1]
  if ((m = /^Numpad(\d)$/.exec(code))) return 'NumPad' + m[1]
  if (/^F\d{1,2}$/.test(code)) return code
  return null
}

async function mouse(m, bounds) {
  const n = load(); if (!n) return
  const { mouse: ms, Point, Button } = n
  try {
    const x = Math.round(bounds.x + m.x * (bounds.width - 1)), y = Math.round(bounds.y + m.y * (bounds.height - 1))
    await ms.setPosition(new Point(x, y))
    const btn = m.b === 2 ? Button.RIGHT : m.b === 1 ? Button.MIDDLE : Button.LEFT
    if (m.a === 'down') await ms.pressButton(btn)
    else if (m.a === 'up') await ms.releaseButton(btn)
    else if (m.a === 'wheel') { const steps = Math.max(1, Math.min(10, Math.round(Math.abs(m.dy) / 40))); m.dy > 0 ? await ms.scrollDown(steps) : await ms.scrollUp(steps) }
  } catch (e) { console.warn('ratón:', e.message) }
}

async function key(m) {
  const n = load(); if (!n) return
  const name = keyName(String(m.code || ''))
  if (!name || n.Key[name] === undefined) return
  try { m.a === 'down' ? await n.keyboard.pressKey(n.Key[name]) : await n.keyboard.releaseKey(n.Key[name]) } catch (e) { console.warn('teclado:', e.message) }
}

module.exports = { mouse, key, keyName, available: () => !!load() }
