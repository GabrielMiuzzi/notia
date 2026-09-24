import type { MarkdownNode } from '@milkdown/transformer'

/**
 * Formats plain Markdown does not have, stored as HTML that other renderers
 * degrade gracefully: `<u>` for underline, `<span data-color>` for the text
 * color, `<mark data-color>` for the highlight and a `<div align>` wrapper,
 * separated by blank lines, for centred or right-aligned blocks. Colors are
 * names, not values, so each theme paints them with its own palette.
 */
export const RICH_TEXT_COLORS = ['gray', 'teal', 'blue', 'violet', 'red', 'orange', 'yellow'] as const
export type RichTextColor = typeof RICH_TEXT_COLORS[number]
/** A bare `<mark>` (GitHub, Obsidian) is a yellow highlight. */
export const DEFAULT_HIGHLIGHT_COLOR: RichTextColor = 'yellow'

export type BlockAlignment = 'left' | 'center' | 'right'
/** Left is the default and is never written. */
const WRITTEN_ALIGNMENTS = new Set<BlockAlignment>(['center', 'right'])

export const UNDERLINE_MARKDOWN_NODE = 'notiaUnderline'
export const TEXT_COLOR_MARKDOWN_NODE = 'notiaTextColor'
export const HIGHLIGHT_MARKDOWN_NODE = 'notiaHighlight'

/** Blocks that can carry an alignment. */
const ALIGNABLE_MARKDOWN_NODES = new Set(['paragraph', 'heading'])
/** Nodes whose content is literal text. */
const LITERAL_MARKDOWN_NODES = new Set(['code', 'inlineCode', 'html', 'math', 'inlineMath', 'text'])

const ALIGN_OPEN_PATTERN = /^<div align="(left|center|right)">$/
const ALIGN_CLOSE_PATTERN = /^<\/div>$/

export function isRichTextColor(value: unknown): value is RichTextColor {
  return typeof value === 'string' && (RICH_TEXT_COLORS as readonly string[]).includes(value)
}

export function isWrittenAlignment(value: unknown): value is BlockAlignment {
  return typeof value === 'string' && WRITTEN_ALIGNMENTS.has(value as BlockAlignment)
}

interface InlineTagSpec {
  node: string
  tagName: string
  /** Attributes of the opening tag, or `null` when it is not ours. */
  readOpening: (tag: string) => Record<string, string> | null
}

const INLINE_TAGS: InlineTagSpec[] = [
  {
    node: UNDERLINE_MARKDOWN_NODE,
    tagName: 'u',
    readOpening: (tag) => (tag === '<u>' ? {} : null),
  },
  {
    node: TEXT_COLOR_MARKDOWN_NODE,
    tagName: 'span',
    readOpening: (tag) => {
      const color = /^<span data-color="([a-z]+)">$/.exec(tag)?.[1]
      return isRichTextColor(color) ? { color } : null
    },
  },
  {
    node: HIGHLIGHT_MARKDOWN_NODE,
    tagName: 'mark',
    readOpening: (tag) => {
      const match = /^<mark(?: data-color="([a-z]+)")?>$/.exec(tag)
      if (!match) return null
      const color = match[1] ?? DEFAULT_HIGHLIGHT_COLOR
      return isRichTextColor(color) ? { color } : null
    },
  },
]

function htmlValue(node: MarkdownNode | undefined): string | null {
  return node?.type === 'html' && typeof node.value === 'string' ? node.value.trim() : null
}

/** Milkdown wraps block-level HTML in a paragraph before this transform runs. */
function blockHtmlValue(node: MarkdownNode | undefined): string | null {
  if (node?.type === 'paragraph' && node.children?.length === 1) return htmlValue(node.children[0])
  return htmlValue(node)
}

function isOpeningOf(tagName: string, value: string): boolean {
  return new RegExp(`^<${tagName}(\\s[^>]*)?>$`).test(value)
}

