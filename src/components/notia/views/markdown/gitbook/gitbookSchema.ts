import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { editorStateTimerCtx, parserCtx, ParserReady } from '@milkdown/kit/core'
import { createTimer } from '@milkdown/kit/ctx'
import type { NodeSchema } from '@milkdown/kit/transformer'
import type { MarkdownNode } from '@milkdown/kit/transformer'
import { $nodeSchema, $remark } from '@milkdown/kit/utils'
import {
  GITBOOK_NODE,
  gitbookMarkdownHandlers,
  isolateGitbookBlocks,
  transformGitbookMarkdown,
} from '../../../../../engines/markdown/gitbookMarkdown'

/*
 * GitBook blocks as ProseMirror nodes. Each node keeps the attributes of its
 * GitBook tag; the Markdown tree carries them with the same names, so one
 * description per node reads and writes it.
 */

type AttrDefaults = Record<string, string | boolean>

interface GitbookNodeSpec {
  /** ProseMirror name. */
  name: string
  /** Node of the Markdown tree (`GITBOOK_NODE`). */
  markdown: string
  attrs: AttrDefaults
  content?: string
  group?: string
  inline?: boolean
  atom?: boolean
  isolating?: boolean
}

export const GITBOOK_SCHEMA_NAMES = {
  hint: 'gitbook_hint',
  tabs: 'gitbook_tabs',
  tab: 'gitbook_tab',
  stepper: 'gitbook_stepper',
  step: 'gitbook_step',
  columns: 'gitbook_columns',
  column: 'gitbook_column',
  updates: 'gitbook_updates',
  update: 'gitbook_update',
  code: 'gitbook_code',
  prompt: 'gitbook_prompt',
  condition: 'gitbook_condition',
  details: 'gitbook_details',
  embed: 'gitbook_embed',
  file: 'gitbook_file',
  contentRef: 'gitbook_content_ref',
  include: 'gitbook_include',
  cards: 'gitbook_cards',
  drawing: 'gitbook_drawing',
  button: 'gitbook_button',
  icon: 'gitbook_icon',
  expression: 'gitbook_expression',
  inlineImage: 'gitbook_inline_image',
} as const

type GitbookKey = keyof typeof GITBOOK_SCHEMA_NAMES

const block = (key: GitbookKey, attrs: AttrDefaults, content = 'block+', extra: Partial<GitbookNodeSpec> = {}): GitbookNodeSpec => ({
  name: GITBOOK_SCHEMA_NAMES[key], markdown: GITBOOK_NODE[key], attrs, content, group: 'block', ...extra,
})
const part = (key: GitbookKey, attrs: AttrDefaults): GitbookNodeSpec => ({
  name: GITBOOK_SCHEMA_NAMES[key], markdown: GITBOOK_NODE[key], attrs, content: 'block+', isolating: true,
})
const atom = (key: GitbookKey, attrs: AttrDefaults): GitbookNodeSpec => ({
  name: GITBOOK_SCHEMA_NAMES[key], markdown: GITBOOK_NODE[key], attrs, group: 'block', atom: true,
})
const inlineAtom = (key: GitbookKey, attrs: AttrDefaults): GitbookNodeSpec => ({
  name: GITBOOK_SCHEMA_NAMES[key], markdown: GITBOOK_NODE[key], attrs, group: 'inline', inline: true, atom: true,
})

export const GITBOOK_NODE_SPECS: GitbookNodeSpec[] = [
  block('hint', { style: 'info', icon: '' }),
  block('tabs', {}, `${GITBOOK_SCHEMA_NAMES.tab}+`, { isolating: true }),
  part('tab', { title: '' }),
  block('stepper', {}, `${GITBOOK_SCHEMA_NAMES.step}+`, { isolating: true }),
  part('step', {}),
  block('columns', {}, `${GITBOOK_SCHEMA_NAMES.column}+`, { isolating: true }),
  part('column', { width: '' }),
  block('updates', { format: 'full' }, `${GITBOOK_SCHEMA_NAMES.update}+`, { isolating: true }),
  part('update', { date: '', tags: '' }),
  block('code', { title: '', lineNumbers: false, wrap: false }, 'code_block', { isolating: true }),
  block('prompt', { description: '', icon: '', openInProviders: '', visibility: '' }),
  block('condition', { expression: '' }),
  block('details', { summary: '', open: false }),
  atom('embed', { url: '', caption: '' }),
  atom('file', { src: '', caption: '' }),
  atom('contentRef', { url: '', label: '' }),
  atom('include', { reference: '' }),
  atom('cards', { cards: '[]', source: '', sourceCards: '' }),
  atom('drawing', { src: '', alt: '', caption: '' }),
  inlineAtom('button', { href: '', label: '', variant: 'primary', icon: '' }),
  inlineAtom('icon', { name: '', label: '' }),
  inlineAtom('expression', { expression: '' }),
  inlineAtom('inlineImage', { src: '', alt: '' }),
]

