import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Home, KanbanSquare, Gamepad2, Users, Settings as Cog, Tablet, LogOut, ChevronsUpDown, Check } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useStudio } from '../context/StudioContext'
import { Avatar } from './ui'
import { cn } from '../lib/util'

export default function Layout() {
  const { profile, signOut } = useAuth()
  const { studios, active, setActive, isMember } = useStudio()
  const [menu, setMenu] = useState(false)
  const loc = useLocation()

  const items = [
    { to: '/', label: 'Inicio', icon: Home, end: true, studio: true },
    { to: '/tasks', label: 'Tareas', icon: KanbanSquare },
    { to: '/3ds', label: '3DS', icon: Tablet, studio: true },
    { to: '/games', label: 'Juegos', icon: Gamepad2, studio: true },
    { to: '/team', label: 'Equipo', icon: Users, studio: true },
    { to: '/settings', label: 'Ajustes', icon: Cog },
  ].filter(i => !i.studio || isMember)

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Forja</span>
        </div>

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
          <button className="icon-btn" onClick={() => void signOut()} title="Cerrar sesión" aria-label="Cerrar sesión">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  )
}
