import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { firstLineBox, getActiveBlock } from './blockHandle'
import { formattableBlockRange, isFormattableSelection, readFormatState, type FormatState } from './formatCommands'

/** What the toolbar formats: the selection, or the whole block under the pointer. */
export type FormatToolbarTarget = { kind: 'selection' } | { kind: 'block'; pos: number }

/** Where the formatted text is, in viewport coordinates, and how it is formatted. */
export interface FormatToolbarState {
  target: FormatToolbarTarget
  format: FormatState
  /** Left edge of the top-level block that holds the text. */
  blockLeft: number
  selectionTop: number
  selectionBottom: number
}

export interface FormatToolbarPluginOptions {
  onChange: (state: FormatToolbarState | null) => void
  /** Focus that moves into the toolbar keeps it open. */
  isInsideToolbar: (node: Node | null) => boolean
}

const formatToolbarKey = new PluginKey('notiaFormatToolbar')

function isCoarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

function measure(view: EditorView, from: number, to: number): Pick<FormatToolbarState, 'blockLeft' | 'selectionTop' | 'selectionBottom'> {
  const start = view.coordsAtPos(from, 1)
  const end = view.coordsAtPos(to, -1)
  const $from = view.state.doc.resolve(from)
  const blockDom = $from.depth > 0 ? view.nodeDOM($from.before(1)) : view.nodeDOM(from)
  return {
    blockLeft: blockDom instanceof HTMLElement ? blockDom.getBoundingClientRect().left : start.left,
    selectionTop: Math.min(start.top, end.top),
    selectionBottom: Math.max(start.bottom, end.bottom),
  }
}

function readSelectionState(view: EditorView): FormatToolbarState | null {
  const { state } = view
  if (!isFormattableSelection(state)) return null
  return {
    target: { kind: 'selection' },
    format: readFormatState(state),
    ...measure(view, state.selection.from, state.selection.to),
  }
}

/** Toolbar of the block the handle belongs to, as the design shows it on hover. */
function readBlockState(view: EditorView): FormatToolbarState | null {
  const pos = getActiveBlock(view.state)
  if (pos === null || isCoarsePointer()) return null
  const range = formattableBlockRange(view.state, pos)
  if (!range) return null
  const firstTextPos = Math.min(range.from + 1, range.to)
  const measured = measure(view, firstTextPos, firstTextPos)
  // Like the canvas, the toolbar sits 10px above the block's first line box.
  const line = firstLineBox(view, pos)
  return {
    target: { kind: 'block', pos },
    format: readFormatState(view.state, range),
    ...measured,
    ...(line ? { selectionTop: line.top, selectionBottom: line.bottom } : {}),
  }
}

function readToolbarState(view: EditorView, hasFocus: boolean): FormatToolbarState | null {
  try {
    // A selection wins; without one, the block under the pointer gets the toolbar.
    return (hasFocus ? readSelectionState(view) : null) ?? readBlockState(view)
  } catch {
    return null
  }
}

/**
 * Reports what the floating toolbar formats. While the pointer is still
 * selecting it reports nothing, so the toolbar appears once the selection is
 * done instead of chasing the cursor.
 */
export function createFormatToolbarPlugin({ onChange, isInsideToolbar }: FormatToolbarPluginOptions): Plugin {
  return new Plugin({
    key: formatToolbarKey,
    view: (view) => {
      let isPointerSelecting = false
      let frame = 0
      const report = () => {
        window.cancelAnimationFrame(frame)
        frame = window.requestAnimationFrame(() => {
          const hasFocus = view.hasFocus() || isInsideToolbar(document.activeElement)
          onChange(isPointerSelecting ? null : readToolbarState(view, hasFocus))
        })
      }
      const startPointerSelection = () => {
        isPointerSelecting = true
        onChange(null)
      }
      const endPointerSelection = () => {
        if (!isPointerSelecting) return
        isPointerSelecting = false
        report()
      }
      const handleFocusOut = (event: FocusEvent) => {
        // Switching to another window keeps the toolbar for when the person comes back.
        if (!document.hasFocus() || isInsideToolbar(event.relatedTarget as Node | null)) return
        report()
      }
      view.dom.addEventListener('pointerdown', startPointerSelection)
      view.dom.addEventListener('focusin', report)
      view.dom.addEventListener('focusout', handleFocusOut)
      window.addEventListener('pointerup', endPointerSelection)
      window.addEventListener('pointercancel', endPointerSelection)
      return {
        update: (updatedView, previousState) => {
          const { state } = updatedView
          const isSame = state.selection.eq(previousState.selection)
            && state.doc === previousState.doc
            && state.storedMarks === previousState.storedMarks
            && getActiveBlock(state) === getActiveBlock(previousState)
          if (!isSame) report()
        },
        destroy: () => {
          window.cancelAnimationFrame(frame)
          view.dom.removeEventListener('pointerdown', startPointerSelection)
          view.dom.removeEventListener('focusin', report)
          view.dom.removeEventListener('focusout', handleFocusOut)
          window.removeEventListener('pointerup', endPointerSelection)
          window.removeEventListener('pointercancel', endPointerSelection)
          onChange(null)
        },
      }
    },
  })
}
