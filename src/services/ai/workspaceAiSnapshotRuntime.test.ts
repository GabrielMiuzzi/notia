import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceAiSnapshot,
  computeWorkspaceDocumentRevision,
  workspaceAiCapabilities,
} from './workspaceAiSnapshotRuntime'

const library = { id: 'library-1', name: 'Notas', path: 'C:/Notas' }

describe('workspaceAiSnapshotRuntime', () => {
  it('prioritizes the current source and marks a dirty active document', () => {
    const snapshot = buildWorkspaceAiSnapshot({
      view: 'documents',
      scope: 'document',
      library,
      activeDocument: {
        path: 'C:/Notas/idea.md',
        name: 'idea.md',
        viewKind: 'markdown',
        source: '# Borrador',
        latestSavedSource: '# Guardado',
        saveStatus: 'saving',
      },
      openTabs: [],
      includeActiveSource: true,
      capturedAt: 123,
    })

    expect(snapshot.activeDocument?.source).toBe('# Borrador')
    expect(snapshot.activeDocumentDirty).toBe(true)
    expect(snapshot.activeDocumentRevision).toBe(computeWorkspaceDocumentRevision('C:/Notas/idea.md', '# Borrador'))
    expect(snapshot.capturedAt).toBe(123)
  })

  it('keeps open tabs metadata-only and uses stable revisions', () => {
    const input = {
      path: 'C:\\Notas\\a.md',
      name: 'a.md',
      viewKind: 'markdown' as const,
      source: 'contenido',
      latestSavedSource: 'contenido',
    }
    const snapshot = buildWorkspaceAiSnapshot({
      view: 'chat',
      scope: 'library',
      library,
      activeDocument: input,
      openTabs: [input],
      capturedAt: 456,
    })

    expect(snapshot.activeDocument?.source).toBeUndefined()
    expect(snapshot.openTabs).toEqual([{
      path: input.path,
      name: input.name,
      kind: 'markdown',
      revision: computeWorkspaceDocumentRevision(input.path, input.source),
      dirty: false,
    }])
    expect(snapshot.openTabs[0]).not.toHaveProperty('source')
  })

  it('does not advertise capabilities that the current scope cannot perform', () => {
    expect(workspaceAiCapabilities('document')).toMatchObject({
      canReadActiveDocument: true,
      canWriteActiveDocument: true,
      canReadLibrary: true,
      canSearchWeb: true,
    })
    expect(workspaceAiCapabilities('task-manager')).toMatchObject({
      canReadTasks: true,
      canWriteTasks: true,
      canPlan: true,
      canWriteActiveDocument: false,
    })
    expect(workspaceAiCapabilities('finance').canSearchWeb).toBe(false)
  })
})
