import { el, iconButton, overlayHost, textButton } from './gitbookDom'

/*
 * Drawing board of the GitBook drawing block: strokes with finger, pen or
 * mouse, saved as an SVG image inside the note (a `data:` address, so the
 * note needs no extra file). The strokes are kept in the SVG, marked with
 * `data-notia-drawing`, so the drawing opens again for editing.
 */

const WIDTH = 800
const HEIGHT = 450
/** Palette colors that read on both themes (light variants are darker). */
const COLORS: Array<[string, string]> = [
  ['#64748B', 'Pizarra'],
  ['#0D9488', 'Teal'],
  ['#3B5FE0', 'Periwinkle'],
  ['#7C3AED', 'Violeta'],
  ['#D97706', 'Ámbar'],
  ['#DC2626', 'Coral'],
  ['#16A34A', 'Salvia'],
]
const WIDTHS: Array<[number, string]> = [[2, 'Fino'], [4, 'Medio'], [8, 'Grueso']]

interface Stroke {
  color: string
  width: number
  points: Array<[number, number]>
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function pathData(points: Array<[number, number]>): string {
  const [first, ...rest] = points
  if (!first) return ''
  const start = `M${round(first[0])} ${round(first[1])}`
  // A tap leaves a dot.
  if (rest.length === 0) return `${start}L${round(first[0] + 0.1)} ${round(first[1])}`
  return `${start}${rest.map(([x, y]) => `L${round(x)} ${round(y)}`).join('')}`
}

export function strokesToSvg(strokes: Stroke[]): string {
  const paths = strokes
    .filter((stroke) => stroke.points.length > 0)
    .map((stroke) => `<path d="${pathData(stroke.points)}" stroke="${stroke.color}" stroke-width="${stroke.width}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" data-notia-drawing="1" fill="none" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

export function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

/** Strokes of a drawing made here; other images start an empty board. */
export function strokesFromDataUrl(source: string): Stroke[] {
  const match = /^data:image\/svg\+xml;base64,(.+)$/.exec(source)
  if (!match?.[1] || typeof DOMParser === 'undefined') return []
  try {
    const binary = atob(match[1])
    const svg = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
    if (root.getAttribute('data-notia-drawing') !== '1') return []
    return [...root.querySelectorAll('path')].map((path) => ({
      color: path.getAttribute('stroke') ?? COLORS[0]![0],
      width: Number(path.getAttribute('stroke-width')) || 4,
      points: [...(path.getAttribute('d') ?? '').matchAll(/[ML]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)].map((point) => [Number(point[1]), Number(point[2])] as [number, number]),
    }))
  } catch {
    return []
  }
}

/** Opens the board; resolves with the new drawing, or `null` when it is closed without saving. */
export function editDrawing(source: string, anchor: HTMLElement | null = null): Promise<string | null> {
  return new Promise((resolve) => {
    const strokes = strokesFromDataUrl(source)
    let color = COLORS[1]![0]
    let width = WIDTHS[1]![0]
    let current: Stroke | null = null

    const canvas = el('canvas', { className: 'notia-gb-drawing-board__canvas', attrs: { width: String(WIDTH), height: String(HEIGHT), 'aria-label': 'Lienzo del dibujo' } })
    const context = canvas.getContext('2d')
    const paint = () => {
      if (!context) return
      context.clearRect(0, 0, WIDTH, HEIGHT)
      context.lineCap = 'round'
      context.lineJoin = 'round'
      for (const stroke of current ? [...strokes, current] : strokes) {
        const [first, ...rest] = stroke.points
        if (!first) continue
        context.strokeStyle = stroke.color
        context.lineWidth = stroke.width
        context.beginPath()
        context.moveTo(first[0], first[1])
        if (rest.length === 0) context.lineTo(first[0] + 0.1, first[1])
        rest.forEach(([x, y]) => context.lineTo(x, y))
        context.stroke()
      }
    }
    const pointOf = (event: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect()
      return [(event.clientX - rect.left) * (WIDTH / rect.width), (event.clientY - rect.top) * (HEIGHT / rect.height)]
    }
    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      canvas.setPointerCapture(event.pointerId)
      current = { color, width, points: [pointOf(event)] }
      paint()
    })
    canvas.addEventListener('pointermove', (event) => {
      if (!current) return
      event.preventDefault()
      current.points.push(pointOf(event))
      paint()
    })
    const finish = () => {
      if (current) strokes.push(current)
      current = null
      paint()
    }
    canvas.addEventListener('pointerup', finish)
    canvas.addEventListener('pointercancel', finish)

    const swatches = COLORS.map(([value, label]) => {
      const swatch = el('button', { className: 'notia-gb-drawing-board__swatch', attrs: { type: 'button', 'aria-label': label, title: label, 'aria-pressed': String(value === color) } })
      swatch.style.setProperty('--swatch', value)
      swatch.addEventListener('click', () => {
        color = value
        swatches.forEach((other) => other.setAttribute('aria-pressed', String(other === swatch)))
      })
      return swatch
    })
    const widths = WIDTHS.map(([value, label]) => {
      const button = el('button', { className: 'notia-gb-drawing-board__width', attrs: { type: 'button', 'aria-label': `Trazo ${label.toLowerCase()}`, title: label, 'aria-pressed': String(value === width) } })
      button.append(el('span', { attrs: { style: `height:${value}px` } }))
      button.addEventListener('click', () => {
        width = value
        widths.forEach((other) => other.setAttribute('aria-pressed', String(other === button)))
      })
      return button
    })

    const backdrop = el('div', { className: 'notia-gb-drawing-board' })
    const close = (result: string | null) => {
      backdrop.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(result)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close(null)
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        strokes.pop()
        paint()
      }
    }
    const dialog = el('div', { className: 'notia-gb-drawing-board__dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Dibujo' } }, [
      el('div', { className: 'notia-gb-drawing-board__tools' }, [
        el('div', { className: 'notia-gb-drawing-board__group', attrs: { role: 'group', 'aria-label': 'Color' } }, swatches),
        el('div', { className: 'notia-gb-drawing-board__group', attrs: { role: 'group', 'aria-label': 'Grosor' } }, widths),
        iconButton('notia-undo', 'Deshacer trazo', () => {
          strokes.pop()
          paint()
        }),
        iconButton('notia-trash', 'Borrar todo', () => {
          strokes.length = 0
          paint()
        }),
      ]),
      el('div', { className: 'notia-gb-drawing-board__surface' }, [canvas]),
      el('div', { className: 'notia-gb-form__actions' }, [
        textButton('Cancelar', () => close(null)),
        textButton('Guardar dibujo', () => close(svgToDataUrl(strokesToSvg(strokes))), { className: 'notia-gb-primary' }),
      ]),
    ])
    // Only Cancel or Escape close the board: a stray press must not lose a drawing.
    backdrop.append(dialog)
    document.addEventListener('keydown', onKey, true)
    overlayHost(anchor).append(backdrop)
    paint()
  })
}
