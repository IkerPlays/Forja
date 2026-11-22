/**
 * Envío con tope de frecuencia que NUNCA pierde el último valor: como mucho uno cada `gapMs`; si llegan más, solo sale
 * el más reciente de cada clave. Realtime descarta los eventos que superan su límite por segundo.
 */
export class Coalescer<T> {
  private slots = new Map<string, { value: T | undefined; timer: ReturnType<typeof setTimeout> | null; last: number }>()
  constructor(private send: (v: T) => void, private now: () => number = Date.now) {}

  push(key: string, value: T, gapMs: number) {
    let c = this.slots.get(key)
    if (!c) { c = { value: undefined, timer: null, last: 0 }; this.slots.set(key, c) }
    c.value = value
    const wait = gapMs - (this.now() - c.last)
    if (wait <= 0 && !c.timer) this.flushKey(key)
    else if (!c.timer) c.timer = setTimeout(() => this.flushKey(key), Math.max(0, wait))
  }

  private flushKey(key: string) {
    const c = this.slots.get(key)
    if (!c) return
    if (c.timer) { clearTimeout(c.timer); c.timer = null }
    if (c.value !== undefined) { const v = c.value; c.value = undefined; c.last = this.now(); this.send(v) }
  }

  /** Envía ya lo pendiente (para conservar el orden). */
  flush() { for (const k of this.slots.keys()) this.flushKey(k) }
  dispose() { for (const c of this.slots.values()) if (c.timer) clearTimeout(c.timer); this.slots.clear() }
}
