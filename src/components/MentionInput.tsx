import { useMemo, useRef, useState } from 'react'
import type { Profile } from '../lib/types'
import { profileName } from '../lib/profiles'
import { Avatar } from './ui'
import { cn } from '../lib/util'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Campo de texto con autocompletado de menciones: al escribir «@» sugiere a las personas del proyecto e inserta @[Nombre]. */
export default function MentionInput({ value, onChange, people, placeholder, className, ...rest }: {
  value: string; onChange: (v: string) => void; people: Profile[]; placeholder?: string; className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLInputElement>(null)
  const [token, setToken] = useState<{ start: number; q: string } | null>(null)
  const [sel, setSel] = useState(0)

  const matches = useMemo(() => {
    if (!token) return []
    const q = norm(token.q)
    return people.filter(p => !q || norm(profileName(p)).includes(q)).slice(0, 6)
  }, [token, people])

  function detect(text: string, caret: number) {
    const m = /(^|\s)@([^\s@[\]]{0,30})$/.exec(text.slice(0, caret))
    setToken(m ? { start: caret - m[2].length - 1, q: m[2] } : null); setSel(0)
  }
  function pick(p: Profile) {
    if (!token) return
    const caret = ref.current?.selectionStart ?? value.length
    const insert = `@[${profileName(p)}] `
    const next = value.slice(0, token.start) + insert + value.slice(caret)
    onChange(next); setToken(null)
    requestAnimationFrame(() => { const pos = token.start + insert.length; ref.current?.setSelectionRange(pos, pos); ref.current?.focus() })
  }

  return (
    <div className="mention-wrap">
      <input ref={ref} {...rest} className={className} value={value} placeholder={placeholder}
        onChange={e => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart ?? e.target.value.length) }}
        onKeyDown={e => {
          if (token && matches.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => (s + 1) % matches.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => (s - 1 + matches.length) % matches.length); return }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[sel]); return }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setToken(null); return }
          }
          rest.onKeyDown?.(e)
        }}
        onBlur={() => setTimeout(() => setToken(null), 150)} />
      {token && matches.length > 0 && (
        <ul className="mention-list" role="listbox">
          {matches.map((p, i) => (
            <li key={p.id}><button type="button" role="option" aria-selected={i === sel} className={cn(i === sel && 'on')} onMouseDown={e => { e.preventDefault(); pick(p) }}>
              <Avatar profile={p} size={20} /> {profileName(p)}</button></li>
          ))}
        </ul>
      )}
    </div>
  )
}
