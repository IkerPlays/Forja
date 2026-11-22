
import assert from 'node:assert/strict'
import { parseMarkdown, parseInline } from '../src/lib/markdown'
import { parseTrello } from '../src/lib/trello'

// --- Markdown
const b = parseMarkdown('# Título\n\nHola **mundo** y *tú* con `código` y https://forja.app/x.\n\n- uno\n- [x] hecho\n- [ ] pendiente\n\n1. a\n2. b\n\n> cita\n\n```\nlinea1\nlinea2\n```\n---')
assert.equal(b[0].t, 'h'); assert.equal((b[0] as any).level, 1)
const p = b[1] as any; assert.equal(p.t, 'p'); assert.ok(p.c.some((n: any) => n.t === 'b' && n.v === 'mundo')); assert.ok(p.c.some((n: any) => n.t === 'i' && n.v === 'tú')); assert.ok(p.c.some((n: any) => n.t === 'code'))
const link = p.c.find((n: any) => n.t === 'a'); assert.equal(link.href, 'https://forja.app/x'); assert.ok(p.c.some((n: any) => n.t === 'text' && n.v === '.'))
const ul = b.find(x => x.t === 'ul') as any; assert.deepEqual(ul.items.map((i: any) => i.check), [undefined, true, false])
assert.equal((b.find(x => x.t === 'ol') as any).items.length, 2); assert.equal(b.find(x => x.t === 'quote') != null, true)
assert.equal((b.find(x => x.t === 'code') as any).v, 'linea1\nlinea2'); assert.equal(b[b.length - 1].t, 'hr')
const mention = parseInline('Hola @[Iker Demo], revisa esto @[Ana]'); assert.deepEqual(mention.filter((n: any) => n.t === 'mention').map((n: any) => n.v), ['Iker Demo', 'Ana'])
assert.ok(parseInline('correo a@b.com y @sin_corchetes').every((n: any) => n.t !== 'mention'))
// seguridad: nada de javascript: ni HTML
const evil = parseInline('[x](javascript:alert(1)) <img src=x onerror=alert(1)> [ok](https://a.com)')
assert.ok(!evil.some((n: any) => n.t === 'a' && /javascript/.test(n.href))); assert.ok(evil.some((n: any) => n.t === 'a' && n.href === 'https://a.com'))
assert.ok(evil.every((n: any) => n.t !== 'a' || /^https?:/.test(n.href)))

// --- Trello
const trello = {
  name: 'Mi juego', desc: 'desc',
  labels: [{ id: 'L1', name: 'Bug', color: 'red' }, { id: 'L2', name: '', color: 'blue' }, { id: 'L3', name: '', color: null }],
  lists: [{ id: 'a', name: 'Por hacer', pos: 2, closed: false }, { id: 'b', name: 'Hecho', pos: 3, closed: false }, { id: 'c', name: 'Vieja', pos: 1, closed: true }, { id: 'd', name: 'Ideas', pos: 0.5, closed: false }],
  cards: [
    { id: 'c1', idList: 'a', name: 'Tarjeta 1', desc: 'texto', pos: 2, closed: false, due: '2026-12-01T10:00:00.000Z', dueComplete: false, idLabels: ['L1', 'L3'], },
    { id: 'c2', idList: 'a', name: 'Tarjeta 0', desc: '', pos: 1, closed: false, due: null, dueComplete: false, idLabels: [] },
    { id: 'c3', idList: 'b', name: 'Hecha', desc: '', pos: 1, closed: false, due: '2026-11-01T00:00:00.000Z', dueComplete: true, idLabels: ['L2'] },
    { id: 'c4', idList: 'c', name: 'En lista archivada', pos: 1, closed: false, idLabels: [] },
    { id: 'c5', idList: 'a', name: 'Archivada', pos: 3, closed: true, idLabels: [] },
  ],
  checklists: [{ id: 'k', idCard: 'c1', checkItems: [{ name: 'B', state: 'incomplete', pos: 2 }, { name: 'A', state: 'complete', pos: 1 }] }],
}
const t = parseTrello(trello)
assert.deepEqual(t.lists.map(l => l.name), ['Ideas', 'Por hacer', 'Hecho'])       // ordenadas por pos, sin la archivada
assert.deepEqual(t.cards.map(c => c.title), ['Tarjeta 0', 'Hecha', 'Tarjeta 1'])  // por pos (el orden solo importa dentro de cada lista), sin archivadas
assert.equal(t.cards.find(c => c.title === 'Tarjeta 1')!.list, 1); assert.ok(t.cards.findIndex(c => c.title === 'Tarjeta 0') < t.cards.findIndex(c => c.title === 'Tarjeta 1')); assert.equal(t.cards.find(c => c.title === 'Hecha')!.completed, true)
assert.deepEqual(t.cards.find(c => c.title === 'Tarjeta 1')!.checklist, [{ text: 'A', done: true }, { text: 'B', done: false }])
assert.deepEqual(t.labels.map(l => [l.name, l.color]), [['Bug', '#ef4444'], ['', '#3b82f6']]); assert.deepEqual(t.cards.find(c => c.title === 'Tarjeta 1')!.labels, ['L1']); assert.deepEqual(t.cards.find(c => c.title === 'Hecha')!.labels, ['L2'])
assert.deepEqual(t.skipped, { lists: 1, cards: 2 })
assert.equal(parseTrello(trello, true).lists.length, 4)
assert.throws(() => parseTrello({ foo: 1 }), /Trello/)

// --- Envío con tope de frecuencia (mando/ratón): nunca se pierde el último estado y se respeta el orden
import { Coalescer } from '../src/lib/coalesce'
{
  const sent: number[] = []
  const c = new Coalescer<number>(v => sent.push(v))
  const t0 = Date.now()
  for (let i = 1; i <= 100; i++) { c.push('pad', i, 40); await new Promise(r => setTimeout(r, 2)) }   // ~200 ms a 500 envíos/s
  await new Promise(r => setTimeout(r, 120))
  const elapsed = Date.now() - t0
  assert.equal(sent[sent.length - 1], 100)                                        // el último estado SIEMPRE llega
  assert.ok(sent.length <= Math.ceil(elapsed / 40) + 2, `demasiados envíos: ${sent.length} en ${elapsed} ms`)   // ≤ ~25/s
  assert.ok(sent.every((v, i) => i === 0 || v > sent[i - 1]))                      // sin desorden
  // dos claves independientes + flush: lo pendiente sale ya
  const out: string[] = []
  const c2 = new Coalescer<string>(v => out.push(v))
  c2.push('move', 'm1', 1000); c2.push('move', 'm2', 1000)                         // m1 sale ya; m2 queda esperando
  c2.push('other', 'o1', 1000)
  assert.deepEqual(out, ['m1', 'o1']); c2.flush(); assert.deepEqual(out, ['m1', 'o1', 'm2']); c2.dispose()
}
console.log('✔ markdown, trello y envío con tope: todas las pruebas pasan')
