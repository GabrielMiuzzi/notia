import { describe, expect, it } from 'vitest'
import {
  isToolResult,
  isWebSearchRequest,
  isWorkspaceAiSnapshot,
  type WorkspaceAiSnapshot,
} from './agentContracts'

const capabilities = {
  canReadActiveDocument: true,
  canReadLibrary: true,
  canReadTasks: false,
  canReadFinance: false,
  canWriteActiveDocument: true,
  canWriteLibrary: false,
  canWriteTasks: false,
  canWriteFinance: false,
  canSearchWeb: true,
  canAskClarification: true,
  canRequestConfirmation: true,
  canPlan: true,
  canUndo: true,
}

const snapshot: WorkspaceAiSnapshot = {
  snapshotVersion: 1,
  view: 'documents',
  scope: 'document',
  library: { id: 'library-1', name: 'Notas', path: 'C:/vault' },
  activeDocument: {
    path: 'C:/vault/nota.md',
    name: 'nota.md',
    kind: 'markdown',
    revision: 4,
    dirty: true,
    source: '# Nota',
  },
  activeDocumentRevision: 4,
  activeDocumentDirty: true,
  selection: {
    documentPath: 'C:/vault/nota.md',
    from: 0,
    to: 6,
    selectedText: '# Nota',
    blocks: [{ index: 0, type: 'heading', text: '# Nota', from: 0, to: 6 }],
  },
  openTabs: [],
  capabilities,
  capturedAt: 1_700_000_000_000,
}

describe('AI contracts', () => {
  it('validates a complete workspace snapshot', () => {
    expect(isWorkspaceAiSnapshot(snapshot)).toBe(true)
  })

  it('rejects a snapshot with an invalid revision or capability payload', () => {
    expect(isWorkspaceAiSnapshot({ ...snapshot, activeDocumentRevision: -1 })).toBe(false)
    expect(isWorkspaceAiSnapshot({ ...snapshot, capabilities: { ...capabilities, canPlan: 'yes' } })).toBe(false)
  })

  it('validates discriminated tool success and failure results', () => {
    expect(isToolResult({
      ok: true,
      changed: false,
      data: { answer: 'ok' },
      revision: null,
      preview: null,
      code: 'no-change',
      retryable: false,
    })).toBe(true)

    expect(isToolResult({
      ok: false,
      changed: false,
      data: null,
      revision: null,
      preview: null,
      error: { code: 'conflict', message: 'El documento cambió.', retryable: true },
      conflict: { documentPath: 'C:/vault/nota.md', expectedRevision: 2, actualRevision: 3 },
      cancelled: false,
      retryable: true,
    })).toBe(true)

    expect(isToolResult({ ok: true, changed: true, data: {}, retryable: true })).toBe(false)
    expect(isToolResult({
      ok: false,
      changed: false,
      data: null,
      revision: null,
      preview: null,
      error: { code: 'arbitrary-code', message: 'No debe pasar.', retryable: true },
      conflict: null,
      cancelled: false,
      retryable: true,
    })).toBe(false)
  })

  it('accepts only the sanitized web-search request shape', () => {
    expect(isWebSearchRequest({
      query: 'documentación pública de TypeScript',
      queryIsSanitized: true,
      maxResults: 5,
      freshness: 'any',
      domains: ['typescriptlang.org'],
    })).toBe(true)

    expect(isWebSearchRequest({
      query: 'tema público',
      queryIsSanitized: false,
      maxResults: 5,
      freshness: 'any',
      domains: [],
      apiKey: 'must-not-be-part-of-the-contract',
    })).toBe(false)
  })
})
