// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, parserCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { getMarkdown } from '@milkdown/kit/utils'
import { insertInkBlock } from './inkInsertion'

const editors: Editor[] = []

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

/** An editor whose top-level blocks sit 40px apart and are 30px tall; inserts `markdown` at `top`. */
async function insertAt(source: string, markdown: string, top: number, emptyLineAtEnd = false): Promise<string> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, source)
    })
    .use(commonmark)
    .create()
  editors.push(editor)
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (emptyLineAtEnd) view.dispatch(view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create()))
    ;[...view.dom.children].forEach((element, index) => {
      const blockTop = index * 40
      element.getBoundingClientRect = () => ({ left: 0, right: 600, top: blockTop, bottom: blockTop + 30, width: 600, height: 30, x: 0, y: blockTop, toJSON: () => ({}) }) as DOMRect
    })
    expect(insertInkBlock(view, ctx.get(parserCtx)(markdown), top)).toBe(true)
    return getMarkdown()(ctx).trim()
  })
}

describe('insertInkBlock', () => {
  it('goes after the block the strokes start over', async () => {
    expect(await insertAt('Uno\n\nDos', '# Nuevo', 50)).toBe('Uno\n\nDos\n\n# Nuevo')
  })

  it('goes before the next block when the strokes are in a gap', async () => {
    expect(await insertAt('Uno\n\nDos', 'Nuevo', 32)).toBe('Uno\n\nNuevo\n\nDos')
  })

  it('replaces the empty line under the strokes', async () => {
    expect(await insertAt('Uno', '## Nuevo', 45, true)).toBe('Uno\n\n## Nuevo')
  })

  it('goes at the end below the last block', async () => {
    expect(await insertAt('Uno', 'Nuevo', 500)).toBe('Uno\n\nNuevo')
  })
})
