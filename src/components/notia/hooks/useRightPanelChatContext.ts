import { useMemo, useSyncExternalStore } from 'react'
import type { TaskManagerChatContext } from '../../../modules/task-manager/types/taskManagerTypes'
import type { ChatFileContextMode } from '../../../services/chat/chatAttachmentRuntime'
import type { OpenFileDocument } from '../../../types/views/fileDocument'
import type { ChatAgentScope } from '../../../services/chat/chatAgentTypes'
import type { MarkdownSelectionContext } from '../../../types/views/markdownSelection'
import { getMultichatPanelContext, subscribeMultichatPanelContext } from '../../../services/multichat/multichatSessionStore'

const EMPTY_CONTEXT_PATHS: string[] = []

interface UseRightPanelChatContextParams {
  activeDocument: OpenFileDocument | null
  activeWorkspaceView: 'graph' | 'chat' | 'task-manager' | 'coldpass' | 'meeting' | 'finance' | 'calendar' | 'agenda' | 'multichat' | 'documents' | 'routine'
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
  if (activeWorkspaceView === 'multichat' || activeWorkspaceView === 'routine' || activeWorkspaceView === 'agenda') return 'library'
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
  if (activeWorkspaceView === 'multichat') return 'multichat:right-panel'
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

function buildRightPanelChatContextLabel(
  activeWorkspaceView: 'graph' | 'chat' | 'task-manager' | 'coldpass' | 'meeting' | 'finance' | 'calendar' | 'agenda' | 'multichat' | 'documents' | 'routine',
  activeDocument: OpenFileDocument | null,
  taskManagerPanelId: string,
  markdownSelection: MarkdownSelectionContext | null,
): string {
  if (activeWorkspaceView === 'task-manager') {
    if (taskManagerPanelId === '__finished__') {
      return 'Contexto activo: Task Manager, panel Completadas'
    }

    if (taskManagerPanelId === '__cancelled__') {
      return 'Contexto activo: Task Manager, panel Canceladas'
    }

    if (taskManagerPanelId === '__pomodoro__') {
      return 'Contexto activo: Task Manager, panel Pomodoro'
    }

    if (taskManagerPanelId.trim()) {
      return `Contexto activo: Task Manager, panel ${taskManagerPanelId}`
    }

    return 'Contexto activo: vista Task Manager'
  }

  if (activeWorkspaceView === 'coldpass') {
    return 'Contexto activo: vista ColdPass'
  }

  if (activeWorkspaceView === 'graph') {
    return 'Contexto activo: Graph view'
  }

  if (activeWorkspaceView === 'chat') {
    return 'Contexto activo: vista principal de chat'
  }

  if (activeWorkspaceView === 'finance') {
    return 'Contexto activo: Finanzas'
  }

  if (activeWorkspaceView === 'routine') {
    return 'Contexto activo: Rutina'
  }

  if (activeWorkspaceView === 'agenda') {
    return 'Contexto activo: Agenda'
  }

  if (activeWorkspaceView === 'multichat') {
    return 'Contexto activo: sala Multichat'
  }

  if (!activeDocument) {
    return 'Contexto activo: sin pestaña seleccionada'
  }

  if (activeDocument.viewKind === 'markdown') {
    const selectionLabel = markdownSelection && markdownSelection.blocks.length > 0
      ? ` · selección: ${markdownSelection.blocks.length} bloque(s)`
      : ''
    return `Contexto activo: archivo Markdown ${activeDocument.name}${selectionLabel}`
  }

  if (activeDocument.viewKind === 'image') {
    return `Contexto activo: imagen ${activeDocument.name}`
  }

  return `Contexto activo: archivo de texto ${activeDocument.name}`
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
  const multichatContext = useSyncExternalStore(subscribeMultichatPanelContext, getMultichatPanelContext, getMultichatPanelContext)
  const rightPanelChatContextLabel = useMemo(
    () => activeWorkspaceView === 'multichat'
      ? multichatContext?.label ?? 'Contexto activo: sala Multichat'
      : buildRightPanelChatContextLabel(activeWorkspaceView, activeDocument, taskManagerActivePanelId, markdownSelection),
    [activeDocument, activeWorkspaceView, markdownSelection, multichatContext?.label, taskManagerActivePanelId],
  )

  const rightPanelChatContextKey = useMemo(() => {
    if (activeWorkspaceView === 'multichat') {
      return `multichat:${multichatContext?.roomId ?? 'empty'}`
    }

    if (activeWorkspaceView === 'task-manager') {
      return `task-manager:${taskManagerChatContext?.scopeKey ?? taskManagerActivePanelId}`
    }

    if (activeDocument?.viewKind === 'markdown') {
      return `${activeWorkspaceView}:${activeDocument.viewKind}:${activeDocument.path}`
    }

    return `${activeWorkspaceView}:default`
  }, [activeDocument, activeWorkspaceView, multichatContext?.roomId, taskManagerActivePanelId, taskManagerChatContext?.scopeKey])

  const preferredContextPaths = useMemo(() => {
    return resolveRightPanelAttachedContextPaths(activeWorkspaceView, activeDocument)
  }, [activeDocument, activeWorkspaceView])

  const agentCorpusPaths = useMemo(() => {
    if (activeWorkspaceView === 'multichat') {
      return EMPTY_CONTEXT_PATHS
    }

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
    rightPanelChatContextLabel,
    transientContextMode,
    transientContextPaths,
    transientContextSummary: activeWorkspaceView !== 'multichat' && graphChatHasExplicitSelection ? graphChatContextSummary : null,
    /** Multichat room beside the chat; the backend adds its conversation as context. */
    multichatRoomId: activeWorkspaceView === 'multichat' ? multichatContext?.roomId ?? null : null,
  }
}
