import { useEffect, useState } from 'react'
import { Loader2, LogOut, Upload } from 'lucide-react'
import { sb, clearConfig, configFromEnv, SUPABASE_URL } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useStudio } from '../context/StudioContext'
import { Avatar, ColorPicker, Field, PageHeader, useToast } from '../components/ui'
import { COLORS, errMsg, uid } from '../lib/util'
import { ACCENTS, getAccent, getTheme, setAccent, setTheme, type ThemePref } from '../lib/theme'

export default function Settings() {
  const { profile, session, refreshProfile, signOut } = useAuth()
  const { isMember, reload } = useStudio()
  const toast = useToast()
  const [name, setName] = useState(profile?.display_name ?? '')
  const [username, setUsername] = useState(profile?.username ?? '')
  const [color, setColor] = useState(profile?.color ?? COLORS[4])
  const [busy, setBusy] = useState(false)
  const [studioName, setStudioName] = useState('')
  const [installable, setInstallable] = useState(() => !!(window as unknown as { __installPrompt?: unknown }).__installPrompt)
  useEffect(() => { const f = () => setInstallable(true); window.addEventListener('forja:installable', f); return () => window.removeEventListener('forja:installable', f) }, [])
  const [accent, setAccentSel] = useState(getAccent())
  const [theme, setThemeSel] = useState<ThemePref>(getTheme())

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const u = username.trim().toLowerCase()
    const { error } = await sb().from('profiles').update({ display_name: name.trim(), username: u || null, color }).eq('id', session!.user.id)
    setBusy(false)
    if (error) return toast(/profiles_username/.test(error.message) ? 'Ese nombre de usuario no es válido o ya existe (3-24: letras minúsculas, números y _)' : errMsg(error), 'err')
    toast('Perfil guardado'); await refreshProfile()
  }

  async function avatar(file: File) {
    if (file.size > 2 * 1024 * 1024) return toast('La imagen pesa más de 2 MB', 'err')
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${session!.user.id}/${uid()}.${ext}`
    const up = await sb().storage.from('avatars').upload(path, file, { contentType: file.type })
    if (up.error) return toast(errMsg(up.error), 'err')
    const url = sb().storage.from('avatars').getPublicUrl(path).data.publicUrl
    const { error } = await sb().from('profiles').update({ avatar_url: url }).eq('id', session!.user.id)
    if (error) return toast(errMsg(error), 'err')
    await refreshProfile()
  }

  async function createStudio(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await sb().rpc('create_studio', { p_name: studioName.trim() })
    if (error) return toast(errMsg(error), 'err')
    toast('Estudio creado'); await reload()
  }

  return (
    <div className="page narrow">
      <PageHeader title="Ajustes" />

      <form className="panel stack" onSubmit={save}>
        <h2>Tu perfil</h2>
        <div className="row">
          <Avatar profile={{ ...profile, color }} size={64} />
          <label className="btn sm"><Upload size={14} /> Cambiar foto
            <input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && void avatar(e.target.files[0])} /></label>
        </div>
        <Field label="Nombre visible"><input value={name} onChange={e => setName(e.target.value)} maxLength={60} /></Field>
        <Field label="Nombre de usuario" hint="Opcional. Letras minúsculas, números y _ (3-24)."><input value={username} onChange={e => setUsername(e.target.value)} /></Field>
        <Field label="Color"><ColorPicker colors={COLORS} value={color} onChange={setColor} /></Field>
        <Field label="Correo"><input value={profile?.email ?? ''} disabled /></Field>
        <button className="btn primary" disabled={busy}>{busy && <Loader2 size={14} className="spin" />} Guardar</button>
      </form>

      <section className="panel stack">
        <h2>Apariencia</h2>
        <div className="seg">{(['auto', 'dark', 'light'] as ThemePref[]).map(t => <button key={t} className={theme === t ? 'on' : ''} onClick={() => { setTheme(t); setThemeSel(t) }}>{t === 'auto' ? 'Automático' : t === 'dark' ? 'Oscuro' : 'Claro'}</button>)}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Color de acento">
          {ACCENTS.map(c => <button key={c.name} type="button" className={'swatch' + (accent === c.name ? ' on' : '')} title={c.name} aria-label={c.name} aria-pressed={accent === c.name}
            style={{ background: `linear-gradient(135deg, ${c.b}, ${c.a})` }} onClick={() => { setAccent(c.name); setAccentSel(c.name) }} />)}
        </div>
        {installable && <button className="btn" onClick={async () => {
          const ev = (window as unknown as { __installPrompt?: { prompt: () => Promise<void> } }).__installPrompt
          await ev?.prompt(); setInstallable(false)
        }}>Instalar Forja como aplicación</button>}
        <p className="muted small">Atajos: <kbd>Ctrl</kbd>+<kbd>K</kbd> o <kbd>/</kbd> abren la búsqueda global desde cualquier pantalla.</p>
      </section>

      {!isMember && (
        <form className="panel stack" onSubmit={createStudio}>
          <h2>Crear mi propio estudio</h2>
        <p className="muted small">Ahora solo ves los proyectos que te han compartido. Si quieres tu propio estudio (juegos, 3DS, equipo…), créalo aquí.</p>
          <div className="inline-form"><input value={studioName} onChange={e => setStudioName(e.target.value)} placeholder="Nombre del estudio" required /><button className="btn primary">Crear</button></div>
        </form>
      )}

      <section className="panel stack">
        <h2>Conexión</h2>
        <p className="muted small">Supabase: <code>{SUPABASE_URL}</code></p>
        {!configFromEnv() && (
          <button className="btn" onClick={() => { if (confirm('Se olvidará la conexión guardada en este navegador. ¿Continuar?')) { clearConfig(); location.reload() } }}>Cambiar proyecto de Supabase</button>
        )}
        <button className="btn" onClick={() => void signOut()}><LogOut size={15} /> Cerrar sesión</button>
      </section>
    </div>
  )
}