/** Index of the tag that closes the one at `openIndex`, counting nested tags with the same name. */
function findClosingIndex(children: MarkdownNode[], openIndex: number, tagName: string): number {
  let depth = 0
  for (let index = openIndex; index < children.length; index += 1) {
    const value = htmlValue(children[index])
    if (value === null) continue
    if (isOpeningOf(tagName, value)) depth += 1
    if (value === `</${tagName}>`) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/** Turns sibling `<u>`…`</u>` style pairs into a single node holding what is between them. */
function pairInlineTags(children: MarkdownNode[]): MarkdownNode[] {
  const result: MarkdownNode[] = []
  let index = 0
  while (index < children.length) {
    const child = children[index] as MarkdownNode
    const value = htmlValue(child)
    const opening = value === null
      ? null
      : INLINE_TAGS
        .map((spec) => ({ spec, attrs: spec.readOpening(value) }))
        .find((candidate) => candidate.attrs !== null)
    if (opening) {
      const closeIndex = findClosingIndex(children, index, opening.spec.tagName)
      if (closeIndex > index + 1) {
        result.push({
          type: opening.spec.node,
          ...opening.attrs,
          children: children.slice(index + 1, closeIndex),
        })
        index = closeIndex + 1
        continue
      }
    }
    result.push(child)
    index += 1
  }
  return result
}

function transformInline(node: MarkdownNode): void {
  if (!node.children || LITERAL_MARKDOWN_NODES.has(node.type)) return
  node.children = pairInlineTags(node.children)
  node.children.forEach(transformInline)
}

/**
 * Removes `<div align>` wrappers around top-level paragraphs and headings and
 * keeps the alignment on those blocks. A wrapper around anything else is
 * left untouched so saving never drops HTML someone wrote by hand.
 */
function transformAlignment(root: MarkdownNode): void {
  const children = root.children
  if (!children) return
  const result: MarkdownNode[] = []
  let index = 0
  while (index < children.length) {
    const child = children[index] as MarkdownNode
    const align = ALIGN_OPEN_PATTERN.exec(blockHtmlValue(child) ?? '')?.[1]
    if (isWrittenAlignment(align)) {
      const closeIndex = children.findIndex((candidate, candidateIndex) => (
        candidateIndex > index && ALIGN_CLOSE_PATTERN.test(blockHtmlValue(candidate) ?? '')
      ))
      const wrapped = closeIndex > index + 1 ? children.slice(index + 1, closeIndex) : []
      const isAlignable = (block: MarkdownNode) => ALIGNABLE_MARKDOWN_NODES.has(block.type) && blockHtmlValue(block) === null
      if (wrapped.length > 0 && wrapped.every(isAlignable)) {
        wrapped.forEach((block) => {
          block.data = { ...(block.data as Record<string, unknown> | undefined), notiaAlign: align }
        })
        result.push(...wrapped)
        index = closeIndex + 1
        continue
      }
    }
    result.push(child)
    index += 1
  }
  root.children = result
}

/** Runs on the Markdown tree before Milkdown builds the document. */
export function transformRichTextMarkdown(tree: MarkdownNode): void {
  transformAlignment(tree)
  transformInline(tree)
}

/** Alignment that `transformRichTextMarkdown` left on a block. */
export function readMarkdownAlignment(node: MarkdownNode): BlockAlignment | null {
  const align = (node.data as { notiaAlign?: unknown } | undefined)?.notiaAlign
  return isWrittenAlignment(align) ? align : null
}

export function alignmentOpeningTag(align: BlockAlignment): string {
  return `<div align="${align}">`
}

export const ALIGNMENT_CLOSING_TAG = '</div>'

/** The part of mdast-util-to-markdown's state that the handlers use. */
interface PhrasingState {
  createTracker: (info: unknown) => {
    move: (value: string) => string
    current: () => Record<string, unknown>
  }
  containerPhrasing: (parent: unknown, info: Record<string, unknown>) => string
}

type PhrasingHandler = (node: MarkdownNode, parent: unknown, state: PhrasingState, info: unknown) => string

function wrapPhrasing(readTags: (node: MarkdownNode) => [string, string] | null): PhrasingHandler {
  return (node, _parent, state, info) => {
    const tags = readTags(node)
    if (!tags) return state.containerPhrasing(node, { before: '', after: '' })
    const [open, close] = tags
    const tracker = state.createTracker(info)
    let value = tracker.move(open)
    value += tracker.move(state.containerPhrasing(node, { before: value, after: '<', ...tracker.current() }))
    value += tracker.move(close)
    return value
  }
}

/** Writes the rich text nodes back as the HTML they were read from. */
export const richTextMarkdownHandlers: Record<string, PhrasingHandler> = {
  [UNDERLINE_MARKDOWN_NODE]: wrapPhrasing(() => ['<u>', '</u>']),
  [TEXT_COLOR_MARKDOWN_NODE]: wrapPhrasing((node) => (
    isRichTextColor(node.color) ? [`<span data-color="${node.color}">`, '</span>'] : null
  )),
  [HIGHLIGHT_MARKDOWN_NODE]: wrapPhrasing((node) => {
    const color = isRichTextColor(node.color) ? node.color : DEFAULT_HIGHLIGHT_COLOR
    return [`<mark data-color="${color}">`, '</mark>']
  }),
}
