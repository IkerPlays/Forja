import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Gamepad2, Home, KanbanSquare, Monitor, Plug, Search, Settings, Tablet, Users, FileText } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useStudio } from '../context/StudioContext'
import { cn } from '../lib/util'
import type { ReactNode } from 'react'

interface Item { id: string; label: string; hint?: string; icon: ReactNode; to: string; group: string }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Búsqueda global (Ctrl/⌘+K o «/»): páginas, proyectos, juegos, dispositivos y tarjetas. */
export default function CommandPalette() {
  const { active, isMember } = useStudio()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [data, setData] = useState<Item[]>([])
  const [help, setHelp] = useState(false)
  const [cards, setCards] = useState<Item[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o) }
      else if (e.key === '/' && !typing) { e.preventDefault(); setOpen(true) }
      else if (e.key === '?' && !typing) { e.preventDefault(); setHelp(h => !h) }
      else if (e.key === 'Escape') { setOpen(false); setHelp(false) }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey); window.addEventListener('forja:palette', onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('forja:palette', onOpen) }
  }, [])

  useEffect(() => {
    if (!open) return
    setQ(''); setSel(0); setCards([])
    setTimeout(() => input.current?.focus(), 0)
    const pages: Item[] = [
      { id: 'p-home', label: 'Inicio', icon: <Home size={16} />, to: '/', group: 'Ir a' },
      { id: 'p-tasks', label: 'Tareas', icon: <KanbanSquare size={16} />, to: '/tasks', group: 'Ir a' },
      { id: 'p-cal', label: 'Calendario y mis tareas', icon: <CalendarDays size={16} />, to: '/calendar', group: 'Ir a' },
      ...(isMember ? [
        { id: 'p-3ds', label: '3DS', icon: <Tablet size={16} />, to: '/3ds', group: 'Ir a' },
        { id: 'p-games', label: 'Juegos', icon: <Gamepad2 size={16} />, to: '/games', group: 'Ir a' },
        { id: 'p-pc', label: 'Mi PC', icon: <Monitor size={16} />, to: '/games/pc', group: 'Ir a' },
        { id: 'p-notes', label: 'Notas', icon: <FileText size={16} />, to: '/notes', group: 'Ir a' },
        { id: 'p-team', label: 'Equipo', icon: <Users size={16} />, to: '/team', group: 'Ir a' },
        { id: 'p-conn', label: 'Conectar dispositivos', icon: <Plug size={16} />, to: '/connect', group: 'Ir a' },
      ] : []),
      { id: 'p-set', label: 'Ajustes', icon: <Settings size={16} />, to: '/settings', group: 'Ir a' },
    ]
    setData(pages)
    ;(async () => {
      const [pr, gm, dv] = await Promise.all([
        sb().from('projects').select('id,name,color').eq('archived', false).limit(100),
        active ? sb().from('games').select('id,name,platform').eq('studio_id', active.id).limit(100) : Promise.resolve({ data: [] }),
        active ? sb().from('devices').select('id,name,kind').eq('studio_id', active.id).limit(50) : Promise.resolve({ data: [] }),
      ])
      setData([
        ...pages,
        ...((pr.data ?? []) as { id: string; name: string }[]).map(p => ({ id: 'pr' + p.id, label: p.name, icon: <KanbanSquare size={16} />, to: `/tasks/${p.id}`, group: 'Proyectos' })),
        ...((gm.data ?? []) as { id: string; name: string }[]).map(g => ({ id: 'g' + g.id, label: g.name, icon: <Gamepad2 size={16} />, to: `/games/${g.id}`, group: 'Juegos' })),
        ...((dv.data ?? []) as { id: string; name: string; kind: string }[]).map(d => ({ id: 'd' + d.id, label: d.name, hint: d.kind === '3ds' ? '3DS' : 'PC', icon: d.kind === '3ds' ? <Tablet size={16} /> : <Monitor size={16} />, to: d.kind === '3ds' ? `/3ds/${d.id}` : `/games/pc/${d.id}`, group: 'Dispositivos' })),
      ])
    })()
  }, [open, active, isMember])

  // Tarjetas: se buscan en el servidor al escribir
  useEffect(() => {
    if (!open || q.trim().length < 2) { setCards([]); return }
    const t = setTimeout(async () => {
      const { data: rows } = await sb().from('cards').select('id,title,project_id,projects(name)').ilike('title', `%${q.trim()}%`).limit(8)
      setCards(((rows ?? []) as unknown as { id: string; title: string; project_id: string; projects: { name: string } | null }[])
        .map(c => ({ id: 'c' + c.id, label: c.title, hint: c.projects?.name, icon: <FileText size={16} />, to: `/tasks/${c.project_id}?card=${c.id}`, group: 'Tarjetas' })))
    }, 200)
    return () => clearTimeout(t)
  }, [q, open])

  const results = useMemo(() => {
    const nq = norm(q.trim())
    const base = nq ? data.filter(i => norm(i.label + ' ' + (i.hint ?? '')).includes(nq)) : data.filter(i => i.group === 'Ir a' || i.group === 'Proyectos').slice(0, 12)
    return [...base.slice(0, 14), ...cards]
  }, [q, data, cards])

  useEffect(() => { setSel(0) }, [q])
  if (help && !open) return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) setHelp(false) }}>
      <div className="modal" role="dialog" aria-label="Atajos de teclado" style={{ maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Atajos de teclado</h3>
        <dl className="shortcuts">
          <dt><kbd>Ctrl</kbd>+<kbd>K</kbd> · <kbd>/</kbd></dt><dd>Búsqueda global</dd>
          <dt><kbd>?</kbd></dt><dd>Esta ayuda</dd>
          <dt><kbd>Esc</kbd></dt><dd>Cerrar ventanas</dd>
          <dt><kbd>@</kbd></dt><dd>Mencionar en comentarios y chat</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>V</kbd></dt><dd>Pegar una captura en una tarjeta</dd>
        </dl>
      </div>
    </div>
  )
  if (!open) return null

  const go = (it: Item) => { setOpen(false); nav(it.to) }
  let lastGroup = ''
  return (
    <div className="modal-back top" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div className="palette" role="dialog" aria-label="Búsqueda global">
        <div className="palette-input"><Search size={17} />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar proyectos, tarjetas, juegos, dispositivos…"
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter' && results[sel]) go(results[sel])
            }} />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list">
          {results.map((r, i) => {
            const head = r.group !== lastGroup; lastGroup = r.group
            return (
              <li key={r.id}>
                {head && <div className="palette-group">{r.group}</div>}
                <button className={cn(i === sel && 'on')} onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                  {r.icon}<span>{r.label}</span>{r.hint && <small className="muted">{r.hint}</small>}
                </button>
              </li>
            )
          })}
          {!results.length && <li className="muted small empty-li">Sin resultados</li>}
        </ul>
      </div>
    </div>
  )
}
