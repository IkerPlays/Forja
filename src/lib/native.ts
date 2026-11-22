/** API que la app de escritorio (Electron) inyecta como window.forjaDesktop. En el navegador no existe. */
export interface DesktopSettings {
  webUrl: string; roots: string[]; fullAccess: boolean; allowInput: boolean; allowScreen: boolean
  relay: boolean; autostart: boolean; hostId: string; deviceId?: string
  shareCamera: boolean; shareMic: boolean; allowPower: boolean; screenQuality: 'fluid' | 'native'
}
export interface ForjaDesktop {
  isDesktop: true
  info(): Promise<{ hostname: string; platform: string; version: string; shellVersion?: string; hostId: string; input: boolean; lan: string[] }>
  getSettings(): Promise<DesktopSettings>
  setSettings(patch: Partial<Pick<DesktopSettings, 'fullAccess' | 'allowInput' | 'allowScreen' | 'relay' | 'autostart' | 'deviceId' | 'shareCamera' | 'shareMic' | 'allowPower' | 'screenQuality'>>): Promise<DesktopSettings>
  pickRoot(): Promise<DesktopSettings>
  removeRoot(p: string): Promise<DesktopSettings>
  fs: {
    list(p: string): Promise<{ entries: { name: string; type: 'dir' | 'file'; size: number; mtime: number | null }[]; truncated?: boolean }>
    size(p: string): Promise<number>
    read(p: string, offset: number, length: number): Promise<Uint8Array>
    write(p: string, data: Uint8Array, append: boolean): Promise<void>
    mkdir(p: string): Promise<void>
    rename(a: string, b: string): Promise<void>
    remove(p: string): Promise<void>
  }
  relayStatus(): Promise<{ on: boolean; addresses: string[]; requests: number; error?: string }>
  openFirewall(): Promise<boolean>
  padStatus(): Promise<{ sent: number; error: string }>
  power(action: 'lock' | 'sleep' | 'restart' | 'shutdown'): Promise<void>
  ntrStart(ip: string, opts?: { quality?: number; topPriority?: boolean; priority?: number; qos?: number }): Promise<{ accepted: boolean; frames: number }>
  ntrStatus(): Promise<{ on: boolean; frames: number; lastFrameAgoMs: number | null }>
  ntrStop(): Promise<void>
  onNtrFrame(cb: (screen: 'top' | 'bottom', jpeg: Uint8Array) => void): () => void
  checkUpdate(): Promise<{ ok: boolean; current?: string; latest?: string; downloaded?: boolean; error?: string }>
  applyUpdate(): Promise<void>
  inputMouse(m: Record<string, unknown>): void
  inputKey(m: Record<string, unknown>): void
  padSend(ip: string, port: number, state: unknown): void
}

export const desktop: ForjaDesktop | undefined =
  typeof window !== 'undefined' ? ((window as unknown as { forjaDesktop?: ForjaDesktop }).forjaDesktop) : undefined
export const isDesktop = !!desktop

const REQUIRED = ['ntrStart', 'ntrStop', 'onNtrFrame', 'padSend', 'padStatus', 'checkUpdate', 'power'] as const
/** Funciones que esta web necesita y el instalador de escritorio instalado aún no tiene (instalador antiguo). */
export const missingDesktopApis = (): string[] => (desktop ? REQUIRED.filter(k => typeof (desktop as unknown as Record<string, unknown>)[k] !== 'function') : [])
export const RELEASES_URL = 'https://github.com/IkerPlays/Forja/releases/latest'
export const OUTDATED_SHELL_MSG = 'Tu instalador de Forja para escritorio es antiguo y no incluye esta función. Descarga e instala el último desde ' + RELEASES_URL + ' (solo hace falta una vez; después se actualiza solo).'
