import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ListChecks } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PageHeader, Spinner } from '../components/ui'
import { cn, formatDate } from '../lib/util'
import type { Card, Project } from '../lib/types'

type Row = Card & { projects: Pick<Project, 'id' | 'name' | 'color'> | null }
const DAY = 86_400_000
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Calendario con las fechas límite de todos tus proyectos + «Mis tareas» agrupadas por urgencia. */
export default function CalendarPage() {
  const { session } = useAuth()
  const me = session!.user.id
  const [tab, setTab] = useState<'cal' | 'mine'>('cal')
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [rows, setRows] = useState<Row[] | null>(null)
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [onlyMine, setOnlyMine] = useState(false)

  const load = useCallback(async () => {
    const [c, a] = await Promise.all([
      sb().from('cards').select('*, projects(id,name,color)').not('due_date', 'is', null).order('due_date').limit(1000),
      sb().from('card_assignees').select('card_id').eq('user_id', me),
    ])
    setRows((c.data ?? []) as unknown as Row[])
    setMine(new Set(((a.data ?? []) as { card_id: string }[]).map(x => x.card_id)))
  }, [me])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const ch = sb().channel('calendar').on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, () => { void load() }).subscribe()
    return () => { void sb().removeChannel(ch) }
  }, [load])

  const visible = useMemo(() => (rows ?? []).filter(r => !onlyMine || mine.has(r.id)), [rows, mine, onlyMine])
  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of visible) { const k = key(new Date(r.due_date!)); m.set(k, [...(m.get(k) ?? []), r]) }
    return m
  }, [visible])

  if (!rows) return <Spinner />
  const today = startOfDay(new Date())

  // Cuadrícula del mes (semana empieza en lunes)
  const first = month
  const offset = (first.getDay() + 6) % 7
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i))

  // Mis tareas por urgencia
  const myOpen = (rows ?? []).filter(r => mine.has(r.id) && !r.completed)
  const group = (f: (d: number) => boolean) => myOpen.filter(r => f((startOfDay(new Date(r.due_date!)).getTime() - today.getTime()) / DAY))
  const groups: { title: string; list: Row[]; tone?: string }[] = [
    { title: 'Vencidas', list: group(d => d < 0), tone: 'overdue' },
    { title: 'Hoy', list: group(d => d === 0) },
    { title: 'Esta semana', list: group(d => d > 0 && d <= 7) },
    { title: 'Más adelante', list: group(d => d > 7) },
  ]

  const item = (r: Row) => (
    <Link key={r.id} to={`/tasks/${r.project_id}?card=${r.id}`} className={cn('cal-item', r.completed && 'done')} style={{ ['--c' as string]: r.projects?.color }} title={`${r.title} · ${r.projects?.name ?? ''}`}>
      {r.completed && <CheckCircle2 size={11} />}{r.title}
    </Link>
  )

  return (
    <div className="page">
      <PageHeader title="Calendario" sub="Las fechas límite de todos tus proyectos, y tus tareas por urgencia."
        actions={<div className="seg sm"><button className={tab === 'cal' ? 'on' : ''} onClick={() => setTab('cal')}><CalendarDays size={14} /> Calendario</button><button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}><ListChecks size={14} /> Mis tareas</button></div>} />

      {tab === 'cal' ? (
        <>
          <div className="row wrap cal-head">
            <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mes anterior"><ChevronLeft size={18} /></button>
            <h2 className="cal-title">{MONTHS[month.getMonth()]} {month.getFullYear()}</h2>
            <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Mes siguiente"><ChevronRight size={18} /></button>
            <button className="btn sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)) }}>Hoy</button>
            <div className="spacer" />
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} /> Solo las mías</label>
          </div>
          <div className="cal-grid">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => <div key={d} className="cal-dow">{d}</div>)}
            {days.map(d => {
              const list = byDay.get(key(d)) ?? []
              return (
                <div key={key(d)} className={cn('cal-day', d.getMonth() !== month.getMonth() && 'out', d.getTime() === today.getTime() && 'today')}>
                  <span className="cal-num">{d.getDate()}</span>
                  {list.slice(0, 3).map(item)}
                  {list.length > 3 && <small className="muted">+{list.length - 3} más</small>}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className="stack gap">
          {groups.map(g => (
            <section key={g.title} className="panel">
              <h2 className={g.tone}>{g.title} <small className="muted">{g.list.length}</small></h2>
              <ul className="mini-list">
                {g.list.map(r => (
                  <li key={r.id}><Link to={`/tasks/${r.project_id}?card=${r.id}`}>{r.title}</Link>
                    <small className="muted"><span className="swatch sm" style={{ background: r.projects?.color }} /> {r.projects?.name} · {formatDate(r.due_date)}</small></li>
                ))}
                {!g.list.length && <li className="muted">Nada aquí 🎉</li>}
              </ul>
            </section>
          ))}
          {!myOpen.length && <p className="muted small">Las tareas se te asignan desde la ficha de cada tarjeta (con fecha límite para que salgan aquí).</p>}
        </div>
      )}
    </div>
  )
}
