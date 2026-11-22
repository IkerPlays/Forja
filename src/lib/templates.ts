import type { BoardData } from './board'
import type { TrelloImport } from './trello'

export interface Template { id: string; name: string; description: string; build: () => Omit<TrelloImport, 'name' | 'description' | 'skipped'> | null }

const L = (names: string[]) => names.map(name => ({ name }))
const lab = (name: string, color: string) => ({ key: name, name, color })
const card = (list: number, title: string, description = '', checklist: string[] = [], labels: string[] = []) =>
  ({ list, title, description, due: null, completed: false, labels, checklist: checklist.map(text => ({ text, done: false })) })

/** Plantillas para proyectos nuevos. «Vacío» usa las listas por defecto de la base de datos. */
export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Vacío', description: 'Ideas · Por hacer · En curso · Hecho', build: () => null },
  {
    id: 'game', name: 'Videojuego', description: 'Del concepto a la publicación',
    build: () => ({
      lists: L(['Ideas', 'Diseño', 'Programación', 'Arte y audio', 'Pruebas', 'Hecho']),
      labels: [lab('Bug', '#ef4444'), lab('Mejora', '#3b82f6'), lab('Arte', '#a855f7'), lab('Sonido', '#f59e0b'), lab('Diseño', '#38bdf8'), lab('Urgente', '#f97316')],
      cards: [
        card(0, 'Concepto del juego', '**Qué** es, **para quién** y **por qué** es divertido (3 frases).', ['Pitch en una frase', 'Referencias', 'Público objetivo']),
        card(1, 'Mecánica principal', 'Define el bucle de juego de 30 segundos.', ['Controles', 'Reglas', 'Condición de victoria/derrota']),
        card(2, 'Prototipo jugable', '', ['Moverse', 'Interactuar', 'Primer nivel de prueba'], ['Diseño']),
        card(3, 'Estilo visual y paleta', '', [], ['Arte']),
        card(4, 'Plan de pruebas', 'Qué se prueba en cada versión y con quién.', ['Lista de bugs conocidos', 'Pruebas con 3 personas']),
      ],
    }),
  },
  {
    id: 'sprint', name: 'Sprint semanal', description: 'Backlog · Esta semana · En curso · Revisión · Hecho',
    build: () => ({
      lists: L(['Backlog', 'Esta semana', 'En curso', 'Revisión', 'Hecho']),
      labels: [lab('Bug', '#ef4444'), lab('Mejora', '#3b82f6'), lab('Urgente', '#f97316')],
      cards: [card(1, 'Objetivo de la semana', 'Una frase: ¿qué tiene que estar terminado el viernes?'), card(4, 'Retrospectiva', '', ['Qué fue bien', 'Qué mejorar', 'Una acción para la próxima'])],
    }),
  },
  {
    id: 'launch', name: 'Lanzamiento', description: 'Checklist para publicar un juego',
    build: () => ({
      lists: L(['Pendiente', 'Tienda', 'Marketing', 'QA final', 'Publicado']),
      labels: [lab('Tienda', '#38bdf8'), lab('Marketing', '#e879a8'), lab('Legal', '#94a3b8'), lab('Urgente', '#f97316')],
      cards: [
        card(1, 'Página de la tienda', '', ['Título y descripción', 'Capturas (mín. 5)', 'Tráiler', 'Icono y portada', 'Clasificación por edades'], ['Tienda']),
        card(2, 'Plan de comunicación', '', ['Anuncio', 'Redes sociales', 'Nota de prensa'], ['Marketing']),
        card(3, 'Pruebas finales', '', ['Instalar desde cero', 'Guardado/carga', 'Rendimiento'], []),
        card(0, 'Política de privacidad y licencias', '', [], ['Legal']),
      ],
    }),
  },
]

/** Convierte un tablero abierto en datos importables (duplicar proyecto). */
export function boardToImport(b: BoardData, withCards: boolean): Omit<TrelloImport, 'description' | 'skipped'> {
  const lists = [...b.lists].sort((a, c) => a.position - c.position)
  const idx = new Map(lists.map((l, i) => [l.id, i]))
  const cards = withCards
    ? [...b.cards].sort((a, c) => a.position - c.position).filter(c => idx.has(c.list_id)).map(c => ({
        list: idx.get(c.list_id)!, title: c.title, description: c.description, due: c.due_date, completed: false,
        labels: b.cardLabels.filter(cl => cl.card_id === c.id).map(cl => cl.label_id),
        checklist: b.checklist.filter(i => i.card_id === c.id).sort((a, d) => a.position - d.position).map(i => ({ text: i.text, done: false })),
      }))
    : []
  return { name: `Copia de ${b.project?.name ?? 'proyecto'}`.slice(0, 120), labels: b.labels.map(l => ({ key: l.id, name: l.name, color: l.color })), lists: lists.map(l => ({ name: l.name })), cards }
}
