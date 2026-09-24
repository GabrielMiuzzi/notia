import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import type { MarkdownNode, NodeSchema } from '@milkdown/kit/transformer'
import { headingAttr, headingSchema, paragraphAttr, paragraphSchema } from '@milkdown/kit/preset/commonmark'
import { toggleMark } from '@milkdown/kit/prose/commands'
import { keymap } from '@milkdown/kit/prose/keymap'
import { $markSchema, $prose, $remark } from '@milkdown/kit/utils'
import {
  ALIGNMENT_CLOSING_TAG,
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_MARKDOWN_NODE,
  TEXT_COLOR_MARKDOWN_NODE,
  UNDERLINE_MARKDOWN_NODE,
  alignmentOpeningTag,
  isRichTextColor,
  isWrittenAlignment,
  readMarkdownAlignment,
  richTextMarkdownHandlers,
  transformRichTextMarkdown,
} from '../../../../engines/markdown/richTextMarkdown'

export const UNDERLINE_MARK = 'notia_underline'
export const TEXT_COLOR_MARK = 'notia_text_color'
export const HIGHLIGHT_MARK = 'notia_highlight'

/** Reads the HTML formats before Milkdown parses and writes them back when it serializes. */
export const richTextRemark = $remark('notiaRichText', () => function notiaRichText(this: { data: () => unknown }) {
  // The same registry remark-gfm uses to add its serializers.
  const data = this.data() as { toMarkdownExtensions?: unknown[] }
  const extensions = (data.toMarkdownExtensions ??= [])
  extensions.push({ handlers: richTextMarkdownHandlers })
  return (tree: unknown) => transformRichTextMarkdown(tree as MarkdownNode)
})

export const underlineSchema = $markSchema(UNDERLINE_MARK, () => ({
  parseDOM: [{ tag: 'u' }],
  toDOM: () => ['u', 0],
  parseMarkdown: {
    match: (node) => node.type === UNDERLINE_MARKDOWN_NODE,
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === UNDERLINE_MARK,
    runner: (state, mark) => {
      state.withMark(mark, UNDERLINE_MARKDOWN_NODE)
    },
  },
}))

export const textColorSchema = $markSchema(TEXT_COLOR_MARK, () => ({
  attrs: { color: { default: 'teal', validate: 'string' } },
  parseDOM: [{
    tag: 'span[data-color]',
    getAttrs: (dom) => {
      const color = (dom as HTMLElement).getAttribute('data-color')
      return isRichTextColor(color) ? { color } : false
    },
  }],
  toDOM: (mark) => ['span', { class: 'notia-text-color', 'data-color': mark.attrs.color }, 0],
  parseMarkdown: {
    match: (node) => node.type === TEXT_COLOR_MARKDOWN_NODE,
    runner: (state, node, markType) => {
      state.openMark(markType, { color: node.color })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === TEXT_COLOR_MARK,
    runner: (state, mark) => {
      state.withMark(mark, TEXT_COLOR_MARKDOWN_NODE, undefined, { color: mark.attrs.color })
    },
  },
}))

export const highlightSchema = $markSchema(HIGHLIGHT_MARK, () => ({
  attrs: { color: { default: DEFAULT_HIGHLIGHT_COLOR, validate: 'string' } },
  parseDOM: [{
    tag: 'mark',
    getAttrs: (dom) => {
      const color = (dom as HTMLElement).getAttribute('data-color') ?? DEFAULT_HIGHLIGHT_COLOR
      return isRichTextColor(color) ? { color } : false
    },
  }],
  toDOM: (mark) => ['mark', { class: 'notia-highlight', 'data-color': mark.attrs.color }, 0],
  parseMarkdown: {
    match: (node) => node.type === HIGHLIGHT_MARKDOWN_NODE,
    runner: (state, node, markType) => {
      state.openMark(markType, { color: node.color })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === HIGHLIGHT_MARK,
    runner: (state, mark) => {
      state.withMark(mark, HIGHLIGHT_MARKDOWN_NODE, undefined, { color: mark.attrs.color })
    },
  },
}))

export const underlineKeymap = $prose((ctx) => keymap({ 'Mod-u': toggleMark(underlineSchema.type(ctx)) }))

type ParserRunner = NodeSchema['parseMarkdown']['runner']
type SerializerRunner = NodeSchema['toMarkdown']['runner']

/**
 * Adds `align` to paragraphs and headings. Only top-level blocks write it:
 * the `<div>` wrapper is a block of its own, which a list item or a table
 * cell cannot hold.
 */
export function withBlockAlignment(schema: NodeSchema): NodeSchema {
  const parse: ParserRunner = schema.parseMarkdown.runner
  const serialize: SerializerRunner = schema.toMarkdown.runner
  return {
    ...schema,
    attrs: { ...schema.attrs, align: { default: null } },
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner: (state, node, type) => {
        parse(state, node, type)
        const align = readMarkdownAlignment(node)
        const parent = state.top()
        const block = parent?.content.at(-1)
        if (!align || !parent || !block || block.type !== type) return
        parent.content[parent.content.length - 1] = type.create({ ...block.attrs, align }, block.content, block.marks)
      },
    },
    toMarkdown: {
      ...schema.toMarkdown,
      runner: (state, node) => {
        const align: unknown = node.attrs.align
        const wrap = isWrittenAlignment(align) && state.top()?.type === 'root'
        if (wrap) state.addNode('html', undefined, alignmentOpeningTag(align))
        serialize(state, node)
        if (wrap) state.addNode('html', undefined, ALIGNMENT_CLOSING_TAG)
      },
    },
  }
}

/** HTML attribute that paints the alignment of a block. */
function blockAlignmentDomAttrs(align: unknown): Record<string, string> {
  return isWrittenAlignment(align) ? { 'data-align': align } : {}
}

/** Gives paragraphs and headings their alignment; call it from the editor's `config`. */
export function configureBlockAlignment(ctx: Ctx): void {
  ctx.update(paragraphSchema.key, (prev) => (schemaCtx) => withBlockAlignment(prev(schemaCtx)))
  ctx.update(headingSchema.key, (prev) => (schemaCtx) => withBlockAlignment(prev(schemaCtx)))
  ctx.set(paragraphAttr.key, (node) => blockAlignmentDomAttrs(node.attrs.align))
  ctx.set(headingAttr.key, (node) => blockAlignmentDomAttrs(node.attrs.align))
}

export const richTextPlugins: MilkdownPlugin[] = [
  richTextRemark,
  underlineSchema,
  textColorSchema,
  highlightSchema,
  underlineKeymap,
].flat()
