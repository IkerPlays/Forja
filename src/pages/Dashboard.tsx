import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Gamepad2, KanbanSquare, Monitor, Tablet } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useStudio } from '../context/StudioContext'
import { profileName, useProfiles } from '../lib/profiles'
import { STATUSES } from '../lib/games'
import type { Activity, Card, Device, Game, Project } from '../lib/types'
import { Avatar, PageHeader, Spinner, StatusDot, useTick } from '../components/ui'
import { formatDate, isOnline, timeAgo } from '../lib/util'

type MyCard = Card & { projects: Pick<Project, 'id' | 'name' | 'color'> | null }

const VERB: Record<string, string> = {
  card_created: 'creó la tarjeta', card_moved: 'movió', card_completed: 'completó', card_reopened: 'reabrió', comment: 'comentó en',
}

export default function Dashboard() {
  const { profile, session } = useAuth()
  const { active } = useStudio()
  const now = useTick(15000)
  const [mine, setMine] = useState<MyCard[] | null>(null)
  const [acts, setActs] = useState<Activity[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [counts, setCounts] = useState({ projects: 0, open: 0, overdue: 0 })
  const [week, setWeek] = useState<number[]>([])
  const profileOf = useProfiles(acts.map(a => a.user_id))

  useEffect(() => {
    if (!active || !session) return
    let alive = true
    const load = async () => {
      const [as, ac, dv, gm, pr, op, od] = await Promise.all([
        sb().from('card_assignees').select('card_id').eq('user_id', session.user.id),
        sb().from('activity').select('*').eq('studio_id', active.id).order('created_at', { ascending: false }).limit(12),
        sb().from('devices').select('*').eq('studio_id', active.id),
        sb().from('games').select('*').eq('studio_id', active.id).order('updated_at', { ascending: false }).limit(6),
        sb().from('projects').select('id', { count: 'exact', head: true }).eq('studio_id', active.id).eq('archived', false),
        sb().from('project_stats').select('total, done'),
        sb().from('project_stats').select('overdue'),
      ])
      const ids = ((as.data ?? []) as { card_id: string }[]).map(x => x.card_id)
      const cards = ids.length
        ? await sb().from('cards').select('*, projects(id,name,color)').in('id', ids).eq('completed', false).order('due_date', { ascending: true, nullsFirst: false }).limit(10)
        : { data: [] }
      const since = new Date(Date.now() - 13 * 86_400_000); since.setHours(0, 0, 0, 0)
      const done = await sb().from('cards').select('completed_at').eq('completed', true).gte('completed_at', since.toISOString()).limit(2000)
      const days = Array.from({ length: 14 }, () => 0)
      for (const r of (done.data ?? []) as { completed_at: string }[]) { const i = Math.floor((new Date(r.completed_at).getTime() - since.getTime()) / 86_400_000); if (i >= 0 && i < 14) days[i]++ }
      if (!alive) return
      setWeek(days)
      setMine((cards.data ?? []) as unknown as MyCard[])
      setActs((ac.data ?? []) as Activity[]); setDevices((dv.data ?? []) as Device[]); setGames((gm.data ?? []) as Game[])
      setCounts({
        projects: pr.count ?? 0,
        open: ((op.data ?? []) as { total: number; done: number }[]).reduce((n, x) => n + x.total - x.done, 0),
        overdue: ((od.data ?? []) as { overdue: number }[]).reduce((n, x) => n + x.overdue, 0),
      })
    }
    void load()
    const ch = sb().channel(`dash-${active.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity', filter: `studio_id=eq.${active.id}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `studio_id=eq.${active.id}` }, () => { void load() })
      .subscribe()
    return () => { alive = false; void sb().removeChannel(ch) }
  }, [active, session])

  if (!active || !mine) return <Spinner />
  const hour = new Date().getHours()
  const hi = hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="page">
      <PageHeader title={`${hi}, ${(profile?.display_name || '').split(' ')[0] || 'creador'}`} sub={`Esto es lo que pasa en ${active.name}.`} />

      <div className="stats">
        <Link to="/tasks" className="stat"><KanbanSquare size={20} /><strong>{counts.projects}</strong><span>proyectos</span></Link>
        <Link to="/tasks" className="stat"><CalendarDays size={20} /><strong>{counts.open}</strong><span>tareas abiertas{counts.overdue ? ` · ${counts.overdue} vencidas` : ''}</span></Link>
        <Link to="/games" className="stat"><Gamepad2 size={20} /><strong>{games.length}</strong><span>juegos recientes</span></Link>
        <Link to="/3ds" className="stat"><Tablet size={20} /><strong>{devices.filter(d => isOnline(d.last_seen, now)).length}/{devices.length}</strong><span>dispositivos en línea</span></Link>
      </div>

      <div className="dash-grid">
        <section className="panel">
          <h2>Mis tareas</h2>
          <ul className="mini-list">
            {mine.map(c => (
              <li key={c.id}>
                <Link to={`/tasks/${c.project_id}`}>{c.title}</Link>
                <small className="muted"><span className="swatch sm" style={{ background: c.projects?.color }} /> {c.projects?.name}{c.due_date ? ` · ${formatDate(c.due_date)}` : ''}</small>
              </li>
            ))}
            {!mine.length && <li className="muted">No tienes tareas asignadas pendientes.</li>}
          </ul>
        </section>

        <section className="panel">
          <h2>Actividad reciente</h2>
          <ul className="activity">
            {acts.map(a => (
              <li key={a.id}>
                <Avatar profile={profileOf(a.user_id)} size={24} />
                <span><strong>{profileName(profileOf(a.user_id))}</strong> {VERB[a.kind] ?? a.kind} <em>{a.title}</em>
                  {a.kind === 'card_moved' && <> a <strong>{String(a.meta.to ?? '')}</strong></>}
                  {a.kind === 'comment' && a.meta.excerpt ? <>: “{String(a.meta.excerpt)}”</> : null}
                  <small className="muted"> · {timeAgo(a.created_at)}</small></span>
              </li>
            ))}
            {!acts.length && <li className="muted">Todavía no hay actividad.</li>}
          </ul>
        </section>

        <section className="panel">
          <h2>Tareas completadas · 14 días</h2>
          {week.some(n => n) ? (
            <div className="chart" role="img" aria-label="Tareas completadas por día">
              {week.map((n, i) => { const max = Math.max(...week, 1); const d = new Date(Date.now() - (13 - i) * 86_400_000); return <div key={i} title={`${d.toLocaleDateString('es')}: ${n}`}><span>{n || ''}</span><i style={{ height: `${Math.max(4, (n / max) * 70)}%` }} /></div> })}
            </div>
          ) : <p className="muted small">Cuando completes tarjetas verás aquí tu ritmo.</p>}
        </section>

        <section className="panel">
          <h2>Dispositivos</h2>
          <ul className="mini-list">
            {devices.map(d => (
              <li key={d.id}>
                <Link to={`${d.kind === 'pc' ? '/games/pc' : '/3ds'}/${d.id}`}><StatusDot online={isOnline(d.last_seen, now)} /> {d.name}</Link>
                <small className="muted">{d.kind === '3ds' ? <Tablet size={12} /> : <Monitor size={12} />} {d.kind === '3ds' ? '3DS' : 'PC'}</small>
              </li>
            ))}
            {!devices.length && <li className="muted">Añade tu 3DS o tu PC desde 3DS / Juegos → Mi PC.</li>}
          </ul>
        </section>

        <section className="panel">
          <h2>Juegos</h2>
          <ul className="mini-list">
            {games.map(g => (
              <li key={g.id}><Link to={`/games/${g.id}`}>{g.name}</Link><small className="muted"><span className="swatch sm" style={{ background: STATUSES[g.status].color }} /> {STATUSES[g.status].label}</small></li>
            ))}
            {!games.length && <li className="muted">Aún no hay juegos.</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}
