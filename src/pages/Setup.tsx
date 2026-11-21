import { useState } from 'react'
import { Database } from 'lucide-react'
import { saveConfig } from '../lib/supabase'
import { Field } from '../components/ui'

export default function Setup() {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url.trim().replace(/\/+$/, ''))) {
      setErr('La URL debe parecerse a https://xxxxxxxx.supabase.co')
      return
    }
    if (key.trim().length < 20) { setErr('Pega la clave "anon" / "publishable" completa'); return }
    saveConfig(url, key)
    location.reload()
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo"><img src="/favicon.svg" width={44} height={44} alt="" /></div>
        <h1>Conecta Forja con tu Supabase</h1>
        <p className="muted">
          Falta un paso: pega los datos <strong>públicos</strong> de tu proyecto
          (Supabase → Project Settings → API). Se guardan solo en este navegador.
          Para no repetirlo en cada dispositivo, ponlos como variables en Netlify
          (<code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code>).
        </p>
        <Field label="Project URL">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://xxxxxxxx.supabase.co" autoFocus />
        </Field>
        <Field label="Clave anon / publishable">
          <input value={key} onChange={e => setKey(e.target.value)} placeholder="eyJhbGciOi… o sb_publishable_…" />
        </Field>
        {err && <p className="error">{err}</p>}
        <button className="btn primary block" type="submit"><Database size={16} /> Guardar y continuar</button>
        <p className="muted small">¿Aún no has creado las tablas? Ejecuta <code>supabase/01_auth.sql</code> y luego <code>supabase/02_app.sql</code> en el SQL Editor.</p>
      </form>
    </div>
  )
}
