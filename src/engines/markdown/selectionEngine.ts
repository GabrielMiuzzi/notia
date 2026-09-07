import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { MarkdownSelectionBlock, MarkdownSelectionContext } from '../../types/views/markdownSelection'

const MAX_SELECTION_TEXT_LENGTH = 12_000

function truncateSelectionText(value: string): string {
  return value.length <= MAX_SELECTION_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_SELECTION_TEXT_LENGTH)}\n[seleccion truncada]`
}

function collectSelectedBlocks(state: EditorState): MarkdownSelectionBlock[] {
  const { from, to } = state.selection
  const blocks: MarkdownSelectionBlock[] = []

  state.doc.forEach((node, offset, index) => {
    const blockFrom = offset
    const blockTo = offset + node.nodeSize
    const isSelected = from === to
      ? from >= blockFrom && from <= blockTo
      : from < blockTo && to > blockFrom

    if (!isSelected) {
      return
    }

    blocks.push({
      index,
      type: markdownNodeLabel(node),
      text: truncateSelectionText(node.textContent),
      from: blockFrom,
      to: blockTo,
    })
  })

  if (blocks.length > 0) {
    return blocks
  }

  const resolved = state.doc.resolve(from)
  const node = resolved.node(1)
  return node
    ? [{
      index: resolved.index(0),
      type: markdownNodeLabel(node),
      text: truncateSelectionText(node.textContent),
      from: resolved.start(1),
      to: resolved.end(1),
    }]
    : []
}

export function buildMarkdownSelectionContext(
  state: EditorState,
  documentPath: string,
): MarkdownSelectionContext {
  const { from, to } = state.selection
  return {
    documentPath,
    from,
    to,
    selectedText: truncateSelectionText(state.doc.textBetween(from, to, '\n', '\n')),
    blocks: collectSelectedBlocks(state),
  }
}

export function markdownNodeLabel(node: ProseMirrorNode): string {
  switch (node.type.name) {
    case 'heading':
      return `encabezado H${String(node.attrs.level ?? '')}`
    case 'bullet_list':
      return 'lista con viñetas'
    case 'ordered_list':
      return 'lista numerada'
    case 'blockquote':
      return 'cita'
    case 'code_block':
      return 'bloque de código'
    case 'horizontal_rule':
      return 'separador horizontal'
    case 'paragraph':
      return 'párrafo'
    default:
      return node.type.name
  }
}
