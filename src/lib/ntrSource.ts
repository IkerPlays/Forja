import { desktop } from './native'

/**
 * Pantalla de la 3DS como vídeo: la app de escritorio recibe los fotogramas JPEG de NTR/NTR-HR y aquí se componen en un
 * lienzo (pantalla superior 400×240 y, debajo, la inferior 320×240) que se emite por WebRTC como cualquier otra pantalla.
 */
export const NTR_W = 400
export const NTR_H = 480

export class NtrSource {
  private canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private off: (() => void) | null = null
  private stopped = false
  frames = 0

  constructor(private ip: string) {
    this.canvas.width = NTR_W; this.canvas.height = NTR_H
    this.ctx = this.canvas.getContext('2d', { alpha: false })!
    this.ctx.fillStyle = '#05070a'; this.ctx.fillRect(0, 0, NTR_W, NTR_H)
  }

  /** Arranca NTR en la 3DS y devuelve el vídeo. Falla si en unos segundos no llega imagen. */
  async start(): Promise<MediaStream> {
    const d = desktop!
    this.off = d.onNtrFrame((screen, jpeg) => { void this.draw(screen, jpeg) })
    const stream = this.canvas.captureStream(60)
    const track = stream.getVideoTracks()[0]
    const orig = track.stop.bind(track)
    track.stop = () => { orig(); this.stop() }      // al soltar el vídeo se detiene el streaming de la 3DS
    const r = await d.ntrStart(this.ip, { quality: 80, topPriority: true, priority: 3, qos: 16 })
    for (let i = 0; i < 24 && !this.frames; i++) await new Promise(res => setTimeout(res, 250))
    if (!this.frames) {
      this.stop()
      throw new Error(r.accepted
        ? 'La 3DS aceptó la orden pero no envía imagen. ¿Hay un juego abierto y NTR/NTR-HR activo (BootNTR)? Comprueba también el cortafuegos del PC (UDP 8001).'
        : `No se pudo hablar con NTR en ${this.ip}:8000. Abre BootNTR/NTR-HR en la 3DS (misma WiFi) y, si hace falta, pon su IP en la ficha.`)
    }
    return stream
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.off?.()
    void desktop?.ntrStop()
  }

  private async draw(screen: 'top' | 'bottom', jpeg: Uint8Array) {
    try {
      const bmp = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }))
      // NTR manda cada pantalla girada 90° (240×400 / 240×320): se gira de vuelta
      const ox = screen === 'top' ? 0 : (NTR_W - bmp.height) / 2
      const oy = screen === 'top' ? 0 : 240
      this.ctx.setTransform(0, -1, 1, 0, ox, oy + bmp.width)
      this.ctx.drawImage(bmp, 0, 0)
      this.ctx.setTransform(1, 0, 0, 1, 0, 0)
      bmp.close()
      this.frames++
    } catch { /* fotograma dañado: se ignora */ }
  }
}

/** Convierte un punto del vídeo compuesto (0..1) en coordenadas de la pantalla táctil de la 3DS (0..1), o null si cae fuera. */
export function touchFromComposite(x: number, y: number): [number, number] | null {
  const px = x * NTR_W, py = y * NTR_H
  if (py < 240 || px < 40 || px >= 360) return null
  return [(px - 40) / 320, (py - 240) / 240]
}
