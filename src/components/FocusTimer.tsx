import { useEffect, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'

const KEY = 'forja.focus'
type St = { mode: 'work' | 'rest'; end: number | null; left: number }
const LEN = { work: 25 * 60_000, rest: 5 * 60_000 }
const load = (): St => { try { const v = JSON.parse(localStorage.getItem(KEY) || ''); if (v && v.mode) return v } catch { /* noop */ } return { mode: 'work', end: null, left: LEN.work } }

/** Temporizador de enfoque (25/5). Guarda su estado por si recargas la página. */
export default function FocusTimer() {
  const [st, setSt] = useState<St>(load)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(st)) } catch { /* noop */ } }, [st])
  useEffect(() => { if (!st.end) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t) }, [st.end])
  const left = st.end ? Math.max(0, st.end - now) : st.left
  useEffect(() => {
    if (!st.end || left > 0) return
    const next = st.mode === 'work' ? 'rest' : 'work'
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(st.mode === 'work' ? 'Descanso' : 'A trabajar', { body: st.mode === 'work' ? '¡25 min hechos!' : 'Se acabó el descanso' }) } catch { /* noop */ }
    setSt({ mode: next, end: null, left: LEN[next] })
  }, [st, left])
  const mm = String(Math.floor(left / 60_000)).padStart(2, '0'), ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')
  return (
    <section className="panel focus">
      <h2>Enfoque · {st.mode === 'work' ? 'trabajo' : 'descanso'}</h2>
      <div className="focus-time" aria-live="off">{mm}:{ss}</div>
      <div className="row" style={{ gap: 8 }}>
        {st.end
          ? <button className="btn sm" onClick={() => setSt({ ...st, end: null, left })}><Pause size={14} /> Pausa</button>
          : <button className="btn primary sm" onClick={() => { setNow(Date.now()); setSt({ ...st, end: Date.now() + st.left }) }}><Play size={14} /> Empezar</button>}
        <button className="btn sm" onClick={() => setSt({ mode: 'work', end: null, left: LEN.work })}><RotateCcw size={14} /> Reiniciar</button>
        <button className="btn sm" onClick={() => setSt({ mode: st.mode === 'work' ? 'rest' : 'work', end: null, left: LEN[st.mode === 'work' ? 'rest' : 'work'] })}>{st.mode === 'work' ? 'Ir a descanso' : 'Ir a trabajo'}</button>
      </div>
    </section>
  )
}
