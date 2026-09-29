import { useMemo } from 'react'
import type { TaskManagerChatContext } from '../../../modules/task-manager/types/taskManagerTypes'
import type { ChatFileContextMode } from '../../../services/chat/chatAttachmentRuntime'
import type { OpenFileDocument } from '../../../types/views/fileDocument'
import type { ChatAgentScope } from '../../../services/chat/chatAgentTypes'
import type { MarkdownSelectionContext } from '../../../types/views/markdownSelection'
import type { ChatComposerContext } from '../views/chat/ChatWorkspaceViewTypes'

const EMPTY_CONTEXT_PATHS: string[] = []

interface UseRightPanelChatContextParams {
  activeDocument: OpenFileDocument | null
  activeWorkspaceView: 'graph' | 'chat' | 'task-manager' | 'coldpass' | 'meeting' | 'finance' | 'agenda' | 'documents' | 'routine' | 'ai-actions' | 'recipes' | 'health' | 'home'
  graphChatContextSummary: string | null
  graphChatEffectivePaths: string[]
  graphChatHasExplicitSelection: boolean
  taskManagerActivePanelId: string
  taskManagerChatContext: TaskManagerChatContext | null
  markdownSelection: MarkdownSelectionContext | null
}

export function resolveRightPanelPreferredContextMode(
  activeWorkspaceView: UseRightPanelChatContextParams['activeWorkspaceView'],
  activeDocument: OpenFileDocument | null,
): ChatFileContextMode | null {
  void activeDocument
  if (activeWorkspaceView === 'task-manager') {
    return 'index'
  }

  return null
}

export function resolveGraphChatContextMode(hasExplicitSelection: boolean): ChatFileContextMode {
  return hasExplicitSelection ? 'direct' : 'index'
}

export function resolveRightPanelAgentScope(
  activeWorkspaceView: UseRightPanelChatContextParams['activeWorkspaceView'],
  activeDocument: OpenFileDocument | null,
): ChatAgentScope | null {
  if (activeWorkspaceView === 'task-manager') return 'task-manager'
  if (activeWorkspaceView === 'graph') return 'graph'
  if (activeWorkspaceView === 'finance') return 'finance'
  if (activeWorkspaceView === 'routine' || activeWorkspaceView === 'ai-actions' || activeWorkspaceView === 'recipes' || activeWorkspaceView === 'health' || activeWorkspaceView === 'agenda' || activeWorkspaceView === 'home') return 'library'
  return activeWorkspaceView === 'documents' && activeDocument?.viewKind === 'markdown'
    ? 'document'
    : null
}

export function resolveGraphAttachedContextPaths(
  effectivePaths: string[],
  hasExplicitSelection: boolean,
): string[] {
  return hasExplicitSelection ? effectivePaths : EMPTY_CONTEXT_PATHS
}

export function resolveRightPanelAttachedContextPaths(
  activeWorkspaceView: UseRightPanelChatContextParams['activeWorkspaceView'],
  activeDocument: OpenFileDocument | null,
): string[] {
  void activeWorkspaceView
  void activeDocument
  return EMPTY_CONTEXT_PATHS
}

export function resolveRightPanelContextScopeKey(
  activeWorkspaceView: UseRightPanelChatContextParams['activeWorkspaceView'],
  activeDocument: OpenFileDocument | null,
  taskManagerScopeKey: string | null,
  taskManagerPanelId = '',
): string | null {
  if (activeWorkspaceView === 'task-manager') {
    const normalizedScopeKey = taskManagerScopeKey?.trim() || ''
    return normalizedScopeKey.startsWith('task-manager:')
      ? normalizedScopeKey
      : `task-manager:${normalizedScopeKey || taskManagerPanelId.trim() || 'default'}`
  }
  if (activeWorkspaceView === 'graph') return 'graph-view:right-panel'
  if (activeWorkspaceView === 'documents' && activeDocument?.viewKind === 'markdown') {
    return `document:${activeDocument.path.replace(/\\/g, '/')}`
  }
  return null
}

export function shouldSelectMatchingRightPanelChat(
  preferredContextScopeKey: string | null,
  preferredContextPaths: readonly string[],
): boolean {
  return Boolean(preferredContextScopeKey || preferredContextPaths.length > 0)
}

/** What the side chat shows as its context: the open file or the view. */
export type RightPanelChatContextChip = ChatComposerContext

function viewChip(label: string): RightPanelChatContextChip {
  return { label, kind: 'view' }
}

