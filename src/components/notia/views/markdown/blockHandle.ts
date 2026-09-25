import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'

/** Six-dot grip of the handle, shared with the drag ghost. */
export const BLOCK_GRIP_ICON = '<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></svg>'

const HANDLE_SELECTOR = '.milkdown-block-handle'
const GHOST_TEXT_MAX_LENGTH = 80
/** Where the pointer holds the ghost, over its grip. */
const GHOST_POINTER_OFFSET = { x: 18, y: 16 }

const activeBlockKey = new PluginKey<number | null>('notiaActiveBlock')

/** Paints the block the handle belongs to. */
export const activeBlockPlugin = new Plugin<number | null>({
  key: activeBlockKey,
  state: {
    init: () => null,
    apply: (tr, position) => {
      const meta = tr.getMeta(activeBlockKey) as { position: number | null } | undefined
      if (meta) return meta.position
      if (position === null || !tr.docChanged) return position
      const mapped = tr.mapping.mapResult(position)
      return mapped.deleted ? null : mapped.pos
    },
  },
  props: {
    decorations: (state) => {
      const position = activeBlockKey.getState(state)
      const node = position === null || position === undefined ? null : state.doc.nodeAt(position)
      if (position === null || position === undefined || !node) return null
      return DecorationSet.create(state.doc, [
        Decoration.node(position, position + node.nodeSize, { class: 'notia-block-active' }),
      ])
    },
  },
})

/** Position of the first text block at or inside the node at `pos`, or `null` (images, rules). */
function firstTextblockPos(view: EditorView, pos: number): number | null {
  const node = view.state.doc.nodeAt(pos)
  if (!node) return null
  if (node.isTextblock) return pos
  let found: number | null = null
  node.descendants((child, offset) => {
    if (found !== null) return false
    if (child.isTextblock) found = pos + 1 + offset
    return found === null
  })
  return found
}

/**
 * Top and bottom of the first line of text in the block at `pos`, the line
 * the canvas lines up the handle and the toolbar with. Blocks keep their
 * spacing as padding, so the line starts below the block's own top.
 */
export function firstLineBox(view: EditorView, pos: number): { top: number; bottom: number } | null {
  const textblockPos = firstTextblockPos(view, pos)
  const dom = textblockPos === null ? null : view.nodeDOM(textblockPos)
  if (!(dom instanceof HTMLElement)) return null
  const style = window.getComputedStyle(dom)
  const top = dom.getBoundingClientRect().top + (Number.parseFloat(style.paddingTop) || 0)
  const lineHeight = Number.parseFloat(style.lineHeight)
  return { top, bottom: top + (Number.isFinite(lineHeight) ? lineHeight : dom.getBoundingClientRect().height) }
}

/** Reference box of the handle: the block's width and its first line, so the grip is centred on that line. */
export function blockHandleReference(view: EditorView, pos: number, element: HTMLElement): Omit<DOMRect, 'toJSON'> {
  const rect = element.getBoundingClientRect()
  const line = firstLineBox(view, pos)
  if (!line) return rect
  return {
    x: rect.x,
    y: line.top,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    top: line.top,
    bottom: line.bottom,
    height: line.bottom - line.top,
  }
}

/** Position of the block the handle belongs to, if any. */
export function getActiveBlock(state: EditorState): number | null {
  return activeBlockKey.getState(state) ?? null
}

export function setActiveBlock(view: EditorView, position: number | null): void {
  if (view.isDestroyed || activeBlockKey.getState(view.state) === position) return
  view.dispatch(view.state.tr.setMeta(activeBlockKey, { position }).setMeta('addToHistory', false))
}

/**
 * Milkdown only hides the handle when the pointer moves inside the text, so
 * it stayed on screen after leaving the editor. Hiding it as Milkdown does
 * (`data-show`) also clears the painted block and the block toolbar.
 */
export function hideBlockHandleOnPointerLeave(host: HTMLElement, root: HTMLElement): () => void {
  const handlePointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    const handle = root.querySelector<HTMLElement>(HANDLE_SELECTOR)
    if (handle) handle.dataset.show = 'false'
  }
  host.addEventListener('pointerleave', handlePointerLeave)
  return () => host.removeEventListener('pointerleave', handlePointerLeave)
}

/**
 * Whether the pointer row `clientY` is space a page break opens: a sheet's
 * bottom margin, the gap and the next sheet's top margin. Milkdown looks the
 * hovered block up by row; inside a list that row hits the list itself,
 * which then lit up across the gap.
 */
export function isPageBreakRow(view: EditorView, clientY: number): boolean {
  return Array.from(view.dom.querySelectorAll('.notia-page-spacer')).some((spacer) => {
    const rect = spacer.getBoundingClientRect()
    return clientY >= rect.top && clientY < rect.bottom
  })
}

/** Reports the pointer row before Milkdown's own `pointermove` listener reads it. */
export function trackPointerRow(view: EditorView, onMove: (clientY: number) => void): () => void {
  const handlePointerMove = (event: PointerEvent) => onMove(event.clientY)
  view.dom.addEventListener('pointermove', handlePointerMove, true)
  return () => view.dom.removeEventListener('pointermove', handlePointerMove, true)
}

/** Clears the painted block when Milkdown hides the handle (typing, pointer out of the text). */
export function observeBlockHandleVisibility(root: HTMLElement, onHidden: () => void): () => void {
  const observer = new MutationObserver((records) => {
    const hidden = records.some((record) => (
      record.target instanceof HTMLElement
      && record.target.matches(HANDLE_SELECTOR)
      && record.target.dataset.show === 'false'
    ))
    if (hidden) onHidden()
  })
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-show'] })
  return () => observer.disconnect()
}

/**
 * Replaces the browser's snapshot of the block with a small card while it is
 * dragged by the handle. The card lives in `host` to inherit the theme.
 */
export function attachBlockDragGhost(root: HTMLElement, host: HTMLElement, getText: () => string): () => void {
  const handleDragStart = (event: DragEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest(HANDLE_SELECTOR) || !event.dataTransfer) return
    const text = getText().replace(/\s+/g, ' ').trim()
    const ghost = document.createElement('div')
    ghost.className = 'notia-block-drag-ghost'
    const grip = document.createElement('span')
    grip.className = 'notia-block-drag-ghost-grip'
    grip.innerHTML = BLOCK_GRIP_ICON
    const label = document.createElement('span')
    label.className = 'notia-block-drag-ghost-text'
    label.textContent = text.length > GHOST_TEXT_MAX_LENGTH ? `${text.slice(0, GHOST_TEXT_MAX_LENGTH)}…` : text || 'Bloque'
    ghost.append(grip, label)
    host.append(ghost)
    event.dataTransfer.setDragImage(ghost, GHOST_POINTER_OFFSET.x, GHOST_POINTER_OFFSET.y)
    window.setTimeout(() => ghost.remove(), 0)
  }
  // Bubbling to the root runs after Milkdown's own listener on the handle,
  // so this drag image is the one the browser keeps.
  root.addEventListener('dragstart', handleDragStart)
  return () => root.removeEventListener('dragstart', handleDragStart)
}
