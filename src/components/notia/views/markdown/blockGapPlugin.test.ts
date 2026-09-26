// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdown } from '@milkdown/kit/utils'
import { handleClickBelowContent, pickGapIndex, type GapChild } from './blockGapPlugin'

const block = (top: number, bottom: number, isTextLine = false): GapChild => ({ top, bottom, isTextLine })

describe('pickGapIndex', () => {
  const code = block(0, 100)
  const table = block(104, 200)
  const paragraph = block(210, 230, true)

  it('adds a line between two blocks that are not text', () => {
    expect(pickGapIndex([code, table], 102, 6, 300)).toBe(1)
    expect(pickGapIndex([code, table], 96, 6, 300)).toBe(1)
    expect(pickGapIndex([code, table], 108, 6, 300)).toBe(1)
  })

  it('leaves clicks well inside a block to the block', () => {
    expect(pickGapIndex([code, table], 50, 6, 300)).toBeNull()
    expect(pickGapIndex([code, table], 150, 6, 300)).toBeNull()
  })

  it('does nothing where a paragraph already is the next line', () => {
    expect(pickGapIndex([table, paragraph], 205, 6, 300)).toBeNull()
    expect(pickGapIndex([block(0, 20, true), block(24, 100)], 22, 6, 300)).toBeNull()
  })

  it('adds a line under the last block of a container, down to its bottom', () => {
    const children = [block(0, 20, true), block(24, 100)]
    expect(pickGapIndex(children, 106, 6, 112)).toBe(2)
    expect(pickGapIndex(children, 125, 6, 112)).toBeNull()
  })

  it('reaches further into the blocks for a finger', () => {
    expect(pickGapIndex([code, table], 90, 6, 300)).toBeNull()
    expect(pickGapIndex([code, table], 90, 12, 300)).toBe(1)
  })
})

describe('handleClickBelowContent', () => {
  let editor: Editor | null = null
  const surface = { left: 0, right: 800, top: 0, bottom: 1000 } as DOMRect

  afterEach(async () => {
    await editor?.destroy()
    editor = null
  })

  /** Opens a note whose last block ends at y = 100. */
  async function open(markdown: string): Promise<EditorView> {
    editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, document.createElement('div'))
        ctx.set(defaultValueCtx, markdown)
      })
      .use(commonmark)
      .create()
    const view = editor.action((ctx) => ctx.get(editorViewCtx))
    const last = view.dom.lastElementChild as HTMLElement
    last.getBoundingClientRect = () => ({ top: 80, bottom: 100, left: 0, right: 800, width: 800, height: 20 }) as DOMRect
    return view
  }

  const clickAt = (clientY: number) => new MouseEvent('mousedown', { button: 0, clientX: 100, clientY, cancelable: true })

  it('starts a new line under a note that ends in a list', async () => {
    const view = await open('Texto\n\n- uno\n- dos\n')
    expect(handleClickBelowContent(view, clickAt(300), surface)).toBe(true)
    view.dispatch(view.state.tr.insertText('Z'))
    expect(editor?.action(getMarkdown()).trim().endsWith('\n\nZ')).toBe(true)
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph')
  })

  it('reuses the empty line the note already ends in', async () => {
    const view = await open('Texto\n')
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create()))
    const count = view.state.doc.childCount
    const last = view.dom.lastElementChild as HTMLElement
    last.getBoundingClientRect = () => ({ top: 80, bottom: 100 }) as DOMRect
    expect(handleClickBelowContent(view, clickAt(300), surface)).toBe(true)
    expect(view.state.doc.childCount).toBe(count)
    expect(view.state.selection.$from.parent.content.size).toBe(0)
  })

  it('leaves clicks on the last block and outside the page alone', async () => {
    const view = await open('Texto [[Alfa]]\n')
    expect(handleClickBelowContent(view, clickAt(90), surface)).toBe(false)
    const outside = new MouseEvent('mousedown', { button: 0, clientX: 900, clientY: 300 })
    expect(handleClickBelowContent(view, outside, surface)).toBe(false)
    expect(view.state.doc.childCount).toBe(1)
  })
})
