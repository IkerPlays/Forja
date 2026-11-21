import { useEffect, useRef, useState } from 'react'
import { Cast, Maximize, MonitorUp, Video, VideoOff, MousePointer2, Keyboard, KeyboardIcon } from 'lucide-react'
import { Link, ScreenSharer, ScreenViewer } from '../lib/devices'
import { errMsg } from '../lib/util'
import { useToast } from './ui'

/**
 * Pantalla en tiempo real por WebRTC (la señalización va por Supabase Realtime).
 *  · Ver: cualquier navegador del estudio.
 *  · Compartir: el equipo que tiene la pantalla (PC) o que muestra el visor/capturadora de la 3DS.
 */
export default function ScreenView({ link, kind, remoteControl }: { link: Link; kind: 'pc' | '3ds'; remoteControl?: boolean }) {
  const toast = useToast()
  const [mode, setMode] = useState<'view' | 'share'>('view')
  const [status, setStatus] = useState('Buscando emisor…')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [viewers, setViewers] = useState(0)
  const [control, setControl] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const sharer = useRef<ScreenSharer | null>(null)
  const [sharing, setSharing] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [cam, setCam] = useState('')
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; moved: boolean; fired: boolean } | null>(null)
  const lastScrollY = useRef(0)
  const kb = useRef<HTMLInputElement>(null)
  const ime = useRef(false)

  // Espectador
  useEffect(() => {
    if (mode !== 'view') return
    const v = new ScreenViewer(link, setStream, setStatus)
    return () => { v.leave(); setStream(null) }
  }, [link, mode])

  useEffect(() => { if (video.current) video.current.srcObject = stream }, [stream])
  useEffect(() => () => sharer.current?.stop(), [])

  async function shareScreen() {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: true })
      begin(s)
    } catch (e) { toast(errMsg(e), 'err') }
  }
  async function shareCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: cam ? { deviceId: { exact: cam }, frameRate: 60, width: { ideal: 1920 } } : { frameRate: 60 }, audio: false,
      })
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'))
      begin(s)
    } catch (e) { toast(errMsg(e), 'err') }
  }
  function begin(s: MediaStream) {
    sharer.current?.stop()
    sharer.current = new ScreenSharer(link, s, setViewers)
    s.getVideoTracks()[0]?.addEventListener('ended', stopShare)
    setStream(s); setSharing(true)
    if (video.current) video.current.srcObject = s
  }
  function stopShare() {
    sharer.current?.stop(); sharer.current = null
    setSharing(false); setStream(null); setViewers(0)
  }

  async function listCams() {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true })
      tmp.getTracks().forEach(t => t.stop())
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'))
    } catch (e) { toast(errMsg(e), 'err') }
  }

  /* Control remoto del PC: ratón y teclado normalizados */
  function norm(e: React.PointerEvent | React.WheelEvent) {
    const r = video.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const send = (p: Record<string, unknown>) => { if (control && remoteControl) void link.input(p) }
  const CODES: Record<string, string> = { ' ': 'Space', '.': 'Period', ',': 'Comma', '-': 'Minus', '=': 'Equal', '/': 'Slash', ';': 'Semicolon', "'": 'Quote' }
  const typeChar = (ch: string) => {
    const code = /^[a-z]$/i.test(ch) ? 'Key' + ch.toUpperCase() : /^\d$/.test(ch) ? 'Digit' + ch : CODES[ch]
    if (!code) return
    const up = /^[A-Z]$/.test(ch)
    if (up) send({ k: 'key', a: 'down', key: 'Shift', code: 'ShiftLeft' })
    send({ k: 'key', a: 'down', key: ch, code }); send({ k: 'key', a: 'up', key: ch, code })
    if (up) send({ k: 'key', a: 'up', key: 'Shift', code: 'ShiftLeft' })
  }
  const tap = (code: string) => { send({ k: 'key', a: 'down', key: code, code }); send({ k: 'key', a: 'up', key: code, code }) }

  // Táctil: toque = clic · arrastrar = arrastrar · mantener = clic derecho · dos dedos = desplazar
  function onDown(e: React.PointerEvent<HTMLVideoElement>) {
    if (!control || !remoteControl) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size === 2) {
        if (press.current) { clearTimeout(press.current.timer); press.current = null }
        send({ k: 'mouse', a: 'up', b: 0, ...norm(e) })
        lastScrollY.current = [...touches.current.values()].reduce((a, t) => a + t.y, 0) / 2
        return
      }
      const pos = norm(e)
      const st = { moved: false, fired: false, timer: setTimeout(() => {
        if (press.current === st && !st.moved) { st.fired = true; send({ k: 'mouse', a: 'up', b: 0, ...pos }); send({ k: 'mouse', a: 'down', b: 2, ...pos }); send({ k: 'mouse', a: 'up', b: 2, ...pos }) }
      }, 550) }
      press.current = st
    }
    send({ k: 'mouse', a: 'down', b: e.button, ...norm(e) })
  }
  function onMove(e: React.PointerEvent<HTMLVideoElement>) {
    if (e.pointerType === 'touch') {
      const t = touches.current.get(e.pointerId); if (!t) return
      if (press.current && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) press.current.moved = true
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size >= 2) {
        const avg = [...touches.current.values()].reduce((a, p) => a + p.y, 0) / touches.current.size
        const dy = lastScrollY.current - avg
        if (Math.abs(dy) > 12) { send({ k: 'mouse', a: 'wheel', dy: dy * 4, ...norm(e) }); lastScrollY.current = avg }
        return
      }
    }
    send({ k: 'mouse', a: 'move', ...norm(e) })
  }
  function onUp(e: React.PointerEvent<HTMLVideoElement>) {
    if (e.pointerType === 'touch') {
      const was = touches.current.size
      touches.current.delete(e.pointerId)
      const p = press.current; if (p) { clearTimeout(p.timer); press.current = null }
      if (was >= 2 || p?.fired) return
    }
    send({ k: 'mouse', a: 'up', b: e.button, ...norm(e) })
  }
  useEffect(() => {
    if (!control || !remoteControl) return
    const kd = (e: KeyboardEvent) => {
      if (e.key === 'Unidentified' || e.keyCode === 229) { ime.current = true; return }   // teclado táctil: lo gestiona beforeinput
      ime.current = false
      e.preventDefault(); void link.input({ k: 'key', a: 'down', key: e.key, code: e.code })
    }
    const ku = (e: KeyboardEvent) => { if (e.key === 'Unidentified' || e.keyCode === 229) return; e.preventDefault(); void link.input({ k: 'key', a: 'up', key: e.key, code: e.code }) }
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
  }, [control, remoteControl, link])

  return (
    <div className="screen">
      <div className="screen-bar">
        <div className="seg sm">
          <button className={mode === 'view' ? 'on' : ''} onClick={() => { stopShare(); setMode('view') }}><Video size={14} /> Ver</button>
          <button className={mode === 'share' ? 'on' : ''} onClick={() => setMode('share')}><Cast size={14} /> Compartir desde aquí</button>
        </div>
        <div className="spacer" />
        {mode === 'view' && stream && (
          <>
            {remoteControl && <button className={`btn sm ${control ? 'primary' : ''}`} onClick={() => setControl(c => !c)}>
              <MousePointer2 size={14} /> Control {control ? 'activado' : 'desactivado'}</button>}
            {remoteControl && control && <button className="btn sm" onClick={() => kb.current?.focus()}><KeyboardIcon size={14} /> Teclado</button>}
            <button className="btn sm" onClick={() => wrap.current?.requestFullscreen?.()}><Maximize size={14} /> Pantalla completa</button>
          </>
        )}
      </div>

      {mode === 'share' && (
        <div className="callout">
          {!sharing ? (
            <>
              <p>
                {kind === 'pc'
                  ? 'Comparte la pantalla de este PC. Todos los del estudio la verán en directo desde la tablet o cualquier navegador.'
                  : 'La 3DS no emite vídeo por sí sola: abre en este equipo un visor de pantalla de 3DS (por ejemplo el de NTR/Snickerstream) o conecta una capturadora, y comparte esa ventana o ese dispositivo.'}
              </p>
              <div className="row wrap">
                <button className="btn primary" onClick={shareScreen}><MonitorUp size={16} /> Compartir pantalla o ventana</button>
                <button className="btn" onClick={shareCamera}><Video size={16} /> Usar cámara / capturadora</button>
                <select value={cam} onFocus={listCams} onChange={e => setCam(e.target.value)} aria-label="Dispositivo de vídeo">
                  <option value="">Dispositivo predeterminado</option>
                  {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}
                </select>
              </div>
            </>
          ) : (
            <div className="row wrap">
              <span><strong>Compartiendo</strong> · {viewers} {viewers === 1 ? 'espectador' : 'espectadores'}</span>
              <div className="spacer" />
              <button className="btn danger" onClick={stopShare}><VideoOff size={16} /> Dejar de compartir</button>
            </div>
          )}
        </div>
      )}

      <div className="video-wrap" ref={wrap}>
        <video ref={video} autoPlay playsInline muted={sharing} controls={false}
          className={control ? 'ctrl' : ''}
          onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp}
          onWheel={e => send({ k: 'mouse', a: 'wheel', dy: e.deltaY, ...norm(e) })}
          onContextMenu={e => { if (control) e.preventDefault() }} />
        {!stream && <div className="video-empty">{mode === 'view' ? status : 'Aún no compartes nada'}</div>}
        <input ref={kb} className="kb-capture" aria-label="Teclado remoto" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
          onBeforeInput={e => {
            const ev = e.nativeEvent as InputEvent
            e.preventDefault()
            if (!ime.current) return
            if (ev.inputType === 'deleteContentBackward') tap('Backspace')
            else if (ev.inputType === 'insertLineBreak' || ev.inputType === 'insertParagraph') tap('Enter')
            else if (ev.data) for (const ch of ev.data) typeChar(ch)
          }} />
        {control && <div className="video-flag"><Keyboard size={13} /> Teclado y ratón enviados al PC</div>}
      </div>
    </div>
  )
}
