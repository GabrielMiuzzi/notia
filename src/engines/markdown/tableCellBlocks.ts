import type { Node as ProseMirrorNode } from '@milkdown/prose/model'
import type { MarkdownNode, NodeSchema } from '@milkdown/transformer'
import { $remark } from '@milkdown/utils'

export const TABLE_CELL_BLOCK_MARKER_PREFIX = '<!--notia-table-block:'
const TABLE_CELL_BLOCK_MARKER_SUFFIX = '-->'
const TABLE_CELL_BLOCK_MARKER_MAX_LENGTH = 500_000
const TABLE_CELL_BLOCK_NODE_TYPE = 'notiaTableBlock'

interface SerializedMark {
  type: string
  attrs?: Record<string, unknown> | null
}

export interface SerializedTableCellNode {
  type: string
  attrs?: Record<string, unknown> | null
  content?: SerializedTableCellNode[]
  marks?: SerializedMark[]
  text?: string
}

interface TableCellBlockMarkdownNode extends MarkdownNode {
  type: typeof TABLE_CELL_BLOCK_NODE_TYPE
  data: {
    node: SerializedTableCellNode
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSerializedMark(value: unknown): value is SerializedMark {
  return isRecord(value) && typeof value.type === 'string'
}

function isSerializedNode(value: unknown): value is SerializedTableCellNode {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }

  if ('text' in value && typeof value.text !== 'string') {
    return false
  }

  if ('content' in value && (!Array.isArray(value.content) || !value.content.every(isSerializedNode))) {
    return false
  }

  if ('marks' in value && (!Array.isArray(value.marks) || !value.marks.every(isSerializedMark))) {
    return false
  }

  return true
}

function encodeTableCellNode(node: SerializedTableCellNode): string {
  return `${TABLE_CELL_BLOCK_MARKER_PREFIX}${encodeURIComponent(JSON.stringify(node))}${TABLE_CELL_BLOCK_MARKER_SUFFIX}`
}

export function createTableCellBlockMarker(node: ProseMirrorNode | SerializedTableCellNode): string {
  const maybeProseMirrorNode = node as ProseMirrorNode
  const serialized = typeof maybeProseMirrorNode.toJSON === 'function'
    ? maybeProseMirrorNode.toJSON() as SerializedTableCellNode
    : node as SerializedTableCellNode
  return encodeTableCellNode(serialized)
}

export function parseTableCellBlockMarker(value: string): SerializedTableCellNode | null {
  if (!value.startsWith(TABLE_CELL_BLOCK_MARKER_PREFIX) || !value.endsWith(TABLE_CELL_BLOCK_MARKER_SUFFIX)) {
    return null
  }

  if (value.length > TABLE_CELL_BLOCK_MARKER_MAX_LENGTH) {
    return null
  }

  const encoded = value.slice(
    TABLE_CELL_BLOCK_MARKER_PREFIX.length,
    value.length - TABLE_CELL_BLOCK_MARKER_SUFFIX.length,
  )

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(encoded))
    return isSerializedNode(parsed) ? parsed : null
  } catch {
    return null
  }
}

function asTableCellBlockNode(node: MarkdownNode): TableCellBlockMarkdownNode | null {
  if (node.type !== 'html' || typeof node.value !== 'string') {
    return null
  }

  const serialized = parseTableCellBlockMarker(node.value)
  if (!serialized) {
    return null
  }

  return {
    type: TABLE_CELL_BLOCK_NODE_TYPE,
    data: { node: serialized },
  }
}

function transformTableCell(node: MarkdownNode): void {
  if (!node.children) {
    return
  }

  node.children = node.children.map((child) => asTableCellBlockNode(child) ?? child)
}

function transformTableCells(node: MarkdownNode): void {
  if (node.type === 'tableCell') {
    transformTableCell(node)
    return
  }

  node.children?.forEach(transformTableCells)
}

export function transformTableCellBlockMarkers(tree: MarkdownNode): void {
  transformTableCells(tree)
}

