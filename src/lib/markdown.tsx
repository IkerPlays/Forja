import type { ReactNode } from 'react'

/**
 * Markdown mínimo y SEGURO (sin dangerouslySetInnerHTML): títulos, **negrita**, *cursiva*, `código`, bloques ```,
 * listas (con casillas - [ ]), citas, enlaces http(s) y URLs sueltas.
 */
export type Inline = { t: 'text'; v: string } | { t: 'b' | 'i' | 'code' | 'mention'; v: string } | { t: 'a'; v: string; href: string }
export type Block =
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'ul' | 'ol'; items: { c: Inline[]; check?: boolean }[] }
  | { t: 'hr' }

const safeUrl = (u: string) => (/^https?:\/\/[^\s<>"']+$/i.test(u) ? u : null)

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(https?:\/\/[^\s<>"']+)|(@\[[^\]\n]{1,60}\])/g
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: 'text', v: src.slice(last, m.index) })
    const tok = m[0]
    if (m[1]) out.push({ t: 'code', v: tok.slice(1, -1) })
    else if (m[2]) out.push({ t: 'b', v: tok.slice(2, -2) })
    else if (m[3]) out.push({ t: 'i', v: tok.slice(1, -1) })
    else if (m[4]) { const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!; const href = safeUrl(mm[2]); out.push(href ? { t: 'a', v: mm[1], href } : { t: 'text', v: tok }) }
    else if (m[6]) out.push({ t: 'mention', v: tok.slice(2, -1) })
    else { const trail = /[.,;:!?)]+$/.exec(tok)?.[0] ?? ''; const url = trail ? tok.slice(0, -trail.length) : tok; const href = safeUrl(url); out.push(href ? { t: 'a', v: url, href } : { t: 'text', v: tok }); if (trail) out.push({ t: 'text', v: trail }) }
    last = m.index + tok.length
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) })
  return out
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => { if (para.length) { blocks.push({ t: 'p', c: parseInline(para.join('\n')) }); para = [] } }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^```/.test(l)) {
      flush(); const code: string[] = []
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i])
      blocks.push({ t: 'code', v: code.join('\n') }); continue
    }
    if (!l.trim()) { flush(); continue }
    let m: RegExpExecArray | null
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { flush(); blocks.push({ t: 'h', level: m[1].length as 1 | 2 | 3, c: parseInline(m[2]) }); continue }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { flush(); blocks.push({ t: 'hr' }); continue }
    if ((m = /^>\s?(.*)$/.exec(l))) { flush(); blocks.push({ t: 'quote', c: parseInline(m[1]) }); continue }
    if ((m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(l))) {
      flush()
      const ordered = /\d/.test(m[1]); const items: { c: Inline[]; check?: boolean }[] = []
      for (; i < lines.length; i++) {
        const mm = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]); if (!mm) { i--; break }
        const chk = /^\[( |x|X)\]\s+(.*)$/.exec(mm[2])
        items.push(chk ? { c: parseInline(chk[2]), check: chk[1] !== ' ' } : { c: parseInline(mm[2]) })
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items }); continue
    }
    para.push(l)
  }
  flush()
  return blocks
}

function inline(c: Inline[]): ReactNode[] {
  return c.map((n, i) => {
    switch (n.t) {
      case 'b': return <strong key={i}>{n.v}</strong>
      case 'i': return <em key={i}>{n.v}</em>
      case 'code': return <code key={i}>{n.v}</code>
      case 'mention': return <span key={i} className="mention">@{n.v}</span>
      case 'a': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow">{n.v}</a>
      default: return <span key={i}>{n.v}</span>
    }
  })
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`md ${className ?? ''}`}>
      {parseMarkdown(text).map((b, i) => {
        switch (b.t) {
          case 'h': { const H = (`h${b.level + 1}` as 'h2' | 'h3' | 'h4'); return <H key={i}>{inline(b.c)}</H> }
          case 'p': return <p key={i}>{inline(b.c)}</p>
          case 'quote': return <blockquote key={i}>{inline(b.c)}</blockquote>
          case 'code': return <pre key={i}><code>{b.v}</code></pre>
          case 'hr': return <hr key={i} />
          case 'ul': case 'ol': {
            const L = b.t
            return <L key={i}>{b.items.map((it, j) => <li key={j} className={it.check !== undefined ? 'task' : undefined}>{it.check !== undefined && <input type="checkbox" checked={it.check} readOnly />}{inline(it.c)}</li>)}</L>
          }
        }
      })}
    </div>
  )
}
