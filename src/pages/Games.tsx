import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Gamepad2, Monitor, Plus, Search } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useStudio } from '../context/StudioContext'
import { PLATFORMS, STATUSES } from '../lib/games'
import type { Device, Game, ProjectStats } from '../lib/types'
import GameForm from '../components/GameForm'
import { Empty, PageHeader, Progress, Spinner } from '../components/ui'

export default function Games() {
  const { active } = useStudio()
  const nav = useNavigate()
  const [games, setGames] = useState<Game[] | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [stats, setStats] = useState<Record<string, ProjectStats>>({})
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!active) return
    const [g, d, s] = await Promise.all([
      sb().from('games').select('*').eq('studio_id', active.id).order('created_at', { ascending: false }),
      sb().from('devices').select('*').eq('studio_id', active.id),
      sb().from('project_stats').select('*'),
    ])
    setGames((g.data ?? []) as Game[]); setDevices((d.data ?? []) as Device[])
    setStats(Object.fromEntries(((s.data ?? []) as ProjectStats[]).map(x => [x.project_id, x])))
  }, [active])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!active) return
    const ch = sb().channel(`games-${active.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `studio_id=eq.${active.id}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, () => { void load() })
      .subscribe()
    return () => { void sb().removeChannel(ch) }
  }, [active, load])

  const [sort, setSort] = useState<'recent' | 'name' | 'status'>('recent')
  const shown = useMemo(() => {
    const list = (games ?? []).filter(g =>
      (!status || g.status === status) && (!q || g.name.toLowerCase().includes(q.toLowerCase())))
    if (sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name, 'es'))
    if (sort === 'status') return [...list].sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name, 'es'))
    return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [games, q, status, sort])

  if (!active || !games) return <Spinner />

  return (
    <div className="page">
      <PageHeader title="Juegos" sub="Tu biblioteca, sincronizada con Tareas y con tu PC."
        actions={<>
          {games.length > 0 && <button className="btn" onClick={() => {
            const q = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
            const csv = ['Nombre,Plataforma,Estado,Versión,Repositorio,Tienda', ...games.map(g => [g.name, g.platform, STATUSES[g.status]?.label ?? g.status, g.version, g.repo_url, g.store_url].map(q).join(','))].join('\r\n')
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = 'juegos.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
          }}>Exportar CSV</button>}
          <Link to="/games/pc" className="btn"><Monitor size={16} /> Mi PC</Link>
          <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Nuevo juego</button>
        </>} />

      {games.length > 0 && (
        <div className="filters">
          <div className="search"><Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar juego…" /></div>
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Estado">
            <option value="">Todos los estados</option>
            {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as 'recent' | 'name' | 'status')} aria-label="Ordenar">
            <option value="recent">Más recientes</option>
            <option value="name">Nombre (A–Z)</option>
            <option value="status">Por estado</option>
          </select>
        </div>
      )}

      {!games.length ? (
        <Empty icon={<Gamepad2 size={28} />} title="Aún no hay juegos"
          text="Añádelos a mano o impórtalos desde las carpetas de tu PC (Mi PC → botón + junto a cada carpeta)."
          action={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Añadir el primero</button>} />
      ) : (
        <div className="grid games">
          {shown.map(g => {
            const st = g.project_id ? stats[g.project_id] : undefined
            return (
              <Link key={g.id} to={`/games/${g.id}`} className="card-tile game-tile">
                <div className="cover" style={g.cover_url ? { backgroundImage: `url(${g.cover_url})` } : undefined}>
                  {!g.cover_url && <Gamepad2 size={34} />}
                  <span className="status-pill" style={{ background: STATUSES[g.status].color }}>{STATUSES[g.status].label}</span>
                </div>
                <div className="game-info">
                  <h3>{g.name}</h3>
                  <small className="muted">{PLATFORMS[g.platform]}{g.version && ` · v${g.version}`}</small>
                  {g.project_id ? (
                    <div className="tile-foot"><Progress value={st?.done ?? 0} total={st?.total ?? 0} /><small className="muted">{st?.total ? `${st.done}/${st.total} tareas` : 'Sin tareas'}</small></div>
                  ) : <small className="muted">Sin tablero de tareas</small>}
                </div>
              </Link>
            )
          })}
        </div>
      )}
      {creating && <GameForm studioId={active.id} devices={devices} onClose={() => setCreating(false)} onSaved={g => { setCreating(false); nav(`/games/${g.id}`) }} />}
    </div>
  )
}
