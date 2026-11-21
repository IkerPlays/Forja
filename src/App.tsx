import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { sb, supabase } from './lib/supabase'
import { AuthProvider, useAuth } from './context/AuthContext'
import { StudioProvider, useStudio } from './context/StudioContext'
import { Spinner } from './components/ui'
import Layout from './components/Layout'
import DesktopHostMount from './components/DesktopHostMount'
import Setup from './pages/Setup'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import Settings from './pages/Settings'

// Las pantallas pesadas se cargan solo cuando se abren
const Board = lazy(() => import('./pages/Board'))
const ThreeDS = lazy(() => import('./pages/ThreeDS'))
const Games = lazy(() => import('./pages/Games'))
const GameDetail = lazy(() => import('./pages/GameDetail'))
const PcDevices = lazy(() => import('./pages/PcDevices'))
const Team = lazy(() => import('./pages/Team'))
const Connect = lazy(() => import('./pages/Connect'))
const ThisPc = lazy(() => import('./pages/ThisPc'))

function Gate() {
  const { session, profile, loading } = useAuth()
  const { loading: studioLoading, isMember } = useStudio()
  const [needsOnboarding, setNeeds] = useOnboarding(isMember)

  if (loading) return <Spinner label="Cargando…" />
  if (!session) return <Login />
  if (!profile) return <Spinner label="Preparando tu cuenta…" />
  if (studioLoading) return <Spinner label="Cargando tu estudio…" />
  if (needsOnboarding) return <Onboarding onDone={() => setNeeds(false)} />

  return (
    <Suspense fallback={<Spinner />}>
      {isMember && <DesktopHostMount />}
      <Routes>
        <Route element={<Layout />}>
          <Route index element={isMember ? <Dashboard /> : <Navigate to="/tasks" replace />} />
          <Route path="tasks" element={<Projects />} />
          <Route path="tasks/:projectId" element={<Board />} />
          <Route path="settings" element={<Settings />} />
          {isMember && (
            <>
              <Route path="3ds" element={<ThreeDS />} />
              <Route path="3ds/:deviceId" element={<ThreeDS />} />
              <Route path="games" element={<Games />} />
              <Route path="games/pc" element={<PcDevices />} />
              <Route path="games/pc/:deviceId" element={<PcDevices />} />
              <Route path="games/:gameId" element={<GameDetail />} />
              <Route path="team" element={<Team />} />
              <Route path="connect" element={<Connect />} />
              <Route path="this-pc" element={<ThisPc />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}


/**
 * Si no perteneces a ningún estudio y tampoco tienes proyectos compartidos contigo,
 * te ofrece crear tu estudio. Un colaborador solo de Tareas entra directo.
 */
function useOnboarding(isMember: boolean): [boolean, (v: boolean) => void] {
  const [needs, setNeeds] = useState(false)
  const { loading } = useStudio()
  useEffect(() => {
    if (loading || isMember) { setNeeds(false); return }
    let alive = true
    sb().from('projects').select('id', { count: 'exact', head: true }).then(({ count }) => {
      if (alive) setNeeds(!count)
    })
    return () => { alive = false }
  }, [loading, isMember])
  return [needs, setNeeds]
}

export default function App() {
  if (!supabase) return <Setup />
  return (
    <AuthProvider>
      <StudioProvider>
        <Gate />
      </StudioProvider>
    </AuthProvider>
  )
}
