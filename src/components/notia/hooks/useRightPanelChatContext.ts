import { useMemo } from 'react'
import type { TaskManagerChatContext } from '../../../modules/task-manager/types/taskManagerTypes'
import type { ChatFileContextMode } from '../../../services/chat/chatAttachmentRuntime'
import type { OpenFileDocument } from '../../../types/views/fileDocument'

const EMPTY_CONTEXT_PATHS: string[] = []

interface UseRightPanelChatContextParams {
  activeDocument: OpenFileDocument | null
  activeWorkspaceView: 'graph' | 'chat' | 'task-manager' | 'coldpass' | 'documents'
  graphChatContextSummary: string | null
  graphChatEffectivePaths: string[]
  taskManagerActivePanelId: string
  taskManagerChatContext: TaskManagerChatContext | null
}

export function resolveRightPanelPreferredContextMode(
  activeWorkspaceView: UseRightPanelChatContextParams['activeWorkspaceView'],
  activeDocument: OpenFileDocument | null,
): ChatFileContextMode | null {
  if (activeWorkspaceView === 'task-manager') {
    return 'direct'
  }

  if (activeDocument?.viewKind === 'markdown') {
    return 'index'
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

  if (activeDocument.viewKind === 'inkdoc') {
    return `Contexto activo: archivo Inkdoc ${activeDocument.name}`
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
  taskManagerActivePanelId,
  taskManagerChatContext,
}: UseRightPanelChatContextParams) {
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
    if (activeWorkspaceView === 'task-manager') {
      return taskManagerChatContext?.filePaths ?? EMPTY_CONTEXT_PATHS
    }

    if (activeDocument?.viewKind === 'markdown') {
      return [activeDocument.path]
    }

    return EMPTY_CONTEXT_PATHS
  }, [activeDocument, activeWorkspaceView, taskManagerChatContext?.filePaths])

  const preferredContextName = useMemo(() => {
    if (
      activeWorkspaceView !== 'task-manager'
      && activeDocument?.viewKind === 'markdown'
    ) {
      return activeDocument.name
    }

    return null
  }, [activeDocument, activeWorkspaceView])

  const preferredContextMode = useMemo(() => {
    return resolveRightPanelPreferredContextMode(activeWorkspaceView, activeDocument)
  }, [activeDocument, activeWorkspaceView])

  const preferredContextScopeKey = useMemo(() => {
    if (activeWorkspaceView === 'task-manager') {
      return taskManagerChatContext?.scopeKey ?? null
    }

    if (activeWorkspaceView === 'graph') {
      return 'graph-view:right-panel'
    }

    return null
  }, [activeWorkspaceView, taskManagerChatContext?.scopeKey])

  const transientContextPaths = useMemo(
    () => (activeWorkspaceView === 'graph' ? graphChatEffectivePaths : EMPTY_CONTEXT_PATHS),
    [activeWorkspaceView, graphChatEffectivePaths],
  )

  const transientContextMode: ChatFileContextMode | null = activeWorkspaceView === 'graph' ? 'index' : null

  return {
    preferredContextMode,
    preferredContextName,
    preferredContextPaths,
    preferredContextScopeKey,
    rightPanelChatContextKey,
    rightPanelChatContextLabel,
    transientContextMode,
    transientContextPaths,
    transientContextSummary: graphChatContextSummary,
  }
}
