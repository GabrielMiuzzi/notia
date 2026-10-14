import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'

/*
 * Where the block made from handwriting goes in the note: at the height of
 * the strokes. An empty line under them is replaced, strokes that start
 * over a block go after it and strokes in a gap go before the next block.
 * This is only placement on the screen; the block itself comes from Rust.
 */

/** The positions the block replaces; `top` is where the strokes start, in client pixels. */
export function inkInsertionRange(view: EditorView, top: number): { from: number; to: number } {
  const { doc } = view.state
  let range = { from: doc.content.size, to: doc.content.size }
  let found = false
  doc.forEach((node, offset) => {
    if (found) return
    const dom = view.nodeDOM(offset)
    if (!(dom instanceof HTMLElement)) return
    const rect = dom.getBoundingClientRect()
    if (rect.bottom <= top) return
    found = true
    const end = offset + node.nodeSize
    if (node.type.name === 'paragraph' && node.content.size === 0) range = { from: offset, to: end }
    else if (rect.top < top) range = { from: end, to: end }
    else range = { from: offset, to: offset }
  })
  return range
}

/** Puts the parsed block (a document) at the strokes' height; `false` when it is empty. */
export function insertInkBlock(view: EditorView, block: ProseNode, top: number): boolean {
  if (block.childCount === 0) return false
  const { from, to } = inkInsertionRange(view, top)
  view.dispatch(view.state.tr.replaceWith(from, to, block.content).scrollIntoView())
  return true
}
