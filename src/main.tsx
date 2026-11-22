import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ToastProvider } from './components/ui'
import './styles.css'
import { applyAccent, applyTheme } from './lib/theme'

applyTheme()
applyAccent()

// Chrome/Edge/Android ofrecen «instalar» con este evento: se guarda para un botón en Ajustes
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); (window as unknown as { __installPrompt?: Event }).__installPrompt = e; window.dispatchEvent(new Event('forja:installable')) })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
