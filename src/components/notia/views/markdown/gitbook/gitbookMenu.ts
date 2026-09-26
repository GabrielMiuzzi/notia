import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseMirrorNode, Schema } from '@milkdown/kit/prose/model'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { iconMarkup } from './gitbookIcons'
import { GITBOOK_SCHEMA_NAMES as N } from './gitbookSchema'

/*
 * The GitBook blocks in the editor's `/` menu (and the block handle's `+`).
 * A block replaces the line that holds the command; an inline element goes
 * there too, and the format toolbar also inserts it in the middle of a line.
 * New blocks start with an empty paragraph, or with their fields open when
 * they need an address or a path.
 */

interface MenuGroupBuilder {
  addGroup: (key: string, label: string) => {
    addItem: (key: string, item: { label: string; icon: string; onRun: (ctx: Ctx) => void }) => unknown
  }
}

type Build = (schema: Schema) => ProseMirrorNode | null

function paragraph(schema: Schema): ProseMirrorNode {
  return (schema.nodes.paragraph as NonNullable<Schema['nodes'][string]>).create()
}

function container(name: string, attrs: Record<string, unknown> = {}): Build {
  return (schema) => schema.nodes[name]?.create(attrs, paragraph(schema)) ?? null
}

function parts(parentName: string, partName: string, count: number, attrs: (index: number) => Record<string, unknown>, parentAttrs: Record<string, unknown> = {}): Build {
  return (schema) => {
    const part = schema.nodes[partName]
    const parent = schema.nodes[parentName]
    if (!part || !parent) return null
    return parent.create(parentAttrs, Array.from({ length: count }, (_, index) => part.create(attrs(index), paragraph(schema))))
  }
}

function atom(name: string, attrs: Record<string, unknown> = {}): Build {
  return (schema) => schema.nodes[name]?.create(attrs) ?? null
}

function insertBlock(ctx: Ctx, build: Build): void {
  ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key)
  const view = ctx.get(editorViewCtx)
  const node = build(view.state.schema)
  if (!node) return
  const { $from } = view.state.selection
  const isEmptyLine = $from.parent.isTextblock && $from.parent.content.size === 0 && $from.depth > 0
  const from = isEmptyLine ? $from.before() : $from.after(Math.max(1, $from.depth))
  const to = isEmptyLine ? $from.after() : from
  const tr = view.state.tr.replaceWith(from, to, node)
  const selection = node.isAtom
    ? NodeSelection.create(tr.doc, from)
    : TextSelection.near(tr.doc.resolve(Math.min(from + 1, tr.doc.content.size)))
  view.dispatch(tr.setSelection(selection).scrollIntoView())
  view.focus()
}

export type GitbookInlineKind = 'button' | 'icon' | 'expression' | 'inlineImage' | 'annotation'

export const GITBOOK_INLINE_ITEMS: ReadonlyArray<{ kind: GitbookInlineKind; key: string; label: string; icon: string }> = [
  { kind: 'button', key: 'gitbook-button', label: 'Botón', icon: 'notia-button' },
  { kind: 'icon', key: 'gitbook-icon', label: 'Ícono', icon: 'star' },
  { kind: 'expression', key: 'gitbook-expression', label: 'Variable', icon: 'notia-variable' },
  { kind: 'inlineImage', key: 'gitbook-inline-image', label: 'Imagen en línea', icon: 'image' },
  { kind: 'annotation', key: 'gitbook-annotation', label: 'Anotación', icon: 'notia-annotation' },
]

/** First free annotation number of the document. */
function nextAnnotationLabel(doc: ProseMirrorNode): string {
  const labels = new Set<string>()
  doc.descendants((node) => {
    if (node.type.name === 'footnote_definition' || node.type.name === 'footnote_reference') labels.add(String(node.attrs.label))
  })
  let number = 1
  while (labels.has(String(number))) number += 1
  return String(number)
}

/**
 * Puts an inline element at the selection. Selected text becomes the label
 * of a button or the expression of a variable; icons, images and
 * annotations go after it and keep the text. An annotation also adds its
 * note at the end of the document and moves there to write it.
 */
