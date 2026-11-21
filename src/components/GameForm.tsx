import { useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PLATFORMS, STATUSES } from '../lib/games'
import type { Device, Game, GameStatus, Platform } from '../lib/types'
import { Field, Modal, useToast } from './ui'
import { errMsg, uid } from '../lib/util'

export default function GameForm({ studioId, game, devices, onClose, onSaved }: {
  studioId: string; game?: Game; devices: Device[]; onClose: () => void; onSaved: (g: Game) => void
}) {
  const { session } = useAuth()
  const toast = useToast()
  const [f, setF] = useState({
    name: game?.name ?? '', platform: (game?.platform ?? 'pc') as Platform, status: (game?.status ?? 'dev') as GameStatus,
    description: game?.description ?? '', version: game?.version ?? '', repo_url: game?.repo_url ?? '', store_url: game?.store_url ?? '',
    pc_path: game?.pc_path ?? '', device_id: game?.device_id ?? '', cover_url: game?.cover_url ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }))

  async function cover(file: File) {
    if (file.size > 5 * 1024 * 1024) return toast('La portada pesa más de 5 MB', 'err')
    setUploading(true)
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${studioId}/${uid()}.${ext}`
    const { error } = await sb().storage.from('covers').upload(path, file, { contentType: file.type, upsert: false })
    setUploading(false)
    if (error) return toast(errMsg(error), 'err')
    set('cover_url', sb().storage.from('covers').getPublicUrl(path).data.publicUrl)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const values = { ...f, name: f.name.trim(), device_id: f.device_id || null, cover_url: f.cover_url || null }
    const q = game
      ? sb().from('games').update(values).eq('id', game.id).select().single()
      : sb().from('games').insert({ ...values, studio_id: studioId, created_by: session!.user.id }).select().single()
    const { data, error } = await q
    setBusy(false)
    if (error) return toast(errMsg(error), 'err')
    onSaved(data as Game)
  }

  return (
    <Modal title={game ? 'Editar juego' : 'Nuevo juego'} wide onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="game-form-top">
          <label className="cover-pick" style={f.cover_url ? { backgroundImage: `url(${f.cover_url})` } : undefined}>
            {uploading ? <Loader2 className="spin" /> : !f.cover_url && <><ImagePlus size={22} /><span>Portada</span></>}
            <input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && void cover(e.target.files[0])} />
          </label>
          <div className="stack grow">
            <Field label="Nombre"><input value={f.name} onChange={e => set('name', e.target.value)} required maxLength={120} autoFocus /></Field>
            <div className="grid2">
              <Field label="Plataforma"><select value={f.platform} onChange={e => set('platform', e.target.value as Platform)}>
                {Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Estado"><select value={f.status} onChange={e => set('status', e.target.value as GameStatus)}>
                {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
            </div>
          </div>
        </div>
        <Field label="Descripción"><textarea rows={3} value={f.description} onChange={e => set('description', e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Versión"><input value={f.version} onChange={e => set('version', e.target.value)} placeholder="0.1.0" /></Field>
          <Field label="Repositorio"><input value={f.repo_url} onChange={e => set('repo_url', e.target.value)} placeholder="https://github.com/…" /></Field>
        </div>
        <Field label="Página de la tienda / descarga"><input value={f.store_url} onChange={e => set('store_url', e.target.value)} placeholder="https://…" /></Field>
        <div className="grid2">
          <Field label="Dispositivo donde está"><select value={f.device_id} onChange={e => set('device_id', e.target.value)}>
            <option value="">Ninguno</option>{devices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.kind === '3ds' ? '3DS' : 'PC'})</option>)}</select></Field>
          <Field label="Ruta en el dispositivo"><input value={f.pc_path} onChange={e => set('pc_path', e.target.value)} placeholder="/Games/MiJuego" /></Field>
        </div>
        <button className="btn primary" disabled={busy || uploading}>{busy && <Loader2 size={14} className="spin" />} {game ? 'Guardar' : 'Crear juego'}</button>
      </form>
    </Modal>
  )
}
