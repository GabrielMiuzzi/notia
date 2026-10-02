import { useMemo } from 'react'
import { useAppSelector } from '../../../store/hooks'
import { selectActiveLibrary } from '../../../features/library/librarySelectors'
import { selectActiveTab, selectActiveWorkspaceView, selectOpenTabs } from '../../../features/documents/documentsSelectors'
import type { ChatAgentScope } from '../../../services/chat/chatAgentTypes'
import {
  buildWorkspaceAiSnapshot,
  withWorkspaceSelection,
  type WorkspaceAiDocumentInput,
} from '../../../services/ai/workspaceAiSnapshotRuntime'
import type { WorkspaceAiScope, WorkspaceAiSnapshot } from '../../../types/ai/agentContracts'
import type { MarkdownSelectionContext } from '../../../types/views/markdownSelection'

function resolveWorkspaceScope(scope: ChatAgentScope | null): WorkspaceAiScope {
  return scope ?? 'library'
}

function toDocumentInput(tab: {
  document: {
    path: string
    name: string
    viewKind: 'markdown' | 'text' | 'image' | 'mermaid'
    source?: string
  }
  latestSavedSource: string
  saveStatus: 'idle' | 'saving' | 'error'
}): WorkspaceAiDocumentInput {
  return {
    path: tab.document.path,
    name: tab.document.name,
    viewKind: tab.document.viewKind,
    source: 'source' in tab.document ? tab.document.source : undefined,
    latestSavedSource: tab.latestSavedSource,
    saveStatus: tab.saveStatus,
  }
}

export function useWorkspaceAiSnapshot({
  scope,
  activeMarkdownSource,
  markdownSelection,
}: {
  scope: ChatAgentScope | null
  activeMarkdownSource: string | null
  markdownSelection: MarkdownSelectionContext | null
}): WorkspaceAiSnapshot | null {
  const library = useAppSelector(selectActiveLibrary)
  const activeWorkspaceView = useAppSelector(selectActiveWorkspaceView)
  const activeTab = useAppSelector(selectActiveTab)
  const openTabs = useAppSelector(selectOpenTabs)

  // The revisions hash the text of every open tab: they are worked out again
  // when the tabs change, not when only the selection moves.
  const snapshotWithoutSelection = useMemo(() => {
    if (!library) {
      return null
    }

    const activeDocument = activeTab ? toDocumentInput(activeTab) : null
    if (activeDocument && scope === 'document' && typeof activeMarkdownSource === 'string') {
      activeDocument.source = activeMarkdownSource
    }

    return buildWorkspaceAiSnapshot({
      view: activeWorkspaceView,
      scope: resolveWorkspaceScope(scope),
      library,
      activeDocument,
      openTabs: openTabs.map(toDocumentInput),
      selection: null,
      includeActiveSource: scope === 'document',
    })
  }, [activeMarkdownSource, activeTab, activeWorkspaceView, library, openTabs, scope])

  return useMemo(() => (
    snapshotWithoutSelection
      ? withWorkspaceSelection(snapshotWithoutSelection, scope === 'document' ? markdownSelection : null)
      : null
  ), [markdownSelection, scope, snapshotWithoutSelection])
}
