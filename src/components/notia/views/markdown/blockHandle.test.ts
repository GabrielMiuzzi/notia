// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { EditorView } from '@milkdown/kit/prose/view'
import { isPageBreakRow } from './blockHandle'

/** A list whose page break spans rows 900–1160, as the pagination plugin draws it. */
function viewWithSplitList(): EditorView {
  const dom = document.createElement('div')
  const list = document.createElement('ul')
  const spacer = document.createElement('div')
  spacer.className = 'notia-page-spacer'
  spacer.getBoundingClientRect = () => new DOMRect(0, 900, 600, 260)
  list.append(document.createElement('li'), spacer, document.createElement('li'))
  dom.append(list)
  return { dom } as unknown as EditorView
}

describe('isPageBreakRow', () => {
  it('matches the rows between two sheets, even inside a list', () => {
    const view = viewWithSplitList()
    expect(isPageBreakRow(view, 900)).toBe(true)
    expect(isPageBreakRow(view, 1030)).toBe(true)
  })

  it('leaves the text rows on both sheets alone', () => {
    const view = viewWithSplitList()
    expect(isPageBreakRow(view, 880)).toBe(false)
    expect(isPageBreakRow(view, 1160)).toBe(false)
  })

  it('never matches in continuous mode', () => {
    const dom = document.createElement('div')
    dom.append(document.createElement('p'))
    expect(isPageBreakRow({ dom } as unknown as EditorView, 500)).toBe(false)
  })
})
