// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { HIGHLIGHT_MARK, TEXT_COLOR_MARK, UNDERLINE_MARK, configureBlockAlignment, richTextPlugins } from './richTextMarks'

async function openEditor(markdown: string) {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, document.createElement('div'))
      ctx.set(defaultValueCtx, markdown)
      configureBlockAlignment(ctx)
    })
    .use(commonmark)
    .use(gfm)
    .use(richTextPlugins)
    .create()
  const doc = editor.action((ctx) => ctx.get(editorViewCtx).state.doc)
  const output = editor.action(getMarkdown())
  await editor.destroy()
  return { doc, output }
}

function marksOf(doc: ProseMirrorNode, text: string) {
  let marks: string[] = []
  doc.descendants((node) => {
    if (node.isText && node.text === text) marks = node.marks.map((mark) => `${mark.type.name}${mark.attrs.color ? `:${mark.attrs.color}` : ''}`)
  })
  return marks.sort()
}

describe('rich text marks', () => {
  it('reads underline, text color and highlight and writes them back unchanged', async () => {
    const markdown = 'Uno <u>dos</u> <span data-color="teal">tres</span> <mark data-color="violet">cuatro</mark> **<u>cinco</u>**\n'
    const { doc, output } = await openEditor(markdown)
    expect(marksOf(doc, 'dos')).toEqual([UNDERLINE_MARK])
    expect(marksOf(doc, 'tres')).toEqual([`${TEXT_COLOR_MARK}:teal`])
    expect(marksOf(doc, 'cuatro')).toEqual([`${HIGHLIGHT_MARK}:violet`])
    expect(marksOf(doc, 'cinco')).toEqual([UNDERLINE_MARK, 'strong'])
    expect(output).toBe(markdown)
  })

  it('reads a bare mark as the yellow highlight', async () => {
    const { doc, output } = await openEditor('Texto <mark>marcado</mark>\n')
    expect(marksOf(doc, 'marcado')).toEqual([`${HIGHLIGHT_MARK}:yellow`])
    expect(output).toBe('Texto <mark data-color="yellow">marcado</mark>\n')
  })

  it('keeps unknown colors and other HTML as written', async () => {
    const markdown = 'A <span data-color="pink">b</span> <span class="x">c</span> <u>d\n'
    const { output } = await openEditor(markdown)
    expect(output).toBe(markdown)
  })

  it('aligns top-level paragraphs and headings with a div wrapper', async () => {
    const markdown = '<div align="center">\n\n## Título\n\n</div>\n\n<div align="right">\n\nDerecha *con* formato\n\n</div>\n\nNormal\n'
    const { doc, output } = await openEditor(markdown)
    expect(doc.child(0).attrs.align).toBe('center')
    expect(doc.child(1).attrs.align).toBe('right')
    expect(doc.child(2).attrs.align).toBeNull()
    expect(output).toBe(markdown)
  })

  it('leaves a wrapper around other blocks untouched', async () => {
    const markdown = '<div align="center">\n\n- uno\n- dos\n\n</div>\n'
    const { doc } = await openEditor(markdown)
    expect(doc.child(0).attrs.align ?? null).toBeNull()
  })
})