export function insertGitbookInline(view: EditorView, kind: GitbookInlineKind): void {
  const { state } = view
  const { schema } = state
  const { from, to, empty } = state.selection
  const selected = empty ? '' : state.doc.textBetween(from, to, ' ').trim()
  let tr = state.tr
  if (kind === 'button' || kind === 'expression') {
    const node = kind === 'button'
      ? schema.nodes[N.button]?.create({ label: selected || 'Botón', href: '', variant: 'primary' })
      : schema.nodes[N.expression]?.create({ expression: selected })
    if (!node) return
    tr = tr.replaceWith(from, to, node)
  } else if (kind === 'annotation') {
    const reference = schema.nodes.footnote_reference
    const definition = schema.nodes.footnote_definition
    if (!reference || !definition) return
    const label = nextAnnotationLabel(state.doc)
    tr = tr.insert(to, reference.create({ label }))
    const end = tr.doc.content.size
    tr = tr.insert(end, definition.create({ label }, paragraph(schema)))
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(end + 2)))
  } else {
    const node = kind === 'icon'
      ? schema.nodes[N.icon]?.create({ name: 'star', label: 'star' })
      : schema.nodes[N.inlineImage]?.create()
    if (!node) return
    tr = tr.insert(to, node)
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

function insertInline(ctx: Ctx, kind: GitbookInlineKind): void {
  ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key)
  insertGitbookInline(ctx.get(editorViewCtx), kind)
}

const BLOCKS: Array<[string, string, string, Build]> = [
  ['gitbook-hint', 'Aviso', 'info', container(N.hint, { style: 'info' })],
  ['gitbook-tabs', 'Pestañas', 'notia-tabs', parts(N.tabs, N.tab, 2, (index) => ({ title: `Pestaña ${index + 1}` }))],
  ['gitbook-details', 'Desplegable', 'notia-details', container(N.details, { summary: 'Más información', open: false })],
  ['gitbook-stepper', 'Pasos', 'notia-steps', parts(N.stepper, N.step, 2, () => ({}))],
  ['gitbook-columns', 'Columnas', 'notia-columns', parts(N.columns, N.column, 2, () => ({}))],
  ['gitbook-updates', 'Novedades', 'notia-updates', parts(N.updates, N.update, 1, () => ({ date: '', tags: '' }), { format: 'full' })],
  ['gitbook-code', 'Código con título', 'notia-code', (schema) => {
    const code = schema.nodes.code_block?.create({ language: '' })
    return code ? schema.nodes[N.code]?.create({ title: '' }, code) ?? null : null
  }],
  ['gitbook-prompt', 'Prompt', 'notia-prompt', container(N.prompt)],
  ['gitbook-condition', 'Contenido condicional', 'notia-condition', container(N.condition, { expression: '' })],
  ['gitbook-cards', 'Tarjetas', 'notia-cards', atom(N.cards, { cards: JSON.stringify([{ title: '', description: '', target: '', cover: '', icon: '' }]) })],
  ['gitbook-embed', 'URL embebida', 'notia-embed', atom(N.embed)],
  ['gitbook-file', 'Archivo', 'notia-file', atom(N.file)],
  ['gitbook-page-link', 'Enlace a página', 'notia-page', atom(N.contentRef)],
  ['gitbook-include', 'Contenido reutilizable', 'notia-include', atom(N.include)],
  ['gitbook-drawing', 'Dibujo', 'notia-drawing', atom(N.drawing, { alt: 'Dibujo' })],
]

export function addGitbookMenu(builder: MenuGroupBuilder): void {
  const blocks = builder.addGroup('gitbook', 'Bloques GitBook')
  BLOCKS.forEach(([key, label, icon, build]) => {
    blocks.addItem(key, { label, icon: iconMarkup(icon, 20), onRun: (ctx) => insertBlock(ctx, build) })
  })
  const inline = builder.addGroup('gitbook-inline', 'En la línea')
  GITBOOK_INLINE_ITEMS.forEach(({ kind, key, label, icon }) => {
    inline.addItem(key, { label, icon: iconMarkup(icon, 20), onRun: (ctx) => insertInline(ctx, kind) })
  })
}
