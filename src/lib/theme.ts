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
