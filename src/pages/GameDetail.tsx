import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, FolderOpen, Gamepad2, GitBranch, KanbanSquare, Pencil, Trash2, Loader2 } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useStudio } from '../context/StudioContext'
import { PLATFORMS, STATUSES } from '../lib/games'
import type { Card, Device, Game, List, ProjectStats } from '../lib/types'
import GameForm from '../components/GameForm'
import { Empty, Progress, Spinner, useToast } from '../components/ui'
import { errMsg, formatDate } from '../lib/util'

export default function GameDetail() {
  const { gameId = '' } = useParams()
  const { active } = useStudio()
  const nav = useNavigate()
  const toast = useToast()
  const [game, setGame] = useState<Game | null | undefined>(undefined)
  const [devices, setDevices] = useState<Device[]>([])
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [open, setOpen] = useState<(Card & { list?: string })[]>([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data: g } = await sb().from('games').select('*').eq('id', gameId).maybeSingle()
    setGame((g as Game) ?? null)
    if (!g || !active) return
    const { data: d } = await sb().from('devices').select('*').eq('studio_id', active.id)
    setDevices((d ?? []) as Device[])
    if (g.project_id) {
      const [{ data: s }, { data: c }, { data: l }] = await Promise.all([
        sb().from('project_stats').select('*').eq('project_id', g.project_id).maybeSingle(),
        sb().from('cards').select('*').eq('project_id', g.project_id).eq('completed', false).order('due_date', { ascending: true, nullsFirst: false }).limit(8),
        sb().from('lists').select('*').eq('project_id', g.project_id),
      ])
      setStats((s as ProjectStats) ?? null)
      const names = Object.fromEntries(((l ?? []) as List[]).map(x => [x.id, x.name]))
      setOpen(((c ?? []) as Card[]).map(x => ({ ...x, list: names[x.list_id] })))
    } else { setStats(null); setOpen([]) }
  }, [gameId, active])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const ch = sb().channel(`game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, () => { void load() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, () => { void load() })
      .subscribe()
    return () => { void sb().removeChannel(ch) }
  }, [gameId, load])

  if (game === undefined) return <Spinner />
  if (!game) return <div className="page"><Empty title="Juego no encontrado" action={<Link to="/games" className="btn">Volver</Link>} /></div>

  const device = devices.find(d => d.id === game.device_id)

  async function createBoard() {
    setBusy(true)
    const { data, error } = await sb().rpc('create_project_for_game', { p_game: game!.id })
    setBusy(false)
    if (error) return toast(errMsg(error), 'err')
    toast('Tablero creado y sincronizado')
    nav(`/tasks/${data as string}`)
  }
  async function del() {
    if (!confirm(`¿Eliminar «${game!.name}» de la biblioteca? (Su tablero de tareas se conserva.)`)) return
    const { error } = await sb().from('games').delete().eq('id', game!.id)
    if (error) return toast(errMsg(error), 'err')
    nav('/games')
  }

  return (
    <div className="page">
      <Link to="/games" className="back"><ArrowLeft size={15} /> Juegos</Link>
      <div className="game-hero">
        <div className="cover big" style={game.cover_url ? { backgroundImage: `url(${game.cover_url})` } : undefined}>{!game.cover_url && <Gamepad2 size={48} />}</div>
        <div className="grow">
          <div className="row wrap">
            <h1>{game.name}</h1>
            <span className="status-pill static" style={{ background: STATUSES[game.status].color }}>{STATUSES[game.status].label}</span>
          </div>
          <p className="muted">{PLATFORMS[game.platform]}{game.version && ` · v${game.version}`}</p>
          {game.description && <p>{game.description}</p>}
          <div className="row wrap">
            {game.repo_url && <a className="btn sm" href={game.repo_url} target="_blank" rel="noreferrer noopener"><GitBranch size={14} /> Repositorio</a>}
            {game.store_url && <a className="btn sm" href={game.store_url} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> Tienda / descarga</a>}
            <button className="btn sm" onClick={() => setEditing(true)}><Pencil size={14} /> Editar</button>
            <button className="btn sm danger" onClick={del}><Trash2 size={14} /> Eliminar</button>
          </div>
        </div>
      </div>

      <div className="two-col">
        <section className="panel">
          <h2><KanbanSquare size={17} /> Tareas</h2>
          {game.project_id ? (
            <>
              <div className="row between"><span>{stats?.done ?? 0} de {stats?.total ?? 0} completadas{stats?.overdue ? ` · ${stats.overdue} vencidas` : ''}</span>
                <Link to={`/tasks/${game.project_id}`} className="btn sm primary">Abrir tablero</Link></div>
              <Progress value={stats?.done ?? 0} total={stats?.total ?? 0} />
              <ul className="mini-list">
                {open.map(c => (
                  <li key={c.id}><Link to={`/tasks/${game.project_id}`}>{c.title}</Link>
                    <small className="muted">{c.list}{c.due_date ? ` · ${formatDate(c.due_date)}` : ''}</small></li>
                ))}
                {!open.length && <li className="muted">No quedan tareas pendientes 🎉</li>}
              </ul>
            </>
          ) : (
            <>
              <p className="muted">Este juego aún no tiene tablero. Crea uno y quedará sincronizado: su progreso se verá aquí y en la biblioteca.</p>
              <button className="btn primary" onClick={createBoard} disabled={busy}>{busy && <Loader2 size={14} className="spin" />} Crear tablero de tareas</button>
            </>
          )}
        </section>

        <section className="panel">
          <h2><FolderOpen size={17} /> Dónde está</h2>
          {device ? (
            <>
              <p><strong>{device.name}</strong> · <code>{game.pc_path || '/'}</code></p>
              <Link className="btn" to={`${device.kind === 'pc' ? '/games/pc' : '/3ds'}/${device.id}?path=${encodeURIComponent(game.pc_path || '/')}`}>
                <FolderOpen size={15} /> Abrir carpeta en el dispositivo</Link>
            </>
          ) : <p className="muted">Sin dispositivo enlazado. Edita el juego para indicar en qué PC o 3DS está y su ruta.</p>}
        </section>
      </div>

      {editing && active && <GameForm studioId={active.id} game={game} devices={devices} onClose={() => setEditing(false)}
        onSaved={g => { setEditing(false); setGame(g); void load() }} />}
    </div>
  )
}
