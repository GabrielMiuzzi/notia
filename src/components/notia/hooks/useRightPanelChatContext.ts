import { useMemo } from 'react'
import type { TaskManagerChatContext } from '../../../modules/task-manager/types/taskManagerTypes'
import type { ChatFileContextMode } from '../../../services/chat/chatAttachmentRuntime'
import type { OpenFileDocument } from '../../../types/views/fileDocument'
import type { ChatAgentScope } from '../../../services/chat/chatScopedAgentRuntime'

const EMPTY_CONTEXT_PATHS: string[] = []

interface UseRightPanelChatContextParams {
  activeDocument: OpenFileDocument | null
  activeWorkspaceView: 'graph' | 'chat' | 'task-manager' | 'coldpass' | 'documents'
  graphChatContextSummary: string | null
  graphChatEffectivePaths: string[]
  graphChatHasExplicitSelection: boolean
  taskManagerActivePanelId: string
  taskManagerChatContext: TaskManagerChatContext | null
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
    return `task-manager:${taskManagerScopeKey?.trim() || taskManagerPanelId.trim() || 'default'}`
  }
  if (activeWorkspaceView === 'graph') return 'graph-view:right-panel'
  if (activeWorkspaceView === 'documents' && activeDocument?.viewKind === 'markdown') {
    return `document:${activeDocument.path.replace(/\\/g, '/')}`
  }
  return null
}

function buildRightPanelChatContextLabel(
  activeWorkspaceView: 'graph' | 'chat' | 'task-manager' | 'coldpass' | 'documents',
  activeDocument: OpenFileDocument | null,
  taskManagerPanelId: string,
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

  if (!activeDocument) {
    return 'Contexto activo: sin pestaña seleccionada'
  }

  if (activeDocument.viewKind === 'markdown') {
    return `Contexto activo: archivo Markdown ${activeDocument.name}`
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
}: UseRightPanelChatContextParams) {
  const agentScope: ChatAgentScope | null = activeWorkspaceView === 'task-manager'
    ? 'task-manager'
    : activeWorkspaceView === 'graph'
      ? 'graph'
      : activeWorkspaceView === 'documents' && activeDocument?.viewKind === 'markdown'
        ? 'document'
        : null
  const rightPanelChatContextLabel = useMemo(
    () => buildRightPanelChatContextLabel(activeWorkspaceView, activeDocument, taskManagerActivePanelId),
    [activeDocument, activeWorkspaceView, taskManagerActivePanelId],
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
    rightPanelChatContextLabel,
    transientContextMode,
    transientContextPaths,
    transientContextSummary: graphChatHasExplicitSelection ? graphChatContextSummary : null,
  }
}
