import { ErrorBoundary, OfflineBanner } from './ErrorBoundary'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Home, KanbanSquare, Gamepad2, Users, Settings as Cog, Tablet, LogOut, ChevronsUpDown, Check, Plug, Monitor, CalendarDays, FileText, Search, Sun, Moon, SunMoon } from 'lucide-react'
import NotificationBell from './NotificationBell'
import CommandPalette from './CommandPalette'
import { getTheme, setTheme, type ThemePref } from '../lib/theme'
import { isDesktop } from '../lib/native'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useStudio } from '../context/StudioContext'
import { Avatar } from './ui'
import { cn } from '../lib/util'

export default function Layout() {
  const { profile, signOut } = useAuth()
  const { studios, active, setActive, isMember } = useStudio()
  const [menu, setMenu] = useState(false)
  const [theme, setThemeState] = useState<ThemePref>(getTheme())
  const cycle = () => { const n: ThemePref = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto'; setTheme(n); setThemeState(n) }
  const loc = useLocation()

  const items = [
    { to: '/', label: 'Inicio', icon: Home, end: true, studio: true },
    { to: '/tasks', label: 'Tareas', icon: KanbanSquare },
    { to: '/calendar', label: 'Calendario', icon: CalendarDays },
    { to: '/notes', label: 'Notas', icon: FileText, studio: true },
    { to: '/3ds', label: '3DS', icon: Tablet, studio: true },
    { to: '/games', label: 'Juegos', icon: Gamepad2, studio: true },
    { to: '/team', label: 'Equipo', icon: Users, studio: true },
    { to: '/connect', label: 'Conectar', icon: Plug, studio: true },
    ...(isDesktop ? [{ to: '/this-pc', label: 'Este equipo', icon: Monitor, studio: true }] : []),
    { to: '/settings', label: 'Ajustes', icon: Cog },
  ].filter(i => !i.studio || isMember)

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Forja</span>
          <span className="spacer" />
          <NotificationBell />
        </div>
        <button className="search-btn" onClick={() => window.dispatchEvent(new Event('forja:palette'))} aria-label="Buscar">
          <Search size={15} /><span>Buscar…</span><kbd>Ctrl K</kbd>
        </button>

        {isMember && active && (
          <div className="studio-switch">
            <button className="studio-btn" onClick={() => setMenu(m => !m)} aria-expanded={menu}>
              <span className="studio-name">{active.name}</span>
              {studios.length > 1 && <ChevronsUpDown size={14} />}
            </button>
            {menu && studios.length > 1 && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                {studios.map(s => (
                  <button key={s.id} onClick={() => { setActive(s.id); setMenu(false) }}>
                    {s.name} {s.id === active.id && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!isMember && <div className="studio-btn static"><span className="studio-name">Proyectos compartidos</span></div>}

        <nav className="nav">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => cn('nav-item', (isActive || (to !== '/' && loc.pathname.startsWith(to))) && 'active')}>
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="side-foot">
          <Avatar profile={profile} size={30} />
          <div className="who">
            <strong>{profile?.display_name || 'Tú'}</strong>
            <small className="muted">{profile?.email}</small>
          </div>
          <button className="icon-btn" onClick={cycle} title={`Tema: ${theme === 'auto' ? 'automático' : theme === 'dark' ? 'oscuro' : 'claro'}`} aria-label="Cambiar tema">{theme === 'auto' ? <SunMoon size={17} /> : theme === 'dark' ? <Moon size={17} /> : <Sun size={17} />}</button>
          <button className="icon-btn" onClick={() => void signOut()} title="Cerrar sesión" aria-label="Cerrar sesión">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="main"><OfflineBanner /><ErrorBoundary key={loc.pathname}><Outlet /></ErrorBoundary></main>
      <CommandPalette />
    </div>
  )
}
