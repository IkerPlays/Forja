import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronDown, Download, Gamepad2, Monitor, Tablet } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useStudio } from '../context/StudioContext'
import { isDesktop } from '../lib/native'
import { PageHeader, StatusDot, useTick } from '../components/ui'
import { isOnline } from '../lib/util'
import type { Device } from '../lib/types'

const RELEASE = 'https://github.com/IkerPlays/Forja/releases/latest'

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return <li className="step"><span className="step-n">{n}</span><div>{children}</div></li>
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return <details className="faq"><summary>{q}<ChevronDown size={15} /></summary><div className="muted">{children}</div></details>
}

/** Guía paso a paso para conectar cada tipo de dispositivo, con estado en vivo. */
export default function Connect() {
  const { active } = useStudio()
  const [devices, setDevices] = useState<Device[]>([])
  const now = useTick(8000)
  useEffect(() => {
    if (!active) return
    const load = () => sb().from('devices').select('*').eq('studio_id', active.id).then(({ data }) => setDevices((data ?? []) as Device[]))
    void load()
    const ch = sb().channel(`connect-${active.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `studio_id=eq.${active.id}` }, () => void load()).subscribe()
    return () => { void sb().removeChannel(ch) }
  }, [active])

  const pcs = devices.filter(d => d.kind === 'pc'), consoles = devices.filter(d => d.kind === '3ds')
  const status = (list: Device[]) => list.length
    ? list.map(d => <span key={d.id} className="chip"><StatusDot online={isOnline(d.last_seen, now)} /> {d.name}</span>)
    : <span className="muted small">Ninguno todavía</span>

  return (
    <div className="page narrow">
      <PageHeader title="Conectar dispositivos" sub="Tres formas de conectar, según el aparato. Todo se maneja desde aquí, la tablet o cualquier navegador." />

      <section className="panel">
        <h2><Tablet size={18} /> Esta tablet / cualquier navegador</h2>
        <p>No hay que instalar nada: es la pantalla desde la que controlas el resto. Entra en Forja con tu cuenta (puedes <em>instalarla</em> como app: Chrome → menú → «Instalar» / «Añadir a pantalla de inicio»).</p>
      </section>

      <section className="panel">
        <div className="row wrap"><h2><Monitor size={18} /> Tu PC</h2><div className="spacer" />{status(pcs)}</div>
        <p className="muted">La <strong>app de escritorio</strong> convierte tu PC en un dispositivo completo: archivos, pantalla en directo, ratón, teclado y táctil desde la tablet, y además enlaza tu 3DS por la red local.</p>
        {isDesktop ? (
          <p className="ok"><CheckCircle2 size={15} /> Ya estás usando la app de escritorio. Ajustes en <Link to="/this-pc">Este equipo</Link>.</p>
        ) : (
          <ol className="steps2">
            <Step n={1}><strong>Descarga e instala</strong> Forja para escritorio (Windows o Linux).
              <div className="row wrap" style={{ marginTop: 8 }}><a className="btn primary sm" href={RELEASE} target="_blank" rel="noreferrer noopener"><Download size={14} /> Descargar (GitHub Releases)</a></div>
              <small className="muted">Elige <code>Forja-Setup-….exe</code> (Windows) o <code>Forja-….AppImage</code> (Linux). Windows puede avisar de «editor desconocido»: <em>Más información → Ejecutar de todas formas</em>.</small></Step>
            <Step n={2}><strong>Abre Forja</strong> e inicia sesión con tu cuenta (la misma de la web).</Step>
            <Step n={3}>Pulsa <strong>Este equipo</strong> en el menú y elige qué compartes: carpetas o todo el equipo, pantalla, ratón/teclado.</Step>
            <Step n={4}>Listo: el PC aparece aquí en <strong>verde</strong>, en <Link to="/games/pc">Juegos → Mi PC</Link>. Ábrelo desde la tablet para ver la pantalla y controlarlo.</Step>
          </ol>
        )}
        <p className="muted small">Sin instalar nada también puedes compartir una carpeta desde el navegador (Chrome/Edge): <Link to="/games/pc">Juegos → Mi PC → Archivos → Elegir carpeta</Link>. Es más limitado: sin ratón, teclado ni pantalla.</p>
      </section>

      <section className="panel">
        <div className="row wrap"><h2><Gamepad2 size={18} /> Tu Nintendo 3DS</h2><div className="spacer" />{status(consoles)}</div>
        <p className="muted">La consola necesita la app <strong>Forja3DS</strong> (homebrew). Se empareja con un <strong>código</strong>, sin contraseñas.</p>
        <ol className="steps2">
          <Step n={1}>En Supabase activa <em>Authentication → Sign In / Providers → Allow anonymous sign-ins</em> (una vez).</Step>
          <Step n={2}><strong>Descarga</strong> <a href="/downloads/Forja3DS.cia" download>Forja3DS.cia</a> (instálala con FBI) o <a href="/downloads/Forja3DS.3dsx" download>Forja3DS.3dsx</a> (cópiala a <code>/3ds/</code> en la SD).</Step>
          <Step n={3}>Abre <strong>Forja3DS</strong> en la 3DS con WiFi: muestra un <strong>código de 6 caracteres</strong>.</Step>
          <Step n={4}>En <Link to="/3ds">3DS → Añadir</Link> escribe el código. Verás la consola en verde y podrás explorar su SD.</Step>
          <Step n={5}><em>(Opcional, para el mando y pantalla táctil)</em> Pon la IP de la 3DS en su ficha (Ajustes → Internet → Ajustes de conexión) y activa <strong>Input Redirection</strong> en Luma3DS (L+↓+Select → Rosalina). Con la app de escritorio abierta en tu PC, el mando funciona desde la tablet.</Step>
        </ol>
      </section>

      <section className="panel">
        <h2>¿No conecta?</h2>
        <Faq q="La 3DS dice «Sin conexión» / «No se pudo conectar»">
          Hasta la v0.3 la causa era que el SSL del sistema de la 3DS solo llega a TLS 1.1 y los servidores actuales exigen TLS 1.2. Desde la <strong>v0.5</strong> la app lleva su propio TLS, así que debería conectar por sí sola. Si aun así falla verás el código del error en pantalla. Plan B: abre la <strong>app de escritorio</strong> en un PC de la <em>misma WiFi</em> (puente local activado, viene así) y la 3DS lo encuentra sola; si no, toca «Escribir la IP del PC» y teclea la que ves en «Este equipo». En Windows, usa el botón «Abrir puertos en el cortafuegos».
        </Faq>
        <Faq q="La 3DS dice «Activa Allow anonymous sign-ins»">En Supabase → Authentication → Sign In / Providers, activa <em>Allow anonymous sign-ins</em> y reinicia la app de la 3DS.</Faq>
        <Faq q="El código de la 3DS no es válido">Caduca a los 30 minutos y solo vale una vez. Reabre Forja3DS para obtener uno nuevo y escríbelo sin espacios.</Faq>
        <Faq q="El PC sale en gris (sin conexión)">La app de escritorio debe estar abierta (puede estar en la bandeja) y con internet. Comprueba en «Este equipo» que pone «conectado».</Faq>
        <Faq q="Veo el PC pero la pantalla no carga">Comprueba que «Dejar ver la pantalla» está activo. Si estáis en redes distintas puede hacer falta un servidor TURN (<code>VITE_TURN_*</code> en Netlify).</Faq>
        <Faq q="Ejecuté 02_app.sql hace tiempo">Vuelve a ejecutarlo: es repetible y añade las funciones nuevas (emparejado, órdenes de dispositivos).</Faq>
      </section>
    </div>
  )
}
