import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Download, File as FileIcon, Folder, FolderPlus, Home, Loader2, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
import { sb } from '../lib/supabase'
import { CommandClient } from '../lib/devices'
import type { Device, FileEntry } from '../lib/types'
import { errMsg, formatBytes, uid } from '../lib/util'
import { downloadChunked, uploadChunked, usesChunks } from '../lib/transfer'
import { useToast } from './ui'

const join = (a: string, b: string) => (a.endsWith('/') ? a : a + '/') + b
const parent = (p: string) => { const s = p.replace(/\/+$/, '').split('/'); s.pop(); return s.join('/') || '/' }

export default function FileBrowser({ device, client, startPath = '/', dirActions }: {
  device: Device; client: CommandClient; startPath?: string
  dirActions?: (entry: FileEntry, path: string) => ReactNode
}) {
  const toast = useToast()
  const [path, setPath] = useState(startPath)
  const [entries, setEntries] = useState<FileEntry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async (p: string) => {
    setErr(null); setEntries(null)
    try {
      const res = await client.run<{ entries: FileEntry[]; truncated?: boolean }>('list_dir', { path: p })
      setEntries([...res.entries].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'es', { numeric: true }) : a.type === 'dir' ? -1 : 1)))
      if (res.truncated) toast('Carpeta muy grande: se muestran solo los primeros elementos')
    } catch (e) { setErr(errMsg(e)); setEntries([]) }
  }, [client, toast])

  useEffect(() => { void load(path) }, [path, load])

  const crumbs = path.split('/').filter(Boolean)

  async function download(e: FileEntry) {
    const full = join(path, e.name)
    setBusy(`Preparando ${e.name}…`)
    if (usesChunks(device)) {
      try { await downloadChunked(client, full, e.name, setBusy) } catch (er) { toast(errMsg(er), 'err') } finally { setBusy(null) }
      return
    }
    try {
      const res = await client.run<{ storage: string }>('get_file', { path: full }, 180_000)
      const { data, error } = await sb().storage.from('transfers').createSignedUrl(res.storage, 120, { download: e.name })
      if (error) throw error
      const a = document.createElement('a'); a.href = data.signedUrl; a.download = e.name; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => void sb().storage.from('transfers').remove([res.storage]), 60_000)
    } catch (er) { toast(errMsg(er), 'err') } finally { setBusy(null) }
  }

  async function upload(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (f.size > 50 * 1024 * 1024) { toast(`${f.name}: máximo 50 MB por archivo`, 'err'); continue }
      setBusy(`Subiendo ${f.name}…`)
      if (usesChunks(device)) {
        try { await uploadChunked(client, device, f, join(path, f.name), setBusy); toast(`${f.name} enviado`) }
        catch (er) { toast(errMsg(er), 'err') }
        continue
      }
      const key = `${device.studio_id}/${device.id}/${uid()}-${f.name.replace(/[^\w.\- ]/g, '_')}`
      try {
        const up = await sb().storage.from('transfers').upload(key, f, { upsert: false })
        if (up.error) throw up.error
        await client.run('put_file', { path: join(path, f.name), storage: key }, 180_000)
        toast(`${f.name} enviado`)
      } catch (er) { toast(errMsg(er), 'err'); void sb().storage.from('transfers').remove([key]) }
    }
    setBusy(null); void load(path)
  }

  async function action(type: 'mkdir' | 'delete' | 'rename', e?: FileEntry) {
    try {
      if (type === 'mkdir') {
        const n = prompt('Nombre de la carpeta nueva')?.trim(); if (!n) return
        await client.run('mkdir', { path: join(path, n) })
      } else if (type === 'rename' && e) {
        const n = prompt('Nuevo nombre', e.name)?.trim(); if (!n || n === e.name) return
        await client.run('rename', { path: join(path, e.name), to: join(path, n) })
      } else if (type === 'delete' && e) {
        if (!confirm(`¿Eliminar «${e.name}» del dispositivo? No se puede deshacer.`)) return
        await client.run('delete', { path: join(path, e.name), type: e.type })
      }
      void load(path)
    } catch (er) { toast(errMsg(er), 'err') }
  }

  return (
    <div className={`files ${drag ? 'drag' : ''}`}
      onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files) }}>
      <div className="files-bar">
        <div className="crumbs">
          <button onClick={() => setPath('/')} aria-label="Raíz"><Home size={15} /></button>
          {crumbs.map((c, i) => (
            <span key={i}><ChevronRight size={13} /><button onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</button></span>
          ))}
        </div>
        <div className="row">
          <button className="icon-btn" onClick={() => load(path)} aria-label="Actualizar"><RefreshCw size={16} /></button>
          <button className="btn sm" onClick={() => action('mkdir')} disabled={path === '/' && device.kind === 'pc'}><FolderPlus size={15} /> Carpeta</button>
          <button className="btn sm primary" onClick={() => fileInput.current?.click()} disabled={path === '/' && device.kind === 'pc'}><Upload size={15} /> Subir</button>
          <input ref={fileInput} type="file" multiple hidden onChange={e => { if (e.target.files) void upload(e.target.files); e.target.value = '' }} />
        </div>
      </div>

      {busy && <div className="files-busy"><Loader2 size={15} className="spin" /> {busy}</div>}
      {err && <div className="callout error">{err}</div>}
      {!entries ? <div className="center-fill"><Loader2 className="spin" size={20} /></div> : (
        <ul className="file-list">
          {path !== '/' && <li className="file-row" onClick={() => setPath(parent(path))}><Folder size={18} /><span className="fname">..</span></li>}
          {entries.map(e => {
            const full = join(path, e.name)
            return (
              <li key={e.name} className="file-row" onClick={() => e.type === 'dir' && setPath(full)}>
                {e.type === 'dir' ? <Folder size={18} className="dir" /> : <FileIcon size={18} />}
                <span className="fname">{e.name}</span>
                <span className="fsize muted">{e.type === 'file' ? formatBytes(e.size) : ''}</span>
                <span className="fdate muted">{e.mtime ? new Date(e.mtime).toLocaleDateString('es') : ''}</span>
                <span className="factions" onClick={ev => ev.stopPropagation()}>
                  {e.type === 'dir' && dirActions?.(e, full)}
                  {e.type === 'file' && <button className="icon-btn sm" onClick={() => download(e)} aria-label="Descargar"><Download size={15} /></button>}
                  {!(path === '/' && device.kind === 'pc') && <>
                    <button className="icon-btn sm" onClick={() => action('rename', e)} aria-label="Renombrar"><Pencil size={14} /></button>
                    <button className="icon-btn sm" onClick={() => action('delete', e)} aria-label="Eliminar"><Trash2 size={14} /></button>
                  </>}
                </span>
              </li>
            )
          })}
          {!entries.length && !err && <li className="muted file-empty">Carpeta vacía. Arrastra archivos aquí para subirlos.</li>}
        </ul>
      )}
      <p className="muted small files-note">Transferencias de hasta 50 MB por archivo (límite de Supabase Storage gratuito).</p>
    </div>
  )
}
