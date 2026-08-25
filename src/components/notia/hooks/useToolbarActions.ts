import { useCallback } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { store } from '../../../store/index'
import { toggleSidebar, setActiveHeaderAction, setSearchMenuOpen } from '../../../features/ui/uiSlice'
import { setActiveTabPath, activateSpecialTab, setContextMenu, setRenamingPath, setPendingCreation, GRAPH_WORKSPACE_TAB_PATH, CHAT_WORKSPACE_TAB_PATH, TASK_MANAGER_WORKSPACE_TAB_PATH, COLDPASS_WORKSPACE_TAB_PATH } from '../../../features/documents/documentsSlice'

interface UseToolbarActionsParams {
  activeLibrary: { path: string } | null
  handleCollapseAllFolders: () => void
  handleExpandAllFolders: () => void
}

export function useToolbarActions({
  activeLibrary,
  handleCollapseAllFolders,
  handleExpandAllFolders,
}: UseToolbarActionsParams) {
  const dispatch = useAppDispatch()

  const handleHeaderActionClick = useCallback((id: string) => {
    if (id === 'layout') { dispatch(toggleSidebar()); return }
    if (id === 'search') {
      dispatch(setSearchMenuOpen(!store.getState().ui.isSearchMenuOpen))
      return
    }
    dispatch(setActiveHeaderAction(id))
  }, [dispatch])

  const handleRailActionClick = useCallback((actionId: string) => {
    const specialTabs = store.getState().documents.specialTabs
    if (actionId === 'graph-view') {
      if (!specialTabs.graph) { dispatch(activateSpecialTab('graph')) }
      dispatch(setActiveTabPath(GRAPH_WORKSPACE_TAB_PATH))
      return
    }
    if (actionId === 'chat') {
      if (!specialTabs.chat) { dispatch(activateSpecialTab('chat')) }
      dispatch(setActiveTabPath(CHAT_WORKSPACE_TAB_PATH))
      return
    }
    if (actionId === 'task-manager') {
      if (!specialTabs.taskManager) { dispatch(activateSpecialTab('taskManager')) }
      dispatch(setActiveTabPath(TASK_MANAGER_WORKSPACE_TAB_PATH))
      return
    }
    if (actionId === 'coldpass') {
      if (!specialTabs.coldPass) { dispatch(activateSpecialTab('coldPass')) }
      dispatch(setActiveTabPath(COLDPASS_WORKSPACE_TAB_PATH))
    }
  }, [dispatch])

  const handleExplorerToolClick = useCallback((toolId: string) => {
    if (!activeLibrary) { return }
    dispatch(setContextMenu(null))
    dispatch(setRenamingPath(null))
    if (toolId === 'new-note') {
      dispatch(setPendingCreation({
        id: `pending-note-${Date.now()}`,
        kind: 'note',
        initialName: 'Nueva nota',
        parentPath: activeLibrary.path,
      }))
      return
    }
    if (toolId === 'new-mermaid') {
      dispatch(setPendingCreation({
        id: `pending-mermaid-${Date.now()}`,
        kind: 'mermaid',
        initialName: 'Nuevo diagrama',
        parentPath: activeLibrary.path,
      }))
      return
    }
    if (toolId === 'new-folder') {
      dispatch(setPendingCreation({
        id: `pending-folder-${Date.now()}`,
        kind: 'folder',
        initialName: 'Nueva carpeta',
        parentPath: activeLibrary.path,
      }))
      return
    }
    if (toolId === 'collapse-folders') {
      handleCollapseAllFolders()
      return
    }
    if (toolId === 'expand-folders') {
      handleExpandAllFolders()
    }
  }, [activeLibrary, dispatch, handleCollapseAllFolders, handleExpandAllFolders])

  return {
    handleHeaderActionClick,
    handleRailActionClick,
    handleExplorerToolClick,
  }
}
