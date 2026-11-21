import { useEffect, useState } from 'react'
import { FolderCheck, FolderOpen, Power } from 'lucide-react'
import { getAgent, loadHandle, pcAgentSupported, PcFolderAgent, saveHandle, startAgent, stopAgent } from '../lib/pcAgent'
import { useToast } from './ui'
import { errMsg } from '../lib/util'

/** Comparte una carpeta de este PC con Forja directamente desde el navegador (sin bridge). */
export default function PcFolderPanel({ deviceId }: { deviceId: string }) {
  const toast = useToast()
  const [agent, setAgent] = useState<PcFolderAgent | undefined>(() => getAgent(deviceId))
  const [saved, setSaved] = useState<{ name: string } | null>(null)
  const [last, setLast] = useState('')

  useEffect(() => { void loadHandle(deviceId).then(h => setSaved(h)) }, [deviceId])
  useEffect(() => { if (agent) agent.onLog = setLast }, [agent])

  async function begin(handle: any) {
    const a = new PcFolderAgent(deviceId, handle)
    startAgent(a); setAgent(a); setSaved(handle)
  }
  async function pick() {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'forja' })
      await saveHandle(deviceId, handle); await begin(handle)
    } catch (e) { if ((e as Error).name !== 'AbortError') toast(errMsg(e), 'err') }
  }
  async function resume() {
    try {
      const h = await loadHandle(deviceId)
      if (!h) return pick()
      if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return toast('Permiso denegado', 'err')
      await begin(h)
    } catch (e) { toast(errMsg(e), 'err') }
  }

  if (!pcAgentSupported()) {
    return <div className="callout">Para compartir una carpeta de este PC sin instalar nada necesitas <strong>Chrome o Edge de escritorio</strong>. Desde la tablet puedes ver y gestionar sus archivos una vez compartida.</div>
  }

  return (
    <div className="callout">
      {agent ? (
        <div className="row wrap">
          <FolderCheck size={18} className="ok" />
          <span><strong>Compartiendo «{agent.root.name}»</strong> con tu estudio. Mantén esta pestaña de Forja abierta en este PC.{last && <small className="muted"> · {last}</small>}</span>
          <div className="spacer" />
          <button className="btn sm danger" onClick={() => { stopAgent(deviceId); setAgent(undefined) }}><Power size={14} /> Dejar de compartir</button>
        </div>
      ) : (
        <div className="row wrap">
          <FolderOpen size={18} />
          <span>Elige la carpeta de este PC que quieres ver desde Forja (por ejemplo tu carpeta de juegos). Solo se comparte esa carpeta y solo mientras esta pestaña esté abierta.</span>
          <div className="spacer" />
          {saved && <button className="btn sm" onClick={resume}>Reanudar «{saved.name}»</button>}
          <button className="btn sm primary" onClick={pick}><FolderOpen size={14} /> Elegir carpeta</button>
        </div>
      )}
    </div>
  )
}
