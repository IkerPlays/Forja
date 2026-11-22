import { useEffect, useRef, useState } from 'react'
import { Camera as CamIcon, Circle, Square, Cast, Maximize, MonitorUp, Video, VideoOff, MousePointer2, Keyboard, KeyboardIcon, Camera, Mic } from 'lucide-react'
import { Link, ScreenSharer, ScreenViewer, SCREEN_CONSTRAINTS, tuneForMotion, type Sources, type ViewerStreams } from '../lib/devices'
import { errMsg } from '../lib/util'
import { touchFromComposite } from '../lib/ntrSource'
import { useToast } from './ui'

const clamp = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Pantalla en tiempo real por WebRTC (la señalización va por Supabase Realtime).
 *  · Ver: cualquier navegador del estudio. Pantalla + cámara a la vez (como una videollamada).
 *  · Compartir: el equipo que tiene la pantalla (PC) o que muestra el visor/capturadora de la 3DS.
 */
export default function ScreenView({ link, kind, remoteControl, onTouch3ds }: { link: Link; kind: 'pc' | '3ds'; remoteControl?: boolean; onTouch3ds?: (t: [number, number] | null) => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<'view' | 'share'>('view')
  const [status, setStatus] = useState('Buscando emisor…')
  const [media, setMedia] = useState<ViewerStreams | null>(null)
  const [viewers, setViewers] = useState(0)
  const [control, setControl] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const pip = useRef<HTMLVideoElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const sharer = useRef<ScreenSharer | null>(null)
  const [sharing, setSharing] = useState(false)
  const [localPreview, setLocalPreview] = useState<Sources | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [cam, setCam] = useState('')
  const [want, setWant] = useState({ screen: true, camera: false, mic: false })
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; moved: boolean; fired: boolean } | null>(null)
  const lastScrollY = useRef(0)
  const kb = useRef<HTMLInputElement>(null)
  const ime = useRef(false)
  const [rec, setRec] = useState<MediaRecorder | null>(null)

  // Espectador
  useEffect(() => {
    if (mode !== 'view') return
    const v = new ScreenViewer(link, setMedia, setStatus)
    return () => { v.leave(); setMedia(null) }
  }, [link, mode])

  const shown: ViewerStreams | null = sharing ? localPreview : media
  const mainStream = shown?.screen ?? shown?.camera ?? null
  const pipStream = shown?.screen && shown.camera ? shown.camera : null
  useEffect(() => { if (video.current) video.current.srcObject = mainStream }, [mainStream])
  useEffect(() => { if (pip.current) pip.current.srcObject = pipStream }, [pipStream])
  useEffect(() => () => sharer.current?.stop(), [])

  async function listCams() {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true })
      tmp.getTracks().forEach(t => t.stop())
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'))
    } catch (e) { toast(errMsg(e), 'err') }
  }

  async function startShare() {
    if (!want.screen && !want.camera && !want.mic) return toast('Elige qué compartir', 'err')
    try {
      const src: Sources = {}
      if (want.screen) src.screen = await navigator.mediaDevices.getDisplayMedia(SCREEN_CONSTRAINTS(false))
      if (want.camera || want.mic) {
        src.camera = await navigator.mediaDevices.getUserMedia({
          video: want.camera ? (cam ? { deviceId: { exact: cam } } : true) : false, audio: want.mic,
        })
        if (want.camera) { try { await src.camera.getVideoTracks()[0]?.applyConstraints({ frameRate: { ideal: 60 }, width: { ideal: 1920 } }) } catch { /* noop */ } }
      }
      if (src.screen) tuneForMotion(src.screen)
      sharer.current?.stop()
      sharer.current = new ScreenSharer(link, src, setViewers)
      const end = () => stopShare()
      src.screen?.getVideoTracks()[0]?.addEventListener('ended', end)
      src.camera?.getVideoTracks()[0]?.addEventListener('ended', end)
      // Vista previa propia: sin sonido para no hacer eco
      setLocalPreview({ screen: src.screen, camera: src.camera }); setSharing(true)
    } catch (e) { toast(errMsg(e), 'err') }
  }
  function stopShare() {
    sharer.current?.stop(); sharer.current = null
    setSharing(false); setLocalPreview(null); setViewers(0)
  }

  /* Control remoto: ratón, teclado y táctil. Las coordenadas se miden sobre el VÍDEO real
     (el elemento tiene franjas negras si la proporción no coincide, y contarlas desplazaba el clic). */
  function norm(e: React.PointerEvent | React.WheelEvent) {
    const v = video.current!
    const r = v.getBoundingClientRect()
    const vw = v.videoWidth || r.width, vh = v.videoHeight || r.height
    const scale = Math.min(r.width / vw, r.height / vh)
    const cw = vw * scale, ch = vh * scale
    const ox = r.left + (r.width - cw) / 2, oy = r.top + (r.height - ch) / 2
    return { x: clamp((e.clientX - ox) / cw), y: clamp((e.clientY - oy) / ch) }
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

  // Táctil: toque = clic · arrastrar = arrastrar · mantener = clic derecho · dos dedos = desplazar
  /** 3DS: tocar la pantalla inferior del vídeo = tocar la pantalla táctil de la consola */
  function touch3ds(e: React.PointerEvent<HTMLVideoElement>, end = false) {
    if (!onTouch3ds) return false
    if (end) { onTouch3ds(null); return true }
    const n = norm(e)
    const t = touchFromComposite(n.x, n.y)
    onTouch3ds(t)
    return true
  }
  function onDown(e: React.PointerEvent<HTMLVideoElement>) {
    if (kind === '3ds' && onTouch3ds && mainStream) { e.currentTarget.setPointerCapture(e.pointerId); touch3ds(e); return }
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
    if (kind === '3ds' && onTouch3ds && mainStream) { if (e.buttons || e.pointerType === 'touch') touch3ds(e); return }
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
    if (kind === '3ds' && onTouch3ds && mainStream) { touch3ds(e, true); return }
    if (e.pointerType === 'touch') {
      const was = touches.current.size
      touches.current.delete(e.pointerId)
      const p = press.current; if (p) { clearTimeout(p.timer); press.current = null }
      if (was >= 2 || p?.fired) return
    }
    send({ k: 'mouse', a: 'up', b: e.button, ...norm(e) })
  }

  const hasMedia = !!mainStream
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const save = (b: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30_000) }
  function snapshot() {
    const v = video.current
    if (!v || !v.videoWidth) return toast('Aún no hay imagen', 'err')
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    c.toBlob(b => { if (b) { save(b, `forja-captura-${stamp()}.png`); toast('Captura guardada') } }, 'image/png')
  }
  function toggleRec() {
    if (rec) { rec.stop(); return }
    if (!mainStream) return
    const tracks = [...mainStream.getTracks()]
    if (shown?.camera) for (const t of shown.camera.getAudioTracks()) if (!tracks.includes(t)) tracks.push(t)
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m))
    try {
      const r = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 8_000_000 })
      const chunks: Blob[] = []
      r.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      r.onstop = () => { save(new Blob(chunks, { type: 'video/webm' }), `forja-grabacion-${stamp()}.webm`); setRec(null); toast('Grabación guardada') }
      r.start(1000); setRec(r)
    } catch (e) { toast(errMsg(e), 'err') }
  }
  useEffect(() => { if (!hasMedia && rec) rec.stop() }, [hasMedia])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="screen">
      <div className="screen-bar">
        <div className="seg sm">
          <button className={mode === 'view' ? 'on' : ''} onClick={() => { stopShare(); setMode('view') }}><Video size={14} /> Ver</button>
          <button className={mode === 'share' ? 'on' : ''} onClick={() => setMode('share')}><Cast size={14} /> Compartir desde aquí</button>
        </div>
        <div className="spacer" />
        {mode === 'view' && hasMedia && (
          <>
            {remoteControl && <button className={`btn sm ${control ? 'primary' : ''}`} onClick={() => setControl(c => !c)}>
              <MousePointer2 size={14} /> Control {control ? 'activado' : 'desactivado'}</button>}
            {remoteControl && control && <button className="btn sm" onClick={() => kb.current?.focus()}><KeyboardIcon size={14} /> Teclado</button>}
            <button className="btn sm" onClick={snapshot} title="Guardar una captura"><CamIcon size={14} /> Captura</button>
            <button className={`btn sm ${rec ? 'danger' : ''}`} onClick={toggleRec} title="Grabar el vídeo (WebM)">{rec ? <><Square size={13} /> Parar</> : <><Circle size={13} /> Grabar</>}</button>
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
                  ? 'Comparte este equipo con tu estudio: la pantalla, la cámara y el micrófono a la vez, como una videollamada.'
                  : 'La 3DS no emite vídeo por sí sola: abre en este equipo un visor de pantalla de 3DS (por ejemplo el de NTR/Snickerstream) o conecta una capturadora (como cámara) y compártelo.'}
              </p>
              <div className="share-opts">
                <label><input type="checkbox" checked={want.screen} onChange={e => setWant(w => ({ ...w, screen: e.target.checked }))} /> <MonitorUp size={15} /> Pantalla o ventana</label>
                <label><input type="checkbox" checked={want.camera} onChange={e => setWant(w => ({ ...w, camera: e.target.checked }))} /> <Camera size={15} /> Cámara / capturadora</label>
                <label><input type="checkbox" checked={want.mic} onChange={e => setWant(w => ({ ...w, mic: e.target.checked }))} /> <Mic size={15} /> Micrófono</label>
                {want.camera && (
                  <select value={cam} onFocus={listCams} onChange={e => setCam(e.target.value)} aria-label="Cámara">
                    <option value="">Cámara predeterminada</option>
                    {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}
                  </select>
                )}
              </div>
              <button className="btn primary" onClick={startShare}><Cast size={16} /> Empezar a compartir</button>
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
        {/* Cámara en un recuadro (el micrófono suena desde aquí) */}
        <video ref={pip} className={`pip ${pipStream ? '' : 'hidden'}`} autoPlay playsInline muted={sharing} />
        {!hasMedia && <div className="video-empty">{mode === 'view' ? status : 'Aún no compartes nada'}</div>}
        <input ref={kb} className="kb-capture" aria-label="Teclado remoto" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
          onBeforeInput={e => {
            const ev = e.nativeEvent as InputEvent
            e.preventDefault()
            if (!ime.current) return
            if (ev.inputType === 'deleteContentBackward') tap('Backspace')
            else if (ev.inputType === 'insertLineBreak' || ev.inputType === 'insertParagraph') tap('Enter')
            else if (ev.data) for (const ch of ev.data) typeChar(ch)
          }} />
        {rec && <div className="video-flag rec"><span className="rec-dot" /> Grabando</div>}
        {control && <div className="video-flag"><Keyboard size={13} /> Teclado y ratón enviados al PC</div>}
      </div>
    </div>
  )
}
