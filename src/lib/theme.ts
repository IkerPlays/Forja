export type ThemePref = 'auto' | 'light' | 'dark'
const KEY = 'forja.theme'

export function getTheme(): ThemePref {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v } catch { /* noop */ }
  return 'auto'
}

export function applyTheme(p: ThemePref = getTheme()) {
  const el = document.documentElement
  if (p === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', p)
}

export function setTheme(p: ThemePref) {
  try { if (p === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p) } catch { /* noop */ }
  applyTheme(p)
}

export const ACCENTS = [
  { name: 'Naranja', a: '#ff7a2f', b: '#ffb347' }, { name: 'Verde', a: '#3ecf8e', b: '#8be9b9' },
  { name: 'Azul', a: '#4da3ff', b: '#8cc8ff' }, { name: 'Violeta', a: '#9b7bff', b: '#c4b1ff' },
  { name: 'Rosa', a: '#ff5c93', b: '#ff9ec0' },
]
const AKEY = 'forja.accent'
export function getAccent(): string { try { return localStorage.getItem(AKEY) || ACCENTS[0].name } catch { return ACCENTS[0].name } }
export function applyAccent(name: string = getAccent()) {
  const c = ACCENTS.find(x => x.name === name) ?? ACCENTS[0]
  const st = document.documentElement.style
  if (c === ACCENTS[0]) { st.removeProperty('--accent'); st.removeProperty('--accent2') } else { st.setProperty('--accent', c.a); st.setProperty('--accent2', c.b) }
}
export function setAccent(name: string) { try { localStorage.setItem(AKEY, name) } catch { /* noop */ } applyAccent(name) }
