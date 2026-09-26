import { Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'

/** How far past the gap, into the blocks around it, a click still counts as the gap. */
const MOUSE_TOLERANCE_PX = 6
/** Fingers are less precise, so a tap reaches further into the blocks. */
const TOUCH_TOLERANCE_PX = 12
/** Controls that live near a block's edge keep their own clicks. */
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, summary, label, [role="button"], [contenteditable="false"] [tabindex]'

/** One child block of a container, with where it is drawn. */
export interface GapChild {
  top: number
  bottom: number
  /** Paragraphs and headings already are a line to click on; code blocks are not. */
  isTextLine: boolean
}

/**
 * Index at which a new line goes when the pointer is at `y`, or `null`.
 * A line is added below a block that is not text when the next block is not
 * text either (or there is none), so there was no line to click on.
 */
export function pickGapIndex(children: readonly GapChild[], y: number, tolerance: number, containerBottom: number): number | null {
  for (let index = 0; index < children.length; index += 1) {
    const before = children[index]
    if (before.isTextLine) continue
    const after = children[index + 1]
    if (after?.isTextLine) continue
    const gapBottom = after ? after.top : containerBottom
    if (y >= before.bottom - tolerance && y <= Math.max(gapBottom, before.bottom) + tolerance) return index + 1
  }
  return null
}

/** A paragraph or heading; a code block is a text block too, but not a line to write on. */
function isTextLine(node: ProseNode): boolean {
  return node.isTextblock && !node.type.spec.code
}

function isVisible(rect: DOMRect): boolean {
  return rect.width > 0 || rect.height > 0
}

interface GapTarget {
  /** Document position where the new paragraph goes. */
  pos: number
}

/** Looks for a gap under the pointer in `node`'s children, then inside the child under it. */
function findGap(view: EditorView, node: ProseNode, contentStart: number, bottom: number, y: number, tolerance: number): GapTarget | null {
  const children: (GapChild & { pos: number; node: ProseNode; end: number; index: number })[] = []
  node.forEach((child, offset, index) => {
    const dom = view.nodeDOM(contentStart + offset)
    if (!(dom instanceof HTMLElement)) return
    const rect = dom.getBoundingClientRect()
    if (!isVisible(rect)) return
    children.push({
      top: rect.top,
      bottom: rect.bottom,
      isTextLine: isTextLine(child),
      pos: contentStart + offset,
      end: contentStart + offset + child.nodeSize,
      node: child,
      index,
    })
  })
  // The innermost gap wins: under a code block that closes a hint, the line goes inside the hint.
  const holder = children.find((child) => y >= child.top && y <= child.bottom)
  if (holder && !holder.node.isTextblock && !holder.node.isAtom && !holder.node.isLeaf) {
    const inner = findGap(view, holder.node, holder.pos + 1, holder.bottom, y, tolerance)
    if (inner) return inner
  }
  const paragraph = view.state.schema.nodes.paragraph
  const gapIndex = pickGapIndex(children, y, tolerance, bottom)
  const before = gapIndex === null ? undefined : children[gapIndex - 1]
  if (before && paragraph && node.canReplaceWith(before.index + 1, before.index + 1, paragraph)) {
    return { pos: before.end }
  }
  return null
}

function isTouch(event: MouseEvent): boolean {
  const capabilities = (event as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities
  if (capabilities?.firesTouchEvents) return true
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

/** Adds a line where the person clicked between blocks that leave no line to click on. */
export function handleBlockGapClick(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
  if (!view.editable) return false
  const target = event.target
  if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) return false
  const editorRect = view.dom.getBoundingClientRect()
  if (event.clientX < editorRect.left || event.clientX > editorRect.right) return false
  const tolerance = isTouch(event) ? TOUCH_TOLERANCE_PX : MOUSE_TOLERANCE_PX
  const gap = findGap(view, view.state.doc, 0, editorRect.bottom, event.clientY, tolerance)
  const paragraph = view.state.schema.nodes.paragraph
  if (!gap || !paragraph) return false
  event.preventDefault()
  event.stopPropagation()
  const tr = view.state.tr.insert(gap.pos, paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, gap.pos + 1)).scrollIntoView()
  view.dispatch(tr)
  view.focus()
  return true
}

/**
 * Clicking the blank space under the last block of the note starts a new
 * line there, as in Notion. Without it the click either did nothing (the
 * space belongs to the page, not to the editor) or put the cursor at the end
 * of the last block, so a note ending in a list, a quote or a wikilink could
 * not continue with a plain paragraph. If the note already ends in an empty
 * paragraph, the cursor goes there. `surface` is the writing area.
 */
export function handleClickBelowContent(view: EditorView, event: MouseEvent, surface: DOMRect): boolean {
  if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
  if (!view.editable) return false
  const target = event.target
  if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) return false
  if (event.clientX < surface.left || event.clientX > surface.right) return false
  const { doc, schema } = view.state
  const last = doc.lastChild
  const paragraph = schema.nodes.paragraph
  if (!last || !paragraph) return false
  const lastDom = view.nodeDOM(doc.content.size - last.nodeSize)
  if (!(lastDom instanceof HTMLElement) || event.clientY <= lastDom.getBoundingClientRect().bottom) return false
  event.preventDefault()
  event.stopPropagation()
  const tr = view.state.tr
  if (last.type !== paragraph || last.content.size > 0) tr.insert(doc.content.size, paragraph.create())
  tr.setSelection(Selection.atEnd(tr.doc)).scrollIntoView()
  view.dispatch(tr)
  view.focus()
  return true
}

const blockGapKey = new PluginKey('notiaBlockGap')

/**
 * Clicking the space under a code block, table, image, formula or GitBook
 * block adds a line there when there is none. The listener runs in the
 * capture phase so node views (CodeMirror, tables) do not take the click.
 */
export function createBlockGapPlugin(): Plugin {
  return new Plugin({
    key: blockGapKey,
    view: (view) => {
      const onMouseDown = (event: MouseEvent) => {
        handleBlockGapClick(view, event)
      }
      view.dom.addEventListener('mousedown', onMouseDown, true)
      return { destroy: () => view.dom.removeEventListener('mousedown', onMouseDown, true) }
    },
  })
}
