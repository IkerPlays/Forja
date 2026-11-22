import { Component, useEffect, useState, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error) { console.error('Forja:', err) }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="page"><div className="panel stack" role="alert">
        <h2>Algo ha fallado en esta pantalla</h2>
        <p className="muted small">{this.state.err.message}</p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" onClick={() => this.setState({ err: null })}>Reintentar</button>
          <button className="btn" onClick={() => location.reload()}>Recargar la app</button>
        </div>
      </div></div>
    )
  }
}

/** Aviso cuando el navegador pierde la conexión a internet. */
export function OfflineBanner() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const u = () => setOn(true), d = () => setOn(false)
    window.addEventListener('online', u); window.addEventListener('offline', d)
    return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d) }
  }, [])
  if (on) return null
  return <div className="offline-banner" role="status">Sin conexión a internet · los cambios no se guardarán hasta que vuelva</div>
}
