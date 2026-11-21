import { useState } from 'react'
import { Loader2, Hammer } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useStudio } from '../context/StudioContext'
import { useAuth } from '../context/AuthContext'
import { Field, useToast } from '../components/ui'
import { errMsg } from '../lib/util'

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const { reload, setActive } = useStudio()
  const { signOut } = useAuth()
  const toast = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const { data, error } = await sb().rpc('create_studio', { p_name: name.trim() })
    if (error) { toast(errMsg(error), 'err'); setBusy(false); return }
    setActive(data as string)
    await reload()
    onDone()
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={create}>
        <div className="auth-logo"><Hammer size={34} /></div>
        <h1>Crea tu estudio</h1>
        <p className="muted">
          El estudio agrupa tus proyectos, juegos y dispositivos. Después podrás añadir cuentas
          para que te ayuden a gestionarlo.
        </p>
        <Field label="Nombre del estudio"><input value={name} onChange={e => setName(e.target.value)} placeholder="Mi estudio" autoFocus required maxLength={80} /></Field>
        <button className="btn primary block" disabled={busy}>{busy && <Loader2 size={16} className="spin" />} Crear estudio</button>
        <button type="button" className="btn ghost block" onClick={() => void signOut()}>Cerrar sesión</button>
        <p className="muted small">¿Te han invitado a un estudio o proyecto? Entra con el mismo correo al que te invitaron y aparecerá solo.</p>
      </form>
    </div>
  )
}
