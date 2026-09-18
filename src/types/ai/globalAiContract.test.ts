import { describe, expect, it } from 'vitest'
import { createGlobalAiRequest, isGlobalAiChatRequest } from './globalAiContract'
import type { WorkspaceAiSnapshot } from './agentContracts'

const snapshot = {
  snapshotVersion: 1,
  view: 'chat',
  scope: 'library',
  library: { id: 'library', name: 'Vault', path: 'C:/vault' },
  activeDocument: null,
  activeDocumentRevision: null,
  activeDocumentDirty: false,
  selection: null,
  openTabs: [],
  capabilities: {
    canReadActiveDocument: true, canReadLibrary: true, canReadTasks: true, canReadFinance: false,
    canWriteActiveDocument: false, canWriteLibrary: false, canWriteTasks: false, canWriteFinance: false,
    canSearchWeb: true, canAskClarification: true, canRequestConfirmation: true, canPlan: true, canUndo: false,
  },
  capturedAt: 1,
} satisfies WorkspaceAiSnapshot

describe('globalAiContract', () => {
  it('requires a stable actor, channel and version', () => {
    const request = createGlobalAiRequest({
      libraryId: 'library',
      requestId: 'request-1',
      actor: { libraryUserId: 'user-owner', displayName: 'Owner' },
      source: { channel: 'telegram' },
      workspaceSnapshot: snapshot,
      requestedScope: 'library',
      persistencePolicy: 'ephemeral-no-memory',
      prompt: 'Consulta',
    })
    expect(request.version).toBe(1)
    expect(isGlobalAiChatRequest(request)).toBe(true)
    expect(isGlobalAiChatRequest({ ...request, actor: { libraryUserId: '' } })).toBe(false)
    expect(isGlobalAiChatRequest({ ...request, source: { channel: 'app' } })).toBe(false)
  })
})
