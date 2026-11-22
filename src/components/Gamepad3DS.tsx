import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { bit, BTN, KEYMAP, mergePad, NEUTRAL, readGamepad, STICK_KEYS, type BtnName, type PadState } from '../lib/pad'
import { cn } from '../lib/util'
import ScreenKeyboard3DS from './ScreenKeyboard3DS'

/**
 * Mando virtual de la 3DS: botones táctiles (multitoque), Circle Pad, C-Stick,
 * pantalla táctil, teclado y mando físico. Emite el estado fusionado.
 */
export default function Gamepad3DS({ onChange, keyboard = true }: { onChange: (s: PadState) => void; keyboard?: boolean }) {
  const screen = useRef<PadState>({ ...NEUTRAL })
  const keys = useRef<PadState>({ ...NEUTRAL })
  const pad = useRef<PadState>({ ...NEUTRAL })
  const last = useRef('')
  const [pressed, setPressed] = useState(0)

  const emit = useCallback(() => {
    const m = mergePad(screen.current, keys.current, pad.current)
    const sig = JSON.stringify(m)
    if (sig === last.current) return
    last.current = sig
    setPressed(m.b)
    onChange(m)
  }, [onChange])

  const setBtn = useCallback((n: BtnName, on: boolean) => {
    screen.current = { ...screen.current, b: on ? screen.current.b | bit(n) : screen.current.b & ~bit(n) }
    emit()
  }, [emit])

  // Teclado
  useEffect(() => {
    if (!keyboard) return
    const held = new Set<string>()
    const recompute = () => {
      let b = 0, cx = 0, cy = 0
      for (const code of held) { const n = KEYMAP[code]; if (n) b |= bit(n) }
      if (held.has(STICK_KEYS.left)) cx -= 1
      if (held.has(STICK_KEYS.right)) cx += 1
      if (held.has(STICK_KEYS.up)) cy += 1
      if (held.has(STICK_KEYS.down)) cy -= 1
      keys.current = { ...NEUTRAL, b, cx, cy }
      emit()
    }
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || (!KEYMAP[e.code] && !Object.values(STICK_KEYS).includes(e.code))) return
      e.preventDefault(); held.add(e.code); recompute()
    }
    const up = (e: KeyboardEvent) => { if (held.delete(e.code)) recompute() }
    const blur = () => { held.clear(); recompute() }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); keys.current = { ...NEUTRAL }; emit() }
  }, [keyboard, emit])

  // Mando físico
  useEffect(() => {
    let raf = 0
    const tick = () => { pad.current = readGamepad(); emit(); raf = requestAnimationFrame(tick) }
    const start = () => { if (!raf) raf = requestAnimationFrame(tick) }
    window.addEventListener('gamepadconnected', start)
    if (Array.from(navigator.getGamepads?.() ?? []).some(Boolean)) start()
    return () => { window.removeEventListener('gamepadconnected', start); cancelAnimationFrame(raf) }
  }, [emit])

  const Btn = ({ n, label, cls }: { n: BtnName; label: string; cls?: string }) => (
    <button type="button" className={cn('pad-btn', cls, (pressed & bit(n)) !== 0 && 'on')}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setBtn(n, true); try { navigator.vibrate?.(8) } catch { /* noop */ } }}
      onPointerUp={() => setBtn(n, false)} onPointerCancel={() => setBtn(n, false)}
      onContextMenu={e => e.preventDefault()}>{label}</button>
  )

  return (
    <div className="gamepad" onContextMenu={e => e.preventDefault()}>
      <div className="pad-shoulders">
        <Btn n="L" label="L" cls="shoulder" /><Btn n="ZL" label="ZL" cls="shoulder sm" />
        <div className="spacer" />
        <Btn n="ZR" label="ZR" cls="shoulder sm" /><Btn n="R" label="R" cls="shoulder" />
      </div>
      <div className="pad-main">
        <div className="pad-left">
          <Stick label="Circle Pad" onMove={(x, y) => { screen.current = { ...screen.current, cx: x, cy: y }; emit() }} />
          <div className="dpad">
            <Btn n="UP" label="▲" cls="up" /><Btn n="LEFT" label="◀" cls="left" /><Btn n="RIGHT" label="▶" cls="right" /><Btn n="DOWN" label="▼" cls="down" />
          </div>
        </div>
        <div className="pad-center">
          <TouchScreen onTouch={t => { screen.current = { ...screen.current, t }; emit() }} />
          <div className="pad-sys">
            <Btn n="SELECT" label="SELECT" cls="pill" /><Btn n="START" label="START" cls="pill" />
            <button type="button" className="pad-btn pill" onPointerDown={() => { screen.current = { ...screen.current, home: true }; emit() }}
              onPointerUp={() => { screen.current = { ...screen.current, home: false }; emit() }}
              onPointerCancel={() => { screen.current = { ...screen.current, home: false }; emit() }}>HOME</button>
          </div>
        </div>
        <div className="pad-right">
          <div className="abxy">
            <Btn n="X" label="X" cls="x" /><Btn n="Y" label="Y" cls="y" /><Btn n="A" label="A" cls="a" /><Btn n="B" label="B" cls="b" />
          </div>
          <Stick label="C-Stick" small onMove={(x, y) => { screen.current = { ...screen.current, sx: x, sy: y }; emit() }} />
        </div>
      </div>
      <ScreenKeyboard3DS onTouch={t => { screen.current = { ...screen.current, t }; emit() }} />
      {keyboard && <p className="muted small pad-hint">
        Teclado: flechas = cruceta · X A / Z B / S X / A Y · Q L / W R · Enter Start · Retroceso Select · IJKL = Circle Pad. También funciona un mando USB/Bluetooth.
      </p>}
    </div>
  )
}

function Stick({ label, onMove, small }: { label: string; onMove: (x: number, y: number) => void; small?: boolean }) {
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const active = useRef<number | null>(null)

  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect()
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
    let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
    const m = Math.hypot(x, y)
    if (m > 1) { x /= m; y /= m }
    setKnob({ x, y }); onMove(x, -y)
  }
  const end = () => { active.current = null; setKnob({ x: 0, y: 0 }); onMove(0, 0) }

  return (
    <div className={cn('stick', small && 'small')} ref={base}
      onPointerDown={e => { active.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); update(e) }}
      onPointerMove={e => { if (active.current === e.pointerId) update(e) }}
      onPointerUp={end} onPointerCancel={end}>
      <div className="knob" style={{ transform: `translate(${knob.x * 38}%, ${knob.y * 38}%)` }} />
      <span className="stick-label">{label}</span>
    </div>
  )
}

function TouchScreen({ onTouch }: { onTouch: (t: [number, number] | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const down = useRef(false)
  const [pt, setPt] = useState<[number, number] | null>(null)
  const pos = useMemo(() => (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }, [])
  const end = () => { down.current = false; setPt(null); onTouch(null) }
  return (
    <div className="touchscreen" ref={ref}
      onPointerDown={e => { down.current = true; e.currentTarget.setPointerCapture(e.pointerId); const p = pos(e); setPt(p); onTouch(p) }}
      onPointerMove={e => { if (down.current) { const p = pos(e); setPt(p); onTouch(p) } }}
      onPointerUp={end} onPointerCancel={end}>
      <span className="muted small">Pantalla táctil</span>
      {pt && <i className="touch-dot" style={{ left: `${pt[0] * 100}%`, top: `${pt[1] * 100}%` }} />}
    </div>
  )
}

export { BTN }
