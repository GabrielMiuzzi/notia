import { describe, expect, it } from 'vitest'
import type { OpenFileDocument } from '../../../types/views/fileDocument'
import { resolveRightPanelPreferredContextMode } from './useRightPanelChatContext'

describe('resolveRightPanelPreferredContextMode', () => {
  it('sends Task Manager ticket contents to the right-panel chat', () => {
    expect(resolveRightPanelPreferredContextMode('task-manager', null)).toBe('direct')
  })

  it('keeps a regular Markdown document as reference-only context', () => {
    const document = {
      viewKind: 'markdown',
    } as OpenFileDocument

    expect(resolveRightPanelPreferredContextMode('documents', document)).toBe('index')
  })
})