/**
 * GFM tables only have inline cells in Markdown. The marker is deliberately
 * an HTML comment so regular Markdown renderers keep the source valid while
 * Milkdown can restore the original block node on the next parse.
 */
export const tableCellBlocksRemark = $remark(
  'notiaTableCellBlocks',
  () => () => (tree) => {
    transformTableCellBlockMarkers(tree as unknown as MarkdownNode)
  },
)

function appendSerializedNode(
  state: Parameters<NonNullable<NodeSchema['parseMarkdown']['runner']>>[0],
  serialized: SerializedTableCellNode,
): void {
  const nodeType = state.schema.nodes[serialized.type]
  if (!nodeType || serialized.type === 'doc' || serialized.type === 'text') {
    return
  }

  const content = serialized.content
    ?.map((child) => createProseMirrorNode(state, child))
    .filter((child): child is ProseMirrorNode => child !== null)

  state.addNode(nodeType, serialized.attrs ?? undefined, content)
}

function createProseMirrorNode(
  state: Parameters<NonNullable<NodeSchema['parseMarkdown']['runner']>>[0],
  serialized: SerializedTableCellNode,
): ProseMirrorNode | null {
  if (serialized.type === 'text') {
    if (typeof serialized.text !== 'string') {
      return null
    }

    const marks = serialized.marks
      ?.map((mark) => {
        const markType = state.schema.marks[mark.type]
        return markType?.create(mark.attrs ?? undefined) ?? null
      })
      .filter((mark): mark is ReturnType<typeof state.schema.marks[string]['create']> => mark !== null)

    return state.schema.text(serialized.text, marks)
  }

  const nodeType = state.schema.nodes[serialized.type]
  if (!nodeType || serialized.type === 'doc') {
    return null
  }

  const content = serialized.content
    ?.map((child) => createProseMirrorNode(state, child))
    .filter((child): child is ProseMirrorNode => child !== null)

  try {
    const marks = serialized.marks
      ?.map((mark) => {
        const markType = state.schema.marks[mark.type]
        return markType?.create(mark.attrs ?? undefined) ?? null
      })
      .filter((mark): mark is ReturnType<typeof state.schema.marks[string]['create']> => mark !== null)

    return nodeType.create(serialized.attrs ?? undefined, content, marks)
  } catch {
    return null
  }
}

function parseTableCellWithBlocks(
  state: Parameters<NonNullable<NodeSchema['parseMarkdown']['runner']>>[0],
  node: MarkdownNode,
  type: Parameters<NonNullable<NodeSchema['parseMarkdown']['runner']>>[2],
): void {
  const paragraphType = state.schema.nodes.paragraph
  if (!paragraphType) {
    return
  }

  state.openNode(type, { alignment: node.align as string })
  let inlineChildren: MarkdownNode[] = []
  const flushInlineChildren = () => {
    if (inlineChildren.length === 0) {
      return
    }

    state.openNode(paragraphType).next(inlineChildren).closeNode()
    inlineChildren = []
  }

  for (const child of node.children ?? []) {
    if (child.type === TABLE_CELL_BLOCK_NODE_TYPE && isRecord(child.data) && isSerializedNode(child.data.node)) {
      flushInlineChildren()
      appendSerializedNode(state, child.data.node)
      continue
    }

    inlineChildren.push(child)
  }

  flushInlineChildren()
  state.closeNode()
}

function serializeTableCellWithBlocks(
  state: Parameters<NonNullable<NodeSchema['toMarkdown']['runner']>>[0],
  node: ProseMirrorNode,
): void {
  state.openNode('tableCell')
  node.forEach((child) => {
    if (child.type.name === 'paragraph') {
      state.next(child)
    } else {
      state.addNode('html', undefined, createTableCellBlockMarker(child))
    }
  })
  state.closeNode()
}

export function extendTableCellSchemaWithBlocks(schema: NodeSchema): NodeSchema {
  return {
    ...schema,
    content: 'block+',
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner: parseTableCellWithBlocks,
    },
    toMarkdown: {
      ...schema.toMarkdown,
      runner: serializeTableCellWithBlocks,
    },
  }
}
