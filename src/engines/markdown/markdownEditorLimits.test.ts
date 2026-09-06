import { describe, expect, it } from 'vitest'
import {
  formatMarkdownSourceSize,
  MARKDOWN_EDITOR_MAX_SOURCE_LENGTH,
  shouldUseLargeMarkdownView,
} from './markdownEditorLimits'

describe('Markdown editor limits', () => {
  it('keeps regular documents in the visual editor', () => {
    expect(shouldUseLargeMarkdownView('x'.repeat(MARKDOWN_EDITOR_MAX_SOURCE_LENGTH))).toBe(false)
  })

  it('protects the UI from documents above the editor budget', () => {
    expect(shouldUseLargeMarkdownView('x'.repeat(MARKDOWN_EDITOR_MAX_SOURCE_LENGTH + 1))).toBe(true)
  })

  it('formats the size shown in the large document warning', () => {
    expect(formatMarkdownSourceSize(18 * 1024 * 1024)).toBe('18 MB')
    expect(formatMarkdownSourceSize(12_000)).toBe('12 mil caracteres')
  })
})