function attrsOf(source: Record<string, unknown>, defaults: AttrDefaults): Record<string, string | boolean> {
  return Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => {
    const value = source[name]
    return [name, typeof value === typeof fallback ? value as string | boolean : fallback]
  }))
}

function nodeSchema(spec: GitbookNodeSpec): NodeSchema {
  const tag = spec.inline ? 'span' : 'div'
  return {
    ...(spec.content ? { content: spec.content } : {}),
    ...(spec.group ? { group: spec.group } : {}),
    ...(spec.inline ? { inline: true } : {}),
    ...(spec.atom ? { atom: true, selectable: true, draggable: !spec.inline } : { defining: true }),
    ...(spec.isolating ? { isolating: true } : {}),
    attrs: Object.fromEntries(Object.entries(spec.attrs).map(([name, fallback]) => [name, { default: fallback }])),
    // Copy and paste inside the editor keep every attribute.
    parseDOM: [{
      tag: `${tag}[data-gitbook="${spec.name}"]`,
      getAttrs: (dom) => {
        try {
          return attrsOf(JSON.parse((dom as HTMLElement).getAttribute('data-attrs') ?? '{}') as Record<string, unknown>, spec.attrs)
        } catch {
          return {}
        }
      },
    }],
    toDOM: (node) => {
      const attrs = { 'data-gitbook': spec.name, 'data-attrs': JSON.stringify(node.attrs) }
      return spec.atom ? [tag, attrs] : [tag, attrs, 0]
    },
    parseMarkdown: {
      match: (node) => node.type === spec.markdown,
      runner: (state, node, type) => {
        const attrs = attrsOf(node as unknown as Record<string, unknown>, spec.attrs)
        if (spec.atom) {
          state.addNode(type, attrs)
        } else {
          state.openNode(type, attrs).next(node.children).closeNode()
        }
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === spec.name,
      runner: (state, node) => {
        if (spec.atom) {
          state.addNode(spec.markdown, undefined, undefined, { ...node.attrs })
        } else {
          state.openNode(spec.markdown, undefined, { ...node.attrs }).next(node.content).closeNode()
        }
      },
    },
  }
}

export const gitbookNodeSchemas = GITBOOK_NODE_SPECS.map((spec) => $nodeSchema(spec.name, () => nodeSchema(spec)))

/** Reads the GitBook blocks out of the Markdown tree and registers how they are written back. */
export const gitbookRemark = $remark('notiaGitbook', () => function notiaGitbook(this: { data: () => unknown }) {
  // The same registry remark-gfm uses to add its serializers.
  const data = this.data() as { toMarkdownExtensions?: unknown[] }
  const extensions = (data.toMarkdownExtensions ??= [])
  extensions.push({ handlers: gitbookMarkdownHandlers })
  return (tree: unknown, file: { value?: unknown }) => {
    transformGitbookMarkdown(tree as MarkdownNode, String(file.value ?? ''))
  }
})

const GitbookParserReady = createTimer('GitbookParserReady')

/**
 * Prepares every text the editor parses (the note, a replacement, a paste)
 * so the GitBook tags stand on lines of their own; see `isolateGitbookBlocks`.
 * The editor waits for it before it reads the note.
 */
export const gitbookParser: MilkdownPlugin = (ctx) => {
  ctx.record(GitbookParserReady)
  ctx.update(editorStateTimerCtx, (timers) => timers.concat(GitbookParserReady))
  return async () => {
    await ctx.wait(ParserReady)
    const parse = ctx.get(parserCtx)
    ctx.set(parserCtx, (text: string) => parse(isolateGitbookBlocks(text)))
    ctx.done(GitbookParserReady)
    return () => {
      ctx.set(parserCtx, parse)
      ctx.clearTimer(GitbookParserReady)
    }
  }
}

export const gitbookSchemaPlugins: MilkdownPlugin[] = [
  gitbookParser,
  gitbookRemark,
  ...gitbookNodeSchemas,
].flat()
