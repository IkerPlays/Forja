/** Estado del mando de la 3DS que viaja por el canal "device:<id>" hasta el bridge. */
export const BTN = {
  A: 0, B: 1, SELECT: 2, START: 3, RIGHT: 4, LEFT: 5, UP: 6, DOWN: 7, R: 8, L: 9, X: 10, Y: 11, ZL: 14, ZR: 15,
} as const
export type BtnName = keyof typeof BTN

export interface PadState {
  b: number                       // máscara de botones pulsados (bit = BTN[x])
  cx: number; cy: number          // Circle Pad  -1..1 (y positivo = arriba)
  sx: number; sy: number          // C-Stick     -1..1
  t: [number, number] | null      // pantalla táctil 0..1 (x, y) o null si no se toca
  home?: boolean
}
export const NEUTRAL: PadState = { b: 0, cx: 0, cy: 0, sx: 0, sy: 0, t: null }

export const bit = (n: BtnName) => 1 << BTN[n]
export const isNeutral = (s: PadState) => s.b === 0 && !s.cx && !s.cy && !s.sx && !s.sy && !s.t && !s.home

export function mergePad(...states: PadState[]): PadState {
  const out: PadState = { ...NEUTRAL }
  for (const s of states) {
    out.b |= s.b
    if (Math.abs(s.cx) > Math.abs(out.cx)) out.cx = s.cx
    if (Math.abs(s.cy) > Math.abs(out.cy)) out.cy = s.cy
    if (Math.abs(s.sx) > Math.abs(out.sx)) out.sx = s.sx
    if (Math.abs(s.sy) > Math.abs(out.sy)) out.sy = s.sy
    if (s.t) out.t = s.t
    if (s.home) out.home = true
  }
  return out
}

/** Teclado → 3DS */
export const KEYMAP: Record<string, BtnName> = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  KeyX: 'A', KeyZ: 'B', KeyS: 'X', KeyA: 'Y', KeyQ: 'L', KeyW: 'R',
  Enter: 'START', ShiftRight: 'SELECT', Backspace: 'SELECT',
}
export const STICK_KEYS = { up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL' }

/** Mando físico (Gamepad API, mapeo estándar) → 3DS */
export function readGamepad(): PadState {
  const s: PadState = { ...NEUTRAL }
  const pads = navigator.getGamepads ? navigator.getGamepads() : []
  const gp = Array.from(pads).find(p => p && p.connected)
  if (!gp) return s
  const pressed = (i: number) => !!gp.buttons[i]?.pressed
  const map: [number, BtnName][] = [[0, 'B'], [1, 'A'], [2, 'Y'], [3, 'X'], [4, 'L'], [5, 'R'], [6, 'ZL'], [7, 'ZR'], [8, 'SELECT'], [9, 'START'], [12, 'UP'], [13, 'DOWN'], [14, 'LEFT'], [15, 'RIGHT']]
  for (const [i, n] of map) if (pressed(i)) s.b |= bit(n)
  const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v)
  s.cx = dz(gp.axes[0] ?? 0); s.cy = -dz(gp.axes[1] ?? 0)
  s.sx = dz(gp.axes[2] ?? 0); s.sy = -dz(gp.axes[3] ?? 0)
  return s
}
