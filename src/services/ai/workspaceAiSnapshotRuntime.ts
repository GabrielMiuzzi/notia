import type {
  WorkspaceAiCapabilities,
  WorkspaceAiDocumentKind,
  WorkspaceAiDocumentSnapshot,
  WorkspaceAiLibrarySnapshot,
  WorkspaceAiOpenTabSnapshot,
  WorkspaceAiScope,
  WorkspaceAiSnapshot,
  WorkspaceAiView,
} from '../../types/ai/agentContracts'
import type { NotiaLibrary } from '../../types/notia'

export interface WorkspaceAiDocumentInput {
  path: string
  name: string
  viewKind: 'markdown' | 'text' | 'image' | 'mermaid'
  source?: string
  latestSavedSource?: string
  saveStatus?: 'idle' | 'saving' | 'error'
}

export interface BuildWorkspaceAiSnapshotInput {
  view: WorkspaceAiView
  scope: WorkspaceAiScope
  library: NotiaLibrary | null
  activeDocument: WorkspaceAiDocumentInput | null
  openTabs: readonly WorkspaceAiDocumentInput[]
  selection?: WorkspaceAiSnapshot['selection']
  includeActiveSource?: boolean
  capturedAt?: number
}

const REVISION_OFFSET = 2166136261
const REVISION_PRIME = 16777619

function normalizeRevisionPart(value: string): string {
  return value.replace(/\\/g, '/')
}

/** A stable, non-cryptographic revision for optimistic context checks. */
export function computeWorkspaceDocumentRevision(path: string, source = ''): number {
  let hash = REVISION_OFFSET
  const input = `${normalizeRevisionPart(path)}\u0000${source}`
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, REVISION_PRIME)
  }
  return hash >>> 0
}

function mapDocumentKind(viewKind: WorkspaceAiDocumentInput['viewKind']): WorkspaceAiDocumentKind {
  return viewKind
}

function isDirty(document: WorkspaceAiDocumentInput): boolean {
  if (document.saveStatus === 'saving' || document.saveStatus === 'error') {
    return true
  }
  if (typeof document.source === 'string' && typeof document.latestSavedSource === 'string') {
    return document.source !== document.latestSavedSource
  }
  return false
}

function toDocumentSnapshot(
  document: WorkspaceAiDocumentInput,
  includeSource: boolean,
): WorkspaceAiDocumentSnapshot {
  const source = typeof document.source === 'string' ? document.source : ''
  const dirty = isDirty(document)
  const snapshot: WorkspaceAiDocumentSnapshot = {
    path: document.path,
    name: document.name,
    kind: mapDocumentKind(document.viewKind),
    revision: computeWorkspaceDocumentRevision(document.path, source),
    dirty,
  }
  if (includeSource && typeof document.source === 'string') {
    snapshot.source = document.source
  }
  return snapshot
}

function toOpenTabSnapshot(document: WorkspaceAiDocumentInput): WorkspaceAiOpenTabSnapshot {
  const source = typeof document.source === 'string' ? document.source : ''
  return {
    path: document.path,
    name: document.name,
    kind: mapDocumentKind(document.viewKind),
    revision: computeWorkspaceDocumentRevision(document.path, source),
    dirty: isDirty(document),
  }
}

export function workspaceAiCapabilities(scope: WorkspaceAiScope): WorkspaceAiCapabilities {
  const canReadActiveDocument = scope === 'document'
  const canWriteActiveDocument = scope === 'document'
  const canReadTasks = scope === 'task-manager'
  const canWriteTasks = scope === 'task-manager'
  const canReadFinance = scope === 'finance'
  const canWriteFinance = scope === 'finance'
  const canReadLibrary = scope === 'library' || scope === 'graph' || scope === 'document' || scope === 'published'
  const canWriteLibrary = scope === 'library' || scope === 'graph'

  return {
    canReadActiveDocument,
    canReadLibrary,
    canReadTasks,
    canReadFinance,
    canWriteActiveDocument,
    canWriteLibrary,
    canWriteTasks,
    canWriteFinance,
    canSearchWeb: scope !== 'finance' && scope !== 'published',
    canAskClarification: true,
    canRequestConfirmation: true,
    canPlan: scope !== 'finance' && scope !== 'published',
    canUndo: scope === 'document',
  }
}

export function buildWorkspaceAiSnapshot({
  view,
  scope,
  library,
  activeDocument,
  openTabs,
  selection = null,
  includeActiveSource = false,
  capturedAt = Date.now(),
}: BuildWorkspaceAiSnapshotInput): WorkspaceAiSnapshot {
  const activeDocumentSnapshot = activeDocument
    ? toDocumentSnapshot(activeDocument, includeActiveSource)
    : null
  const librarySnapshot: WorkspaceAiLibrarySnapshot | null = library
    ? { id: library.id, name: library.name, path: library.path }
    : null

  return {
    snapshotVersion: 1,
    view,
    scope,
    library: librarySnapshot,
    activeDocument: activeDocumentSnapshot,
    activeDocumentRevision: activeDocumentSnapshot?.revision ?? null,
    activeDocumentDirty: activeDocumentSnapshot?.dirty ?? false,
    selection,
    openTabs: openTabs.map(toOpenTabSnapshot),
    capabilities: workspaceAiCapabilities(scope),
    capturedAt,
  }
}
