// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { $prose } from '@milkdown/kit/utils'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { breakCandidates, layoutPages, type MeasuredBlock, type PaginationGeometry } from './paginationPlugin'

/** Sheets of 1000px, 32px apart, with 100px margins and the number band. */
const GEOMETRY: PaginationGeometry = { pageHeight: 1000, pageGap: 32, margin: 100, numberBand: 18, zoom: 1 }

function stack(heights: number[], start = 100): MeasuredBlock[] {
  let top = start
  return heights.map((height, index) => {
    const block = { pos: index * 10, top, height }
    top += height
    return block
  })
}

describe('layoutPages', () => {
  it('keeps a note that fits on one sheet', () => {
    expect(layoutPages(stack([300, 300, 150]), GEOMETRY)).toEqual({ breaks: [], pageCount: 1 })
  })

  it('moves the block that does not fit to the top of the next sheet', () => {
    // The third block would end at 1000, past the text area (882).
    const { breaks, pageCount } = layoutPages(stack([300, 300, 300, 100]), GEOMETRY)
    expect(breaks).toEqual([{ pos: 20, height: 1132 - 700 }])
    expect(pageCount).toBe(2)
  })

  it('leaves a block taller than a sheet where it starts and continues after it', () => {
    const { breaks, pageCount } = layoutPages(stack([2000, 100]), GEOMETRY)
    // The tall block starts the page, so it is not moved; it ends in the top
    // margin of the third sheet, and the next block starts below that margin.
    expect(breaks).toEqual([{ pos: 10, height: 2164 - 2100 }])
    expect(pageCount).toBe(3)
  })

  it('takes a heading to the next page with the block it introduces', () => {
    const blocks = stack([300, 300, 150, 200])
    blocks[2] = { ...blocks[2]!, keepWithNext: true }
    // The heading (700–850) fits, but its paragraph (850–1050) does not.
    const { breaks, pageCount } = layoutPages(blocks, GEOMETRY)
    expect(breaks).toEqual([{ pos: 20, height: 1132 - 700 }])
    expect(pageCount).toBe(2)
  })

  it('takes a run of headings together', () => {
    const blocks = stack([300, 250, 60, 60, 200])
    blocks[2] = { ...blocks[2]!, keepWithNext: true }
    blocks[3] = { ...blocks[3]!, keepWithNext: true }
    // Both headings (650–770) fit, but the paragraph after them does not.
    expect(layoutPages(blocks, GEOMETRY).breaks).toEqual([{ pos: 20, height: 1132 - 650 }])
  })

  it('has one page for an empty note', () => {
    expect(layoutPages([], GEOMETRY)).toEqual({ breaks: [], pageCount: 1 })
  })

  it('uses the whole text area when the page has no number', () => {
    // They end at 890: past 882 with the number, within 900 without it.
    const blocks = stack([300, 300, 190])
    expect(layoutPages(blocks, GEOMETRY).breaks).toHaveLength(1)
    expect(layoutPages(blocks, { ...GEOMETRY, numberBand: 0 }).breaks).toEqual([])
  })
})

describe('breakCandidates', () => {
  let editor: Editor | null = null

  afterEach(async () => {
    await editor?.destroy()
    editor = null
  })

  it('finds the same elements as nodeDOM, in one walk past the widgets', async () => {
    // Widgets between the blocks, as the page spacers are.
    const spacers = new Plugin({
      props: {
        decorations: (state) => DecorationSet.create(state.doc, [3, 20, 40].map((pos) => {
          const at = Math.min(pos, state.doc.content.size)
          return Decoration.widget(TextSelection.near(state.doc.resolve(at)).$from.before(1), () => document.createElement('div'), { side: -1 })
        })),
      },
    })
    editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, document.createElement('div'))
        ctx.set(defaultValueCtx, ['# Título', '', 'Un párrafo.', '', '- uno', '- dos', '- tres', '', '```', 'código', '```', '', '1. primero', '2. segundo', '', '---', '', 'Fin.'].join('\n'))
      })
      .use(commonmark)
      .use(gfm)
      .use($prose(() => spacers))
      .create()
    const view = editor.action((ctx) => ctx.get(editorViewCtx))

    // The walk alone finds every element; nodeDOM is only what it is checked against.
    const nodeDOM = vi.spyOn(view, 'nodeDOM')
    const candidates = breakCandidates(view)
    expect(nodeDOM).not.toHaveBeenCalled()
    nodeDOM.mockRestore()
    const expected: number[] = []
    view.state.doc.forEach((node, offset) => {
      if ((node.type.name === 'bullet_list' || node.type.name === 'ordered_list') && node.childCount > 0) {
        node.forEach((_item, itemOffset) => expected.push(offset + 1 + itemOffset))
        return
      }
      expected.push(offset)
    })
    expect(candidates.map((candidate) => candidate.pos)).toEqual(expected)
    for (const candidate of candidates) {
      expect(candidate.dom).not.toBeNull()
      expect(candidate.dom).toBe(view.nodeDOM(candidate.pos))
      expect(candidate.node).toBe(view.state.doc.nodeAt(candidate.pos))
    }
  })
})
