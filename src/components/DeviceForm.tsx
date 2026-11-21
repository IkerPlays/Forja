import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Device, DeviceKind } from '../lib/types'
import { Field, Modal, useToast } from './ui'
import { errMsg } from '../lib/util'

export default function DeviceForm({ studioId, kind, device, onClose, onSaved }: {
  studioId: string; kind: DeviceKind; device?: Device; onClose: () => void; onSaved: (id: string) => void
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
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const config = kind === '3ds'
      ? { ip: ip.trim(), ftp_port: Number(ftpPort) || 5000, ftp_user: ftpUser.trim(), ftp_pass: ftpPass, input_port: Number(inputPort) || 4950 }
      : {}
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
            <p className="muted small">Para archivos y pantalla no hace falta nada más: instala <strong>Forja3DS</strong> en la consola (te lo explicamos al crearla). Lo de abajo solo sirve para el <em>mando</em> con el bridge local opcional.</p>
            <details className="adv"><summary>Avanzado: mando por red local (bridge opcional)</summary>
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
        {kind === 'pc' && <p className="muted small">Después de crearlo, abre Forja en ese PC → pestaña Archivos → <em>Elegir carpeta</em>. No hay que instalar nada.</p>}
        <button className="btn primary" disabled={busy}>{busy && <Loader2 size={14} className="spin" />} {device ? 'Guardar' : 'Añadir'}</button>
      </form>
    </Modal>
  )
}
