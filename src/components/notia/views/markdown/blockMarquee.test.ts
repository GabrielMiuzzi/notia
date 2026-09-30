// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { $prose } from '@milkdown/kit/utils'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createBlockSelectionPlugin, selectBlocksInRect } from './blockMarquee'

const editors: Editor[] = []

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

/** An editor whose top-level blocks sit 40px apart, 30px tall, from x 100 to 700. */
async function openEditor(markdown: string): Promise<EditorView> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdown)
    })
    .use(commonmark)
    .use($prose(() => createBlockSelectionPlugin()))
    .create()
  editors.push(editor)
  const view = editor.action((ctx) => ctx.get(editorViewCtx))
  ;[...view.dom.children].forEach((element, index) => {
    const top = index * 40
    element.getBoundingClientRect = () => ({ left: 100, right: 700, top, bottom: top + 30, width: 600, height: 30, x: 100, y: top, toJSON: () => ({}) }) as DOMRect
  })
  return view
}

describe('blockMarquee', () => {
  it('selects the blocks a rectangle touches and paints them', async () => {
    const view = await openEditor('Uno\n\nDos\n\nTres\n\nCuatro')
    // From the left margin, across the second and third blocks.
    expect(selectBlocksInRect(view, { left: 40, right: 300, top: 50, bottom: 95 })).toBe(true)
    const { from, to } = view.state.selection
    expect(view.state.doc.textBetween(from, to, '\n')).toBe('Dos\nTres')
    expect([...view.dom.querySelectorAll('.notia-block-selected')].map((block) => block.textContent)).toEqual(['Dos', 'Tres'])
  })

  it('selects nothing when the rectangle stays in the margin, and a new selection clears the paint', async () => {
    const view = await openEditor('Uno\n\nDos')
    expect(selectBlocksInRect(view, { left: 0, right: 60, top: 0, bottom: 80 })).toBe(false)
    expect(view.dom.querySelectorAll('.notia-block-selected')).toHaveLength(0)
    selectBlocksInRect(view, { left: 40, right: 300, top: 0, bottom: 70 })
    expect(view.dom.querySelectorAll('.notia-block-selected')).toHaveLength(2)
    // Typing over the selection changes the note: the paint goes.
    view.dispatch(view.state.tr.insertText('x'))
    expect(view.dom.querySelectorAll('.notia-block-selected')).toHaveLength(0)
  })
})
