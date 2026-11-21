/** API que la app de escritorio (Electron) inyecta como window.forjaDesktop. En el navegador no existe. */
export interface DesktopSettings {
  webUrl: string; roots: string[]; fullAccess: boolean; allowInput: boolean; allowScreen: boolean
  relay: boolean; autostart: boolean; hostId: string
}
export interface ForjaDesktop {
  isDesktop: true
  info(): Promise<{ hostname: string; platform: string; version: string; hostId: string; input: boolean; lan: string[] }>
  getSettings(): Promise<DesktopSettings>
  setSettings(patch: Partial<Pick<DesktopSettings, 'fullAccess' | 'allowInput' | 'allowScreen' | 'relay' | 'autostart'>>): Promise<DesktopSettings>
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
  inputMouse(m: Record<string, unknown>): void
  inputKey(m: Record<string, unknown>): void
  padSend(ip: string, port: number, state: unknown): void
}

export const desktop: ForjaDesktop | undefined =
  typeof window !== 'undefined' ? ((window as unknown as { forjaDesktop?: ForjaDesktop }).forjaDesktop) : undefined
export const isDesktop = !!desktop
