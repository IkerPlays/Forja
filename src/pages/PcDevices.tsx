import { Link } from 'react-router-dom'
import { Monitor, Plus } from 'lucide-react'
import DevicesPage from '../components/DevicesPage'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useStudio } from '../context/StudioContext'
import { useToast } from '../components/ui'
import { errMsg } from '../lib/util'

export default function PcDevices() {
  const { session } = useAuth()
  const { active } = useStudio()
  const toast = useToast()

  // En la carpeta de juegos del PC, cada subcarpeta se puede añadir como juego
  const dirActions = (deviceId: string) => (entry: { name: string }, path: string) => (
    <button className="icon-btn sm" title="Añadir como juego" aria-label="Añadir como juego" onClick={async () => {
      const { error } = await sb().from('games').insert({
        studio_id: active!.id, name: entry.name, platform: 'pc', device_id: deviceId, pc_path: path, created_by: session!.user.id,
      })
      if (error) toast(errMsg(error), 'err'); else toast(`«${entry.name}» añadido a Juegos`)
    }}><Plus size={15} /></button>
  )

  return (
    <>
      <DevicesPage kind="pc" base="/games/pc" icon={<Monitor size={28} />} title="Mi PC"
        sub="Explora sus carpetas, mira su pantalla y controla el ratón y el teclado." dirActions={dirActions} />
      <div className="page-foot"><Link to="/games" className="btn ghost">← Volver a Juegos</Link></div>
    </>
  )
}
