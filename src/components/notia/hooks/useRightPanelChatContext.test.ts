import { describe, expect, it } from 'vitest'
import type { OpenFileDocument } from '../../../types/views/fileDocument'
import {
  resolveGraphChatContextMode,
  resolveGraphAttachedContextPaths,
  resolveRightPanelAttachedContextPaths,
  resolveRightPanelPreferredContextMode,
} from './useRightPanelChatContext'

describe('resolveRightPanelPreferredContextMode', () => {
  it('does not attach Task Manager ticket contents directly', () => {
    expect(resolveRightPanelPreferredContextMode('task-manager', null)).toBe('index')
  })

  it('keeps a regular Markdown document as reference-only context', () => {
    const document = {
      viewKind: 'markdown',
    } as OpenFileDocument

    expect(resolveRightPanelPreferredContextMode('documents', document)).toBe('index')
  })
})

describe('resolveRightPanelAttachedContextPaths', () => {
  it('does not attach Task Manager files to the chat', () => {
    expect(resolveRightPanelAttachedContextPaths('task-manager', null)).toEqual([])
  })

  it('keeps the active Markdown document as explicit context outside Task Manager', () => {
    const document = {
      path: 'C:/vault/note.md',
      name: 'note.md',
      source: '# Note',
      extension: 'md',
      viewKind: 'markdown',
    } as OpenFileDocument

    expect(resolveRightPanelAttachedContextPaths('documents', document)).toEqual(['C:/vault/note.md'])
  })
})

describe('resolveGraphChatContextMode', () => {
  it('uses RAG for the complete graph library without an explicit selection', () => {
    expect(resolveGraphChatContextMode(false)).toBe('index')
  })

  it('sends explicitly selected graph files as full direct context', () => {
    expect(resolveGraphChatContextMode(true)).toBe('direct')
  })
})

describe('resolveGraphAttachedContextPaths', () => {
  it('keeps the complete graph library internal to the agent when there is no selection', () => {
    expect(resolveGraphAttachedContextPaths(['one.md', 'two.md'], false)).toEqual([])
  })

  it('attaches only paths explicitly selected in Graph View', () => {
    expect(resolveGraphAttachedContextPaths(['selected.md'], true)).toEqual(['selected.md'])
  })
})
