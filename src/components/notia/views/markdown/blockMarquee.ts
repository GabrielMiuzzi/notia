import { NodeSelection, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { marqueeTakesPress } from './stylusWriting'

/*
 * With the selector, dragging from an empty place (the margins, under the
 * note, around the sheet) draws a rectangle, as on the Windows desktop, and
 * selects the blocks it touches. Dragging on the text still selects text,
 * and a press without dragging is still a click. The blocks are selected as
 * one editor selection (so copy, cut, delete and format work on them) and
 * painted as selected until the selection changes.
 */

interface BlockRange {
  from: number
  to: number
}

export interface ClientRect {
  left: number
  top: number
  right: number
  bottom: number
}

const blockSelectionKey = new PluginKey<BlockRange | null>('notiaBlockSelection')
/** A drag shorter than this is a click. */
const DRAG_THRESHOLD_PX = 4
/** Near the top or bottom of the editor the note scrolls while dragging. */
const EDGE_SCROLL_PX = 36
const EDGE_SCROLL_STEP = 14
/** Places a drag does not start from: text, controls and floating pieces. */
const NOT_EMPTY = [
  '.ProseMirror',
  '.notia-properties',
  '.notia-pen-bar',
  '.notia-format-toolbar',
  '.notia-wikilink-menu',
  '.milkdown-block-handle',
  '.notia-ink-selection-tools',
  'button',
  'input',
  'textarea',
  'select',
  'a',
  '[contenteditable="true"]',
].join(', ')

/** Paints the blocks of the last rectangle while the selection stays on them. */
export function createBlockSelectionPlugin(): Plugin<BlockRange | null> {
  return new Plugin<BlockRange | null>({
    key: blockSelectionKey,
    state: {
      init: () => null,
      apply: (tr, range) => {
        const meta = tr.getMeta(blockSelectionKey) as BlockRange | null | undefined
        if (meta !== undefined) return meta
        if (!range || tr.docChanged) return null
        if (tr.selectionSet) {
          const { from, to, empty } = tr.selection
          if (empty || from < range.from || to > range.to) return null
        }
        return range
      },
    },
    props: {
      decorations: (state) => {
        const range = blockSelectionKey.getState(state)
        if (!range) return null
        const decorations: Decoration[] = []
        state.doc.forEach((node, offset) => {
          if (offset >= range.from && offset + node.nodeSize <= range.to) {
            decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: 'notia-block-selected' }))
          }
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}

function intersects(a: ClientRect, b: ClientRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

/** Selects the top-level blocks a rectangle (client pixels) touches; `false` when it touches none. */
export function selectBlocksInRect(view: EditorView, rect: ClientRect): boolean {
  const hits: BlockRange[] = []
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset)
    if (dom instanceof HTMLElement && intersects(dom.getBoundingClientRect(), rect)) {
      hits.push({ from: offset, to: offset + node.nodeSize })
    }
  })
  const first = hits[0]
  const last = hits[hits.length - 1]
  if (!first || !last) {
    view.dispatch(view.state.tr.setMeta(blockSelectionKey, null))
    return false
  }
  const { doc } = view.state
  const single = hits.length === 1 ? doc.nodeAt(first.from) : null
  // One image, rule or formula is selected as that node; anything else as text across the blocks.
  const selection = single && !single.isTextblock && NodeSelection.isSelectable(single)
    ? NodeSelection.create(doc, first.from)
    : TextSelection.between(doc.resolve(first.from), doc.resolve(last.to))
  view.dispatch(view.state.tr.setSelection(selection).setMeta(blockSelectionKey, { from: first.from, to: last.to }))
  view.focus()
  return true
}

interface MarqueeOptions {
  /** Only with the selector tool. */
  isEnabled: () => boolean
  getView: () => EditorView | null
  /** A press on an empty place without dragging. */
  onClick: (event: PointerEvent) => void
}

interface Drag {
  pointerId: number
  /** Start in the host's content (scroll included). */
  startX: number
  startY: number
  clientX: number
  clientY: number
  box: HTMLDivElement | null
  frame: number
}

/** Rectangle selection on `host`, the editor's scroll container. Returns how to stop it. */
export function attachBlockMarquee(host: HTMLElement, options: MarqueeOptions): () => void {
  let drag: Drag | null = null

  const toContent = (clientX: number, clientY: number): [number, number] => {
    const rect = host.getBoundingClientRect()
    return [clientX - rect.left + host.scrollLeft, clientY - rect.top + host.scrollTop]
  }

  const currentRect = (active: Drag): { content: ClientRect; client: ClientRect } => {
    const [x, y] = toContent(active.clientX, active.clientY)
    const content = {
      left: Math.min(active.startX, x),
      top: Math.min(active.startY, y),
      right: Math.max(active.startX, x),
      bottom: Math.max(active.startY, y),
    }
    const rect = host.getBoundingClientRect()
    const shiftX = rect.left - host.scrollLeft
    const shiftY = rect.top - host.scrollTop
    return {
      content,
      client: { left: content.left + shiftX, right: content.right + shiftX, top: content.top + shiftY, bottom: content.bottom + shiftY },
    }
  }

  const paint = (active: Drag) => {
    if (!active.box) return
    const { content } = currentRect(active)
    active.box.style.left = `${content.left}px`
    active.box.style.top = `${content.top}px`
    active.box.style.width = `${content.right - content.left}px`
    active.box.style.height = `${content.bottom - content.top}px`
  }

  // Close to an edge the note scrolls, and the rectangle follows.
  const edgeScroll = () => {
    if (!drag?.box) return
    const rect = host.getBoundingClientRect()
    const step = drag.clientY < rect.top + EDGE_SCROLL_PX ? -EDGE_SCROLL_STEP
      : drag.clientY > rect.bottom - EDGE_SCROLL_PX ? EDGE_SCROLL_STEP : 0
    if (step !== 0) {
      host.scrollTop += step
      paint(drag)
    }
    drag.frame = window.requestAnimationFrame(edgeScroll)
  }

  const end = () => {
    if (!drag) return
    window.cancelAnimationFrame(drag.frame)
    drag.box?.remove()
    if (host.hasPointerCapture(drag.pointerId)) host.releasePointerCapture(drag.pointerId)
    drag = null
  }

  const onPointerDown = (event: PointerEvent) => {
    // Fingers scroll, and on Android the stylus writes text (see stylusWriting.ts).
    if (!options.isEnabled() || event.button !== 0 || !marqueeTakesPress(event)) return
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target
    if (!(target instanceof Element) || !host.contains(target) || target.closest(NOT_EMPTY)) return
    const [startX, startY] = toContent(event.clientX, event.clientY)
    drag = { pointerId: event.pointerId, startX, startY, clientX: event.clientX, clientY: event.clientY, box: null, frame: 0 }
  }

  // The press on an empty place must not start a text selection.
  const onMouseDown = (event: MouseEvent) => {
    if (drag) event.preventDefault()
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    drag.clientX = event.clientX
    drag.clientY = event.clientY
    if (!drag.box) {
      const [x, y] = toContent(event.clientX, event.clientY)
      if (Math.hypot(x - drag.startX, y - drag.startY) < DRAG_THRESHOLD_PX) return
      drag.box = document.createElement('div')
      drag.box.className = 'notia-block-marquee'
      drag.box.setAttribute('aria-hidden', 'true')
      host.append(drag.box)
      host.setPointerCapture(drag.pointerId)
      drag.frame = window.requestAnimationFrame(edgeScroll)
    }
    event.preventDefault()
    paint(drag)
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const active = drag
    const dragged = Boolean(active.box)
    const rect = dragged ? currentRect(active).client : null
    end()
    const view = options.getView()
    if (rect && view) selectBlocksInRect(view, rect)
    else if (!dragged) options.onClick(event)
  }

  host.addEventListener('pointerdown', onPointerDown, true)
  host.addEventListener('mousedown', onMouseDown, true)
  host.addEventListener('pointermove', onPointerMove)
  host.addEventListener('pointerup', onPointerUp)
  host.addEventListener('pointercancel', end)
  return () => {
    end()
    host.removeEventListener('pointerdown', onPointerDown, true)
    host.removeEventListener('mousedown', onMouseDown, true)
    host.removeEventListener('pointermove', onPointerMove)
    host.removeEventListener('pointerup', onPointerUp)
    host.removeEventListener('pointercancel', end)
  }
}

/** Whether a press is waiting to become a click or a rectangle. */
export function isMarqueeTarget(target: EventTarget | null, host: HTMLElement): boolean {
  return target instanceof Element && host.contains(target) && !target.closest(NOT_EMPTY)
}
