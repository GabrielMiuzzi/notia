import { describe, expect, it } from 'vitest'
import type { OpenFileDocument } from '../../../types/views/fileDocument'
import {
  resolveGraphChatContextMode,
  resolveGraphAttachedContextPaths,
  resolveRightPanelAgentScope,
  resolveRightPanelAttachedContextPaths,
  resolveRightPanelContextScopeKey,
  resolveRightPanelPreferredContextMode,
} from './useRightPanelChatContext'

describe('resolveRightPanelPreferredContextMode', () => {
  it('does not attach Task Manager ticket contents directly', () => {
    expect(resolveRightPanelPreferredContextMode('task-manager', null)).toBe('index')
  })

  it('does not turn the active Markdown document into an attachment mode', () => {
    const document = {
      viewKind: 'markdown',
    } as OpenFileDocument

    expect(resolveRightPanelPreferredContextMode('documents', document)).toBeNull()
  })
})

describe('resolveRightPanelContextScopeKey', () => {
  it('tracks the active Markdown chat without attaching the file', () => {
    const document = {
      path: 'C:\\vault\\note.md',
      viewKind: 'markdown',
    } as OpenFileDocument

    expect(resolveRightPanelContextScopeKey('documents', document, null)).toBe('document:C:/vault/note.md')
    expect(resolveRightPanelAttachedContextPaths('documents', document)).toEqual([])
  })

  it('assigns stable and distinct scopes to Task Manager and Graph View', () => {
    expect(resolveRightPanelContextScopeKey('task-manager', null, null, '__finished__'))
      .toBe('task-manager:__finished__')
    expect(resolveRightPanelContextScopeKey('graph', null, null)).toBe('graph-view:right-panel')
  })
})

describe('resolveRightPanelAttachedContextPaths', () => {
  it('does not attach Task Manager files to the chat', () => {
    expect(resolveRightPanelAttachedContextPaths('task-manager', null)).toEqual([])
  })

  it('does not attach the active Markdown document to the composer', () => {
    const document = {
      path: 'C:/vault/note.md',
      name: 'note.md',
      source: '# Note',
      extension: 'md',
      viewKind: 'markdown',
    } as OpenFileDocument

    expect(resolveRightPanelAttachedContextPaths('documents', document)).toEqual([])
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

describe('resolveRightPanelAgentScope', () => {
  it('uses the finance scope while the Finance workspace is active', () => {
    expect(resolveRightPanelAgentScope('finance', null)).toBe('finance')
  })
})