export function buildRightPanelChatContextChip(
  activeWorkspaceView: UseRightPanelChatContextParams['activeWorkspaceView'],
  activeDocument: OpenFileDocument | null,
  taskManagerPanelId: string,
  markdownSelection: MarkdownSelectionContext | null,
): RightPanelChatContextChip {
  if (activeWorkspaceView === 'task-manager') {
    const panel = taskManagerPanelId === '__finished__' ? 'Completadas'
      : taskManagerPanelId === '__cancelled__' ? 'Canceladas'
        : taskManagerPanelId === '__pomodoro__' ? 'Pomodoro'
          : taskManagerPanelId.trim()
    return viewChip(panel ? `Task Manager · ${panel}` : 'Task Manager')
  }
  if (activeWorkspaceView === 'coldpass') return viewChip('ColdPass')
  if (activeWorkspaceView === 'graph') return viewChip('Graph View')
  if (activeWorkspaceView === 'chat') return viewChip('Chat')
  if (activeWorkspaceView === 'finance') return viewChip('Finanzas')
  if (activeWorkspaceView === 'routine') return viewChip('Rutina')
  if (activeWorkspaceView === 'ai-actions') return viewChip('Acciones IA')
  if (activeWorkspaceView === 'recipes') return viewChip('Recetas')
  if (activeWorkspaceView === 'health') return viewChip('Salud')
  if (activeWorkspaceView === 'home') return viewChip('Inicio')
  if (activeWorkspaceView === 'agenda') return viewChip('Agenda')
  if (!activeDocument) return { label: 'Sin nota en contexto', kind: 'none' }
  const blocks = activeDocument.viewKind === 'markdown' ? markdownSelection?.blocks.length ?? 0 : 0
  const selection = blocks === 0 ? '' : blocks === 1 ? ' · 1 bloque' : ` · ${blocks} bloques`
  return { label: `${activeDocument.name}${selection}`, kind: 'document' }
}

export function useRightPanelChatContext({
  activeDocument,
  activeWorkspaceView,
  graphChatContextSummary,
  graphChatEffectivePaths,
  graphChatHasExplicitSelection,
  taskManagerActivePanelId,
  taskManagerChatContext,
  markdownSelection,
}: UseRightPanelChatContextParams) {
  const agentScope = resolveRightPanelAgentScope(activeWorkspaceView, activeDocument)
  const rightPanelChatContext = useMemo(
    () => buildRightPanelChatContextChip(activeWorkspaceView, activeDocument, taskManagerActivePanelId, markdownSelection),
    [activeDocument, activeWorkspaceView, markdownSelection, taskManagerActivePanelId],
  )

  const rightPanelChatContextKey = useMemo(() => {
    if (activeWorkspaceView === 'task-manager') {
      return `task-manager:${taskManagerChatContext?.scopeKey ?? taskManagerActivePanelId}`
    }

    if (activeDocument?.viewKind === 'markdown') {
      return `${activeWorkspaceView}:${activeDocument.viewKind}:${activeDocument.path}`
    }

    return `${activeWorkspaceView}:default`
  }, [activeDocument, activeWorkspaceView, taskManagerActivePanelId, taskManagerChatContext?.scopeKey])

  const preferredContextPaths = useMemo(() => {
    return resolveRightPanelAttachedContextPaths(activeWorkspaceView, activeDocument)
  }, [activeDocument, activeWorkspaceView])

  const agentCorpusPaths = useMemo(() => {
    if (activeWorkspaceView === 'task-manager') {
      return taskManagerChatContext?.filePaths ?? EMPTY_CONTEXT_PATHS
    }

    if (activeWorkspaceView === 'graph') {
      return graphChatEffectivePaths
    }

    if (activeDocument?.viewKind === 'markdown') {
      return [activeDocument.path]
    }

    return EMPTY_CONTEXT_PATHS
  }, [activeDocument, activeWorkspaceView, graphChatEffectivePaths, taskManagerChatContext?.filePaths])

  const preferredContextName = null

  const preferredContextMode = useMemo(() => {
    return resolveRightPanelPreferredContextMode(activeWorkspaceView, activeDocument)
  }, [activeDocument, activeWorkspaceView])

  const preferredContextScopeKey = useMemo(() => {
    return resolveRightPanelContextScopeKey(
      activeWorkspaceView,
      activeDocument,
      taskManagerChatContext?.scopeKey ?? null,
      taskManagerActivePanelId,
    )
  }, [activeDocument, activeWorkspaceView, taskManagerActivePanelId, taskManagerChatContext?.scopeKey])

  const transientContextPaths = useMemo(
    () => activeWorkspaceView === 'graph'
      ? resolveGraphAttachedContextPaths(graphChatEffectivePaths, graphChatHasExplicitSelection)
      : EMPTY_CONTEXT_PATHS,
    [activeWorkspaceView, graphChatEffectivePaths, graphChatHasExplicitSelection],
  )

  const transientContextMode: ChatFileContextMode | null = activeWorkspaceView === 'graph'
    ? resolveGraphChatContextMode(graphChatHasExplicitSelection)
    : null

  return {
    agentCorpusPaths,
    agentScope,
    preferredContextMode,
    preferredContextName,
    preferredContextPaths,
    preferredContextScopeKey,
    rightPanelChatContextKey,
    rightPanelChatContext,
    transientContextMode,
    transientContextPaths,
    transientContextSummary: graphChatHasExplicitSelection ? graphChatContextSummary : null,
  }
}
