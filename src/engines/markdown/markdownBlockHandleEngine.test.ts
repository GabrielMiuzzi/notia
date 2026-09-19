import { describe, expect, it } from 'vitest'
import { shouldShowMarkdownBlockHandle } from './markdownBlockHandleEngine'

describe('markdownBlockHandleEngine', () => {
  it('allows selectable blocks inside table cells', () => {
    expect(shouldShowMarkdownBlockHandle('code_block', false)).toBe(true)
    expect(shouldShowMarkdownBlockHandle('image_block', false)).toBe(true)
  })

  it('keeps the table handle while hiding intermediate table structure nodes', () => {
    expect(shouldShowMarkdownBlockHandle('table', false)).toBe(true)
    expect(shouldShowMarkdownBlockHandle('table_cell', false)).toBe(false)
    expect(shouldShowMarkdownBlockHandle('table_row', false)).toBe(false)
  })

  it('keeps nested block exclusions outside tables and allows them inside tables', () => {
    expect(shouldShowMarkdownBlockHandle('paragraph', true)).toBe(false)
    expect(shouldShowMarkdownBlockHandle('paragraph', true, true)).toBe(true)
  })
})
