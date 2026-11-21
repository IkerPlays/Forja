import type { GameStatus, Platform } from './types'

export const PLATFORMS: Record<Platform, string> = { pc: 'PC', '3ds': '3DS', switch: 'Switch', mobile: 'Móvil', web: 'Web', other: 'Otra' }
export const STATUSES: Record<GameStatus, { label: string; color: string }> = {
  idea: { label: 'Idea', color: '#94a3b8' },
  dev: { label: 'En desarrollo', color: '#38bdf8' },
  alpha: { label: 'Alpha', color: '#f5b83d' },
  beta: { label: 'Beta', color: '#ff7a2f' },
  released: { label: 'Publicado', color: '#3ecf8e' },
  paused: { label: 'En pausa', color: '#e879a8' },
}
