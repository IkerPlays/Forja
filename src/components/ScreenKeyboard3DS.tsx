import { useRef, useState } from 'react'
import { Keyboard } from 'lucide-react'

/**
 * Teclado en pantalla para la 3DS: cada tecla «toca» la pantalla táctil en el punto donde el teclado de sistema de la 3DS
 * (QWERTY) tiene esa tecla. Las posiciones son aproximadas; se pueden ajustar con la calibración (se guarda en este equipo).
 */
const ROWS: { keys: string[]; y: number; x0: number }[] = [
  { keys: '1234567890'.split(''), y: 118, x0: 20 },
  { keys: 'qwertyuiop'.split(''), y: 146, x0: 20 },
  { keys: 'asdfghjkl'.split(''), y: 174, x0: 35 },
  { keys: 'zxcvbnm'.split(''), y: 202, x0: 66 },
]
const STEP = 31
type Cal = { dx: number; dy: number; s: number }
const CKEY = 'forja.kb3ds'
const loadCal = (): Cal => { try { const v = JSON.parse(localStorage.getItem(CKEY) || ''); if (v && typeof v.dx === 'number') return v } catch { /* noop */ } return { dx: 0, dy: 0, s: 1 } }

function pos(ch: string, cal: Cal): [number, number] | null {
  let x: number, y: number
  if (ch === ' ') { x = 160; y = 228 }
  else if (ch === '\b') { x = 292; y = 202 }
  else if (ch === '\n') { x = 296; y = 174 }
  else {
    const c = ch.toLowerCase(); const row = ROWS.find(r => r.keys.includes(c)); if (!row) return null
    x = row.x0 + row.keys.indexOf(c) * STEP; y = row.y
  }
  const cx = 160, cy = 170
  return [Math.min(1, Math.max(0, (cx + (x - cx) * cal.s + cal.dx) / 320)), Math.min(1, Math.max(0, (cy + (y - cy) * cal.s + cal.dy) / 240))]
}

export default function ScreenKeyboard3DS({ onTouch }: { onTouch: (t: [number, number] | null) => void }) {
  const [open, setOpen] = useState(false)
  const [cal, setCal] = useState<Cal>(loadCal)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const stop = useRef(false)
  const upd = (c: Cal) => { setCal(c); try { localStorage.setItem(CKEY, JSON.stringify(c)) } catch { /* noop */ } }

  const tap = (ch: string) => new Promise<void>(res => {
    const p = pos(ch, cal); if (!p) return res()
    onTouch(p); setTimeout(() => { onTouch(null); setTimeout(res, 70) }, 90)
  })
  const typeAll = async () => {
    stop.current = false; setBusy(true)
    for (const ch of text) { if (stop.current) break; await tap(ch) }
    setBusy(false)
  }

  if (!open) return <button type="button" className="btn sm" onClick={() => setOpen(true)}><Keyboard size={15} /> Teclado</button>
  return (
    <div className="panel stack kb3ds">
      <div className="row" style={{ gap: 8 }}>
        <strong><Keyboard size={15} /> Teclado de la 3DS</strong><div className="spacer" />
        <button type="button" className="btn sm" onClick={() => setOpen(false)}>Cerrar</button>
      </div>
      <p className="muted small">Abre un campo de texto en la 3DS (se muestra su teclado) y pulsa aquí. Si no acierta las teclas, ajusta la calibración.</p>
      <div className="kb-rows">
        {ROWS.map((r, i) => <div key={i} className="kb-row">{r.keys.map(k => <button key={k} type="button" className="kb-key" onClick={() => void tap(k)}>{k}</button>)}
          {i === 3 && <button type="button" className="kb-key wide" onClick={() => void tap('\b')}>⌫</button>}</div>)}
        <div className="kb-row"><button type="button" className="kb-key space" onClick={() => void tap(' ')}>espacio</button><button type="button" className="kb-key wide" onClick={() => void tap('\n')}>OK</button></div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Escribe aquí y envía todo de golpe…" aria-label="Texto para la 3DS"
          onKeyDown={e => { if (e.key === 'Enter' && !busy) void typeAll() }} />
        {busy ? <button type="button" className="btn sm" onClick={() => { stop.current = true }}>Parar</button> : <button type="button" className="btn primary sm" onClick={() => void typeAll()} disabled={!text}>Escribir</button>}
      </div>
      <details><summary className="small">Calibración</summary>
        <div className="stack small">
          <label>Horizontal {cal.dx}<input type="range" min={-30} max={30} value={cal.dx} onChange={e => upd({ ...cal, dx: +e.target.value })} /></label>
          <label>Vertical {cal.dy}<input type="range" min={-40} max={40} value={cal.dy} onChange={e => upd({ ...cal, dy: +e.target.value })} /></label>
          <label>Tamaño {cal.s.toFixed(2)}<input type="range" min={0.8} max={1.2} step={0.01} value={cal.s} onChange={e => upd({ ...cal, s: +e.target.value })} /></label>
          <button type="button" className="btn sm" onClick={() => upd({ dx: 0, dy: 0, s: 1 })}>Restablecer</button>
        </div>
      </details>
    </div>
  )
}
