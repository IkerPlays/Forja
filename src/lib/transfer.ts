import { sb } from './supabase'
import { uid } from './util'
import type { CommandClient } from './devices'
import type { Device } from './types'

/** Protocolo v2 (agentes sin bridge): los archivos viajan en trozos de 1 MB por Storage. */
export const PART = 1024 * 1024
export const MAX_FILE = 50 * 1024 * 1024
const LONG = 15 * 60_000

export const usesChunks = (d: Device) => (d.info as Record<string, unknown>)?.proto === 2

async function removeParts(prefix: string, n: number) {
  const keys = Array.from({ length: n }, (_, i) => `${prefix}.p${i}`)
  if (keys.length) await sb().storage.from('transfers').remove(keys)
}

/** Dispositivo → navegador */
export async function downloadChunked(client: CommandClient, path: string, name: string, onStatus: (s: string) => void) {
  onStatus(`El dispositivo está preparando ${name}…`)
  const res = await client.run<{ storage: string; parts: number }>('get_file', { path, v: 2 }, LONG)
  const blobs: Blob[] = []
  try {
    for (let i = 0; i < res.parts; i++) {
      onStatus(`Descargando ${name} (${i + 1}/${res.parts})…`)
      const { data, error } = await sb().storage.from('transfers').download(`${res.storage}.p${i}`)
      if (error) throw error
      blobs.push(data)
    }
    const url = URL.createObjectURL(new Blob(blobs))
    const a = document.createElement('a'); a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } finally { await removeParts(res.storage, res.parts).catch(() => {}) }
}

/** Navegador → dispositivo */
export async function uploadChunked(client: CommandClient, device: Device, file: File, destPath: string, onStatus: (s: string) => void) {
  const parts = Math.max(1, Math.ceil(file.size / PART))
  const prefix = `${device.studio_id}/${device.id}/${uid()}`
  try {
    for (let i = 0; i < parts; i++) {
      onStatus(`Subiendo ${file.name} (${i + 1}/${parts})…`)
      const { error } = await sb().storage.from('transfers').upload(`${prefix}.p${i}`, file.slice(i * PART, (i + 1) * PART), {
        upsert: true, contentType: 'application/octet-stream',
      })
      if (error) throw error
    }
    onStatus(`El dispositivo está guardando ${file.name}…`)
    await client.run('put_file', { path: destPath, storage: prefix, parts, size: file.size, v: 2 }, LONG)
  } finally { await removeParts(prefix, parts).catch(() => {}) }
}
