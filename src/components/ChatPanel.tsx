import { useEffect, useRef, useState } from 'react'
import { Send, X } from 'lucide-react'
import { sb } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { profileName, useProfiles } from '../lib/profiles'
import { Avatar, useToast } from './ui'
import { cn, errMsg, timeAgo } from '../lib/util'
import { Markdown } from '../lib/markdown'
import type { Message } from '../lib/types'

export default function ChatPanel({ projectId, messages, upsert, onClose }: {
  projectId: string; messages: Message[]; upsert: (k: "messages", r: any) => void; onClose: () => void
}) {
  const { session } = useAuth()
  const me = session!.user.id
  const toast = useToast()
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const profile = useProfiles(messages.map(m => m.user_id))
  const sorted = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at))

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    const { data, error } = await sb().from('project_messages').insert({ project_id: projectId, user_id: me, body }).select().single()
    if (error) { setText(body); return toast(errMsg(error), 'err') }
    upsert('messages', data as Message)
  }

  return (
    <aside className="chat">
      <header><h3>Chat del proyecto</h3><button className="icon-btn" onClick={onClose} aria-label="Cerrar chat"><X size={17} /></button></header>
      <div className="chat-msgs">
        {sorted.map((m, i) => {
          const mine = m.user_id === me
          const prev = sorted[i - 1]
          const showHead = !prev || prev.user_id !== m.user_id || new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60_000
          return (
            <div key={m.id} className={cn('msg', mine && 'mine')}>
              {showHead && !mine && <div className="msg-head"><Avatar profile={profile(m.user_id)} size={20} /> <strong>{profileName(profile(m.user_id))}</strong> <small className="muted">{timeAgo(m.created_at)}</small></div>}
              <div className="bubble"><Markdown text={m.body} className="inline-md" /></div>
            </div>
          )
        })}
        {!sorted.length && <p className="muted small center">Aún no hay mensajes. Saluda 👋</p>}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="inline-form">
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Escribe un mensaje…" />
        <button className="btn primary sm" disabled={!text.trim()} aria-label="Enviar"><Send size={15} /></button>
      </form>
    </aside>
  )
}
