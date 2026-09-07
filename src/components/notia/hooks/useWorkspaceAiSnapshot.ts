import { useMemo } from 'react'
import { useAppSelector } from '../../../store/hooks'
import { selectActiveLibrary } from '../../../features/library/librarySelectors'
import { selectActiveTab, selectActiveWorkspaceView, selectOpenTabs } from '../../../features/documents/documentsSelectors'
import type { ChatAgentScope } from '../../../services/chat/chatScopedAgentRuntime'
import {
  buildWorkspaceAiSnapshot,
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

  return useMemo(() => {
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
      selection: scope === 'document' ? markdownSelection : null,
      includeActiveSource: scope === 'document',
    })
  }, [activeMarkdownSource, activeTab, activeWorkspaceView, library, markdownSelection, openTabs, scope])
}
