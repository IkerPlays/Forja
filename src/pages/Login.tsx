import { useState } from 'react'
import { Mail, KeyRound, Loader2 } from 'lucide-react'
import { sb } from '../lib/supabase'
import { Field } from '../components/ui'
import { errMsg } from '../lib/util'

type Mode = 'in' | 'up' | 'magic'

export default function Login() {
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      if (mode === 'in') {
        const { error } = await sb().auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'up') {
        const { data, error } = await sb().auth.signUp({
          email, password,
          options: { data: { display_name: name || undefined }, emailRedirectTo: location.origin },
        })
        if (error) throw error
        if (!data.session) setMsg({ ok: true, text: 'Cuenta creada. Revisa tu correo para confirmarla y vuelve a entrar.' })
      } else {
        const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } })
        if (error) throw error
        setMsg({ ok: true, text: 'Te hemos enviado un enlace de acceso. Ábrelo en este dispositivo.' })
      }
    } catch (err) {
      const t = errMsg(err)
      setMsg({ ok: false, text: /invalid login/i.test(t) ? 'Correo o contraseña incorrectos.' : t })
    } finally { setBusy(false) }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo"><img src="/favicon.svg" width={44} height={44} alt="" /></div>
        <h1>Forja</h1>
        <p className="muted">El hub de tu estudio.</p>

        <div className="seg">
          <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Entrar</button>
          <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Crear cuenta</button>
          <button type="button" className={mode === 'magic' ? 'on' : ''} onClick={() => setMode('magic')}>Enlace</button>
        </div>

        {mode === 'up' && <Field label="Nombre"><input value={name} onChange={e => setName(e.target.value)} placeholder="Cómo te verán" autoComplete="name" /></Field>}
        <Field label="Correo"><input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" inputMode="email" /></Field>
        {mode !== 'magic' && (
          <Field label="Contraseña">
            <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'up' ? 'new-password' : 'current-password'} />
          </Field>
        )}
        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
        <button className="btn primary block" disabled={busy} type="submit">
          {busy ? <Loader2 size={16} className="spin" /> : mode === 'magic' ? <Mail size={16} /> : <KeyRound size={16} />}
          {mode === 'in' ? 'Entrar' : mode === 'up' ? 'Crear cuenta' : 'Enviarme el enlace'}
        </button>
      </form>
    </div>
  )
}
