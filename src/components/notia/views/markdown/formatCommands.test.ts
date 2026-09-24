// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdown } from '@milkdown/kit/utils'
import {
  clearFormatting,
  formattableBlockRange,
  isFormattableSelection,
  readFormatState,
  selectBlockText,
  setBlockAlignment,
  setBlockKind,
  setColorMark,
  toggleFormatMark,
} from './formatCommands'
import { HIGHLIGHT_MARK, TEXT_COLOR_MARK, UNDERLINE_MARK, configureBlockAlignment, richTextPlugins } from './richTextMarks'

let editor: Editor | null = null

async function open(markdown: string): Promise<EditorView> {
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, document.createElement('div'))
      ctx.set(defaultValueCtx, markdown)
      configureBlockAlignment(ctx)
    })
    .use(commonmark)
    .use(gfm)
    .use(richTextPlugins)
    .create()
  return editor.action((ctx) => ctx.get(editorViewCtx))
}

function markdown(): string {
  return editor?.action(getMarkdown()) ?? ''
}

function positionOf(view: EditorView, text: string): number {
  let from = -1
  view.state.doc.descendants((node, pos) => {
    if (from >= 0 || !node.isText) return from < 0
    const index = node.text?.indexOf(text) ?? -1
    if (index >= 0) from = pos + index
    return false
  })
  if (from < 0) throw new Error(`"${text}" not found`)
  return from
}

/** Selects from the first occurrence of `text` to the end of `until` (or of `text`). */
function select(view: EditorView, text: string, until = text): void {
  const from = positionOf(view, text)
  const to = positionOf(view, until) + until.length
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
}

describe('format commands', () => {
  afterEach(async () => {
    await editor?.destroy()
    editor = null
  })

  it('toggles character marks on the selection', async () => {
    const view = await open('Uno dos tres\n')
    select(view, 'dos')
    toggleFormatMark(view, UNDERLINE_MARK)
    toggleFormatMark(view, 'strong')
    expect(readFormatState(view.state).marks).toMatchObject({ strong: true, [UNDERLINE_MARK]: true, emphasis: false })
    expect(markdown()).toBe('Uno **<u>dos</u>** tres\n')
    toggleFormatMark(view, 'strong')
    expect(markdown()).toBe('Uno <u>dos</u> tres\n')
  })

  it('replaces the color and highlight and clears them with the rest of the formatting', async () => {
    const view = await open('Texto con [enlace](https://example.com) final\n')
    select(view, 'con', 'enlace')
    setColorMark(view, TEXT_COLOR_MARK, 'teal')
    setColorMark(view, TEXT_COLOR_MARK, 'red')
    setColorMark(view, HIGHLIGHT_MARK, 'yellow')
    toggleFormatMark(view, 'emphasis')
    expect(readFormatState(view.state)).toMatchObject({ textColor: 'red', highlight: 'yellow' })
    clearFormatting(view)
    expect(markdown()).toBe('Texto con [enlace](https://example.com) final\n')
  })

  it('changes the kind of a block, leaving lists first', async () => {
    const view = await open('- Primero\n- Segundo\n')
    select(view, 'Segundo')
    expect(readFormatState(view.state).blockKind).toBe('bullet')
    setBlockKind(view, 'heading2')
    expect(markdown()).toBe('* Primero\n\n## Segundo\n')
    setBlockKind(view, 'quote')
    expect(markdown()).toBe('* Primero\n\n> Segundo\n')
    setBlockKind(view, 'paragraph')
    expect(markdown()).toBe('* Primero\n\nSegundo\n')
  })

  it('aligns top-level paragraphs and headings only', async () => {
    const view = await open('# Título\n\n- En lista\n')
    select(view, 'Título')
    setBlockAlignment(view, 'center')
    expect(markdown()).toBe('<div align="center">\n\n# Título\n\n</div>\n\n* En lista\n')
    select(view, 'En lista')
    expect(readFormatState(view.state).canAlign).toBe(false)
    setBlockAlignment(view, 'right')
    expect(markdown()).toContain('* En lista')
    select(view, 'Título')
    setBlockAlignment(view, 'left')
    expect(markdown()).toBe('# Título\n\n* En lista\n')
  })

  it('formats a whole block picked with the handle', async () => {
    const view = await open('Uno\n\nDos\n')
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
    expect(isFormattableSelection(view.state)).toBe(true)
    toggleFormatMark(view, 'strike_through')
    expect(markdown()).toBe('~~Uno~~\n\nDos\n')
  })

  it('formats the whole block under the pointer when there is no selection', async () => {
    const view = await open('# Título\n\n- Uno **negrita**\n\nDos\n')
    let listItem = -1
    view.state.doc.descendants((node, pos) => {
      if (listItem < 0 && node.type.name === 'list_item') listItem = pos
      return listItem < 0
    })
    const range = formattableBlockRange(view.state, listItem)
    expect(range).not.toBeNull()
    expect(readFormatState(view.state, range ?? undefined)).toMatchObject({ blockKind: 'bullet', marks: { strong: true } })

    selectBlockText(view, listItem)
    toggleFormatMark(view, UNDERLINE_MARK)
    expect(markdown()).toBe('# Título\n\n* <u>Uno</u> **<u>negrita</u>**\n\nDos\n')
  })

  it('offers no block toolbar for empty blocks, code or table cells', async () => {
    const view = await open('Texto\n\n```js\nconst a = 1\n```\n\n| A |\n| - |\n| b |\n')
    const positions: Record<string, number> = {}
    view.state.doc.descendants((node, pos) => {
      if (!(node.type.name in positions)) positions[node.type.name] = pos
      return true
    })
    expect(formattableBlockRange(view.state, positions.paragraph ?? -1)).not.toBeNull()
    expect(formattableBlockRange(view.state, positions.code_block ?? -1)).toBeNull()
    let cellParagraph = -1
    view.state.doc.descendants((node, pos, parent) => {
      if (cellParagraph < 0 && node.type.name === 'paragraph' && parent?.type.name.startsWith('table')) cellParagraph = pos
      return true
    })
    expect(formattableBlockRange(view.state, cellParagraph)).toBeNull()
  })

  it('does not offer formatting inside code blocks or for an empty selection', async () => {
    const view = await open('```js\nconst a = 1\n```\n\nTexto\n')
    select(view, 'const')
    expect(isFormattableSelection(view.state)).toBe(false)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 2)))
    expect(isFormattableSelection(view.state)).toBe(false)
  })
})
