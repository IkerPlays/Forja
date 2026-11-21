import { Tablet } from 'lucide-react'
import DevicesPage from '../components/DevicesPage'

export default function ThreeDS() {
  return <DevicesPage kind="3ds" base="/3ds" icon={<Tablet size={28} />} title="Nintendo 3DS"
    sub="Archivos, mando y pantalla en tiempo real de tu 3DS." />
}
