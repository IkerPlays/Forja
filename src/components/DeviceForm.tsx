import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Device, DeviceKind } from '../lib/types'
import { Field, Modal, useToast } from './ui'
import { errMsg } from '../lib/util'

export default function DeviceForm({ studioId, kind, device, existing = [], onClose, onSaved }: {
  studioId: string; kind: DeviceKind; device?: Device; existing?: Device[]; onClose: () => void; onSaved: (id: string) => void
}) {
  const { session } = useAuth()
  const toast = useToast()
  const c = (device?.config ?? {}) as Record<string, string | number | undefined>
  const [name, setName] = useState(device?.name ?? (kind === '3ds' ? 'Mi 3DS' : 'Mi PC'))
  const [ip, setIp] = useState(String(c.ip ?? ''))
  const [ftpPort, setFtpPort] = useState(String(c.ftp_port ?? 5000))
  const [ftpUser, setFtpUser] = useState(String(c.ftp_user ?? ''))
  const [ftpPass, setFtpPass] = useState(String(c.ftp_pass ?? ''))
  const [inputPort, setInputPort] = useState(String(c.input_port ?? 4950))
  const [code, setCode] = useState('')
  const [relink, setRelink] = useState('')   // vincular a una consola que ya existe (evita duplicados)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const config = kind === '3ds'
      ? { ip: ip.trim(), ftp_port: Number(ftpPort) || 5000, ftp_user: ftpUser.trim(), ftp_pass: ftpPass, input_port: Number(inputPort) || 4950 }
      : {}
    if (kind === '3ds' && !device) {
      const { data: id, error: pe } = await sb().rpc('device_pair_approve', { p_code: code, p_studio: studioId, p_name: name.trim(), p_device: relink || null })
      if (pe) { setBusy(false); return toast(errMsg(pe), 'err') }
      if (ip.trim() || ftpUser || ftpPass) await sb().from('devices').update({ config }).eq('id', id as string)
      setBusy(false)
      return onSaved(id as string)
    }
    const q = device
      ? sb().from('devices').update({ name: name.trim(), config }).eq('id', device.id).select('id').single()
      : sb().from('devices').insert({ studio_id: studioId, name: name.trim(), kind, config, created_by: session!.user.id }).select('id').single()
    const { data, error } = await q
    setBusy(false)
    if (error) return toast(errMsg(error), 'err')
    onSaved(data!.id)
  }

  return (
    <Modal title={device ? 'Editar dispositivo' : kind === '3ds' ? 'Añadir una 3DS' : 'Añadir un PC'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Nombre"><input value={name} onChange={e => setName(e.target.value)} required maxLength={80} autoFocus /></Field>
        {kind === '3ds' && (
          <>
            {!device && existing.length > 0 && (
              <Field label="¿Es una consola nueva?" hint="Si la app de la 3DS pidió código otra vez (reinstalada, borraste la SD…), vincúlala a la consola que ya tienes para no duplicarla.">
                <select value={relink} onChange={e => setRelink(e.target.value)}>
                  <option value="">Sí, es una consola nueva</option>
                  {existing.map(d => <option key={d.id} value={d.id}>No, es «{d.name}»</option>)}
                </select>
              </Field>
            )}
            {!device && (
              <Field label="Código que muestra la 3DS" hint="Abre la app Forja3DS en la consola: te enseña un código de 6 caracteres (p. ej. K7M2QX).">
                <input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={6} required
                  placeholder="K7M2QX" autoCapitalize="characters" autoComplete="off" style={{ letterSpacing: '.3em', fontWeight: 700, textTransform: 'uppercase' }} />
              </Field>
            )}
            <p className="muted small">Lo de abajo solo sirve para el <em>mando</em> con la app de escritorio.</p>
            <details className="adv"><summary>Avanzado: mando por red local (app de escritorio)</summary>
            <Field label="IP de la 3DS en tu WiFi" hint="Ajustes → Internet → Ajustes de conexión.">
              <input value={ip} onChange={e => setIp(e.target.value)} placeholder="192.168.1.50" inputMode="decimal" />
            </Field>
            <div className="grid2">
              <Field label="Puerto FTP"><input value={ftpPort} onChange={e => setFtpPort(e.target.value)} inputMode="numeric" /></Field>
              <Field label="Puerto de mando"><input value={inputPort} onChange={e => setInputPort(e.target.value)} inputMode="numeric" /></Field>
            </div>
            <div className="grid2">
              <Field label="Usuario FTP (opcional)"><input value={ftpUser} onChange={e => setFtpUser(e.target.value)} autoComplete="off" /></Field>
              <Field label="Contraseña FTP (opcional)"><input value={ftpPass} onChange={e => setFtpPass(e.target.value)} autoComplete="off" /></Field>
            </div>
            </details>
          </>
        )}
        {kind === 'pc' && <p className="muted small">Lo normal es no crearlo a mano: instala la <strong>app de escritorio</strong> y el PC se registra solo (Conectar → guía). Esto solo sirve para compartir una carpeta desde el navegador.</p>}
        <button className="btn primary" disabled={busy || (kind === '3ds' && !device && code.length < 6)}>{busy && <Loader2 size={14} className="spin" />} {device ? 'Guardar' : kind === '3ds' ? 'Vincular consola' : 'Añadir'}</button>
      </form>
    </Modal>
  )
}
