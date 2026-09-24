import { useCallback, useEffect, useRef } from 'react'
import { useAppSelector } from '../../../store/hooks'
import { store } from '../../../store/index'
import { setTreeNodes, setPendingCreation, setSearchQuery, setSearchMatchedPaths, setIsSearchLoading, setContextMenu, setDialogState, setRenamingPath, addLoadingFolderId, removeLoadingFolderId, setFolderLoadError } from '../../../features/documents/documentsSlice'
import { selectIsSidebarOpen, selectIsRightChatPanelOpen } from '../../../features/ui/uiSelectors'
import { setSearchMenuOpen, setActiveHeaderAction } from '../../../features/ui/uiSlice'
import { selectIsSearchActive, selectActiveWorkspaceView, selectActiveTabPath } from '../../../features/documents/documentsSelectors'
import { selectActiveLibrary } from '../../../features/library/librarySelectors'
import { selectExplorerRefreshIntervalMs } from '../../../features/preferences/preferencesSelectors'
import { bumpIndexRevision, setLibraryStatus } from '../../../features/library/librarySlice'
import { notiaLog } from '../../../services/runtime/notiaLogger'
import { openLibrary, readLibraryFolder, refreshLibrary } from '../../../services/libraries/libraryRuntime'
import { dispatchLibraryTreeChanged } from '../../../services/libraries/libraryTreeEvents'
import {
  stopDesktopLibraryTreeWatch,
  subscribeToDesktopLibraryTreeWatchBridge,
} from '../../../services/libraries/libraryTreeWatchRuntime'
import {
  loadExplorerFolderExpandedState,
  saveExplorerFolderExpandedState,
} from '../../../services/preferences/explorerPanelStorage'
import { setAllFoldersExpanded } from '../../../utils/tree/setAllFoldersExpanded'
import { setSelectedFileByPath } from '../../../utils/tree/setSelectedFileByPath'
import { toggleFolderNodeExpanded } from '../../../utils/tree/toggleFolderNodeExpanded'
import { reconcileTreeNodes } from '../../../utils/tree/reconcileTreeNodes'
import { startPerformanceMeasurement } from '../../../services/runtime/performanceBaseline'
import type { NotiaFileNode } from '../../../types/notia'
import type { SetStateAction } from 'react'

// --- Visual tree state helpers (expansion, selection, equality) ---

function collectFolderExpandedState(
  nodes: NotiaFileNode[],
  stateByPath: Map<string, boolean> = new Map<string, boolean>(),
): Map<string, boolean> {
  for (const node of nodes) {
    if (node.type === 'folder' && typeof node.path === 'string') {
      stateByPath.set(node.path, Boolean(node.expanded))
    }
    if (node.children && node.children.length > 0) {
      collectFolderExpandedState(node.children, stateByPath)
    }
  }
  return stateByPath
}

function applyFolderExpandedState(nodes: NotiaFileNode[], stateByPath: Map<string, boolean>): NotiaFileNode[] {
  return nodes.map((node) => {
    const nextChildren = node.children && node.children.length > 0
      ? applyFolderExpandedState(node.children, stateByPath)
      : node.children

    if (node.type !== 'folder') {
      if (nextChildren === node.children) {
        return node
      }
      return { ...node, children: nextChildren }
    }

    const savedExpanded = typeof node.path === 'string'
      ? stateByPath.get(node.path)
      : undefined
    if (typeof savedExpanded === 'undefined' && nextChildren === node.children) {
      return node
    }

    return {
      ...node,
      expanded: typeof savedExpanded === 'boolean' ? savedExpanded : node.expanded,
      children: nextChildren,
    }
  })
}

function areTreeNodesEqual(leftNode: NotiaFileNode, rightNode: NotiaFileNode): boolean {
  if (leftNode.id !== rightNode.id || leftNode.name !== rightNode.name) {
    return false
  }
  if (leftNode.type !== rightNode.type || leftNode.path !== rightNode.path) {
    return false
  }
  if (Boolean(leftNode.expanded) !== Boolean(rightNode.expanded)) {
    return false
  }
  if (Boolean(leftNode.selected) !== Boolean(rightNode.selected)) {
    return false
  }
  if (Boolean(leftNode.hasChildren) !== Boolean(rightNode.hasChildren)) {
    return false
  }
  const leftChildren = leftNode.children ?? []
  const rightChildren = rightNode.children ?? []
  if (leftChildren.length !== rightChildren.length) {
    return false
  }
  for (let index = 0; index < leftChildren.length; index += 1) {
    if (!areTreeNodesEqual(leftChildren[index], rightChildren[index])) {
      return false
    }
  }
  return true
}

function areTreeNodeListsEqual(leftNodes: NotiaFileNode[], rightNodes: NotiaFileNode[]): boolean {
  if (leftNodes.length !== rightNodes.length) {
    return false
  }
  for (let index = 0; index < leftNodes.length; index += 1) {
    if (!areTreeNodesEqual(leftNodes[index], rightNodes[index])) {
      return false
    }
  }
  return true
}

function resolveTreeNodeUpdate(
  current: NotiaFileNode[],
  update: SetStateAction<NotiaFileNode[]>,
): NotiaFileNode[] {
  return typeof update === 'function'
    ? (update as (nodes: NotiaFileNode[]) => NotiaFileNode[])(current)
    : update
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isSameOrNestedPath(basePath: string, candidatePath: string): boolean {
  const normalizedBase = normalizePath(basePath)
  const normalizedCandidate = normalizePath(candidatePath)
  if (normalizedBase === normalizedCandidate) {
    return true
  }
  return normalizedCandidate.startsWith(`${normalizedBase}/`)
}

// --- Hook interface ---

interface UseLibraryTreeSyncParams {
  activeLibraryId: string | null
  persistDirtyTextDocuments: () => Promise<boolean>
  resetTabsAndClearDrawioControllers: () => void
}

export interface UseLibraryTreeSyncActions {
  setTreeNodesForLibrary: (libraryId: string | null, update: SetStateAction<NotiaFileNode[]>) => void
  handleToggleFolder: (folderId: string) => void
  handleCollapseAllFolders: () => void
  handleExpandAllFolders: () => void
  notifyLibraryTreeChanged: (pathHint?: string) => void
  bumpLibraryIndexRevision: () => void
}

/** What the backend reported when it opened the library. */
interface OpenedLibrary {
  libraryId: string
  /** Folders load their children on demand. */
  lazy: boolean
  /** The backend watches the library; no periodic refresh is needed. */
  watched: boolean
}

interface RefreshState {
  inFlight: boolean
  /** A refresh requested while another was running (`true` when forced). */
  queuedForce: boolean | null
  /** A change arrived while the explorer was hidden. */
  deferred: boolean
  lastRequestAt: number
}

const IDLE_REFRESH: RefreshState = { inFlight: false, queuedForce: null, deferred: false, lastRequestAt: 0 }

/**
 * Explorer tree of the active library. The backend opens the library,
 * reads and orders its tree, watches it and decides whether a refresh needs
 * a new read; this hook keeps the visible state (expanded folders,
 * selection) and asks for refreshes while the explorer is visible.
 */
export function useLibraryTreeSync({
  activeLibraryId,
  persistDirtyTextDocuments,
  resetTabsAndClearDrawioControllers,
}: UseLibraryTreeSyncParams): UseLibraryTreeSyncActions {
  const isSidebarOpen = useAppSelector(selectIsSidebarOpen)
  const isRightChatPanelOpen = useAppSelector(selectIsRightChatPanelOpen)
  const isSearchActive = useAppSelector(selectIsSearchActive)
  const explorerRefreshIntervalMs = useAppSelector(selectExplorerRefreshIntervalMs)
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const activeTabPath = useAppSelector(selectActiveTabPath)
  const activeWorkspaceView = useAppSelector(selectActiveWorkspaceView)

  const treeNodesRef = useRef<NotiaFileNode[]>([])
  const treeNodesLibraryIdRef = useRef<string | null>(null)
  const activeTabPathRef = useRef<string | null>(null)
  const openedLibraryRef = useRef<OpenedLibrary | null>(null)
  const refreshStateRef = useRef<RefreshState>({ ...IDLE_REFRESH })
  const treeChangeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    activeTabPathRef.current = activeTabPath
  }, [activeTabPath])

  useEffect(() => {
    treeNodesRef.current = store.getState().documents.treeNodes
  })

  const shouldRefreshActiveLibraryTree = (
    activeWorkspaceView !== 'task-manager' && (
      activeWorkspaceView === 'graph'
      || activeWorkspaceView === 'chat'
      || isRightChatPanelOpen
      || isSidebarOpen
    )
  ) || isSearchActive

  const persistExplorerFolderState = useCallback((libraryId: string | null, nodes: NotiaFileNode[]) => {
    if (!libraryId) {
      return
    }
    const library = store.getState().library.libraries.find((entry) => entry.id === libraryId) ?? null
    saveExplorerFolderExpandedState(library, collectFolderExpandedState(nodes))
  }, [])

  const setTreeNodesForLibrary = useCallback((
    libraryId: string | null,
    update: SetStateAction<NotiaFileNode[]>,
  ) => {
    if (libraryId && store.getState().library.selectedLibraryId !== libraryId) {
      return
    }
    const current = treeNodesRef.current
    const next = resolveTreeNodeUpdate(current, update)
    if (current === next || areTreeNodeListsEqual(current, next)) {
      return
    }
    treeNodesLibraryIdRef.current = libraryId
    treeNodesRef.current = next
    persistExplorerFolderState(libraryId, next)
    store.dispatch(setTreeNodes(next))
  }, [persistExplorerFolderState])

  /** Shows a tree read by the backend, keeping expansion and selection. */
  const commitTreeNodesSnapshot = useCallback((libraryId: string, nodes: NotiaFileNode[]) => {
    const library = store.getState().library.libraries.find((entry) => entry.id === libraryId) ?? null
    const expandedStateByPath = treeNodesLibraryIdRef.current === libraryId
      ? collectFolderExpandedState(treeNodesRef.current)
      : loadExplorerFolderExpandedState(library)
    const reconciledNodes = treeNodesLibraryIdRef.current === libraryId
      ? reconcileTreeNodes(treeNodesRef.current, nodes)
      : nodes
    const withExpandedState = applyFolderExpandedState(reconciledNodes, expandedStateByPath)
    const selectedNodes = setSelectedFileByPath(withExpandedState, activeTabPathRef.current)
    setTreeNodesForLibrary(libraryId, (current) => (
      areTreeNodeListsEqual(current, selectedNodes) ? current : selectedNodes
    ))
  }, [setTreeNodesForLibrary])

  /** Asks the backend for the current tree; overlapping requests collapse. */
  const refreshActiveLibraryTree = useCallback(async (force: boolean): Promise<void> => {
    const opened = openedLibraryRef.current
    if (!opened) {
      return
    }
    const state = refreshStateRef.current
    if (state.inFlight) {
      state.queuedForce = Boolean(state.queuedForce) || force
      return
    }
    state.inFlight = true
    const measurement = startPerformanceMeasurement('explorer.refresh_tree', { libraryId: opened.libraryId })
    try {
      const refresh = await refreshLibrary(opened.libraryId, force)
      if (refresh.changed && refresh.nodes && store.getState().library.selectedLibraryId === opened.libraryId) {
        commitTreeNodesSnapshot(opened.libraryId, refresh.nodes)
      }
      measurement.success({ changed: refresh.changed })
    } catch (error) {
      measurement.error(error)
      notiaLog('treeSync', 'refresh failed', { libraryId: opened.libraryId }, 'warn')
    } finally {
      state.inFlight = false
      const queuedForce = state.queuedForce
      state.queuedForce = null
      if (queuedForce !== null) {
        void refreshActiveLibraryTree(queuedForce)
      }
    }
  }, [commitTreeNodesSnapshot])

  /** Refresh while the explorer is visible, at most once per interval. */
  const requestVisibleRefresh = useCallback(() => {
    if (!openedLibraryRef.current || !shouldRefreshActiveLibraryTree) {
      return
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return
    }
    const now = Date.now()
    const state = refreshStateRef.current
    if (now - state.lastRequestAt < Math.max(1000, explorerRefreshIntervalMs)) {
      return
    }
    state.lastRequestAt = now
    void refreshActiveLibraryTree(false)
  }, [explorerRefreshIntervalMs, refreshActiveLibraryTree, shouldRefreshActiveLibraryTree])

  const notifyLibraryTreeChanged = useCallback((pathHint?: string) => {
    dispatchLibraryTreeChanged({
      pathHint: pathHint ?? activeLibrary?.path,
      source: 'internal',
    })
  }, [activeLibrary?.path])

  const bumpLibraryIndexRevision = useCallback(() => {
    store.dispatch(bumpIndexRevision())
  }, [])

  const handleToggleFolder = useCallback((folderId: string) => {
    const libraryId = store.getState().library.selectedLibraryId
    const findFolder = (nodes: NotiaFileNode[]): NotiaFileNode | null => {
      for (const node of nodes) {
        if (node.id === folderId) return node
        if (node.type === 'folder' && node.expanded && node.children) {
          const found = findFolder(node.children)
          if (found) return found
        }
      }
      return null
    }
    const folder = openedLibraryRef.current?.lazy ? findFolder(treeNodesRef.current) : null
    // A folder listed without its children loads them before expanding.
    if (libraryId && folder?.path && folder.hasChildren && !folder.children?.length) {
      store.dispatch(setFolderLoadError(null))
      store.dispatch(addLoadingFolderId(folderId))
      void readLibraryFolder(libraryId, folder.path)
        .then((children) => {
          if (store.getState().library.selectedLibraryId !== libraryId) {
            return
          }
          const injectChildren = (nodes: NotiaFileNode[]): NotiaFileNode[] => {
            let changed = false
            const nextNodes = nodes.map((node) => {
              if (node.id === folderId) {
                changed = true
                return {
                  ...node,
                  expanded: true,
                  hasChildren: Boolean(children.length) || node.hasChildren,
                  children: children.length > 0 ? children : undefined,
                }
              }
              if (node.type === 'folder' && node.expanded && node.children) {
                const nextChildren = injectChildren(node.children)
                if (nextChildren !== node.children) {
                  changed = true
                  return { ...node, children: nextChildren }
                }
              }
              return node
            })
            return changed ? nextNodes : nodes
          }
          setTreeNodesForLibrary(libraryId, (current) => injectChildren(current))
        })
        .catch((error: unknown) => {
          if (store.getState().library.selectedLibraryId === libraryId) {
            store.dispatch(setFolderLoadError({
              folderId,
              message: error instanceof Error && error.message.trim()
                ? error.message
                : 'No se pudo leer el contenido de la carpeta. Toca para reintentar.',
            }))
          }
        })
        .finally(() => {
          store.dispatch(removeLoadingFolderId(folderId))
        })
      return
    }
    setTreeNodesForLibrary(libraryId, (current) => toggleFolderNodeExpanded(current, folderId))
  }, [setTreeNodesForLibrary])

  const handleCollapseAllFolders = useCallback(() => {
    if (!activeLibrary) { return }
    setTreeNodesForLibrary(activeLibrary.id, (current) => setAllFoldersExpanded(current, false))
  }, [activeLibrary, setTreeNodesForLibrary])

  const handleExpandAllFolders = useCallback(() => {
    if (!activeLibrary) { return }
    setTreeNodesForLibrary(activeLibrary.id, (current) => setAllFoldersExpanded(current, true))
  }, [activeLibrary, setTreeNodesForLibrary])

  // Opening the active library.
  useEffect(() => {
    // Persist before resetting the tree so the autosave debounce cannot
    // discard the current editor contents.
    void persistDirtyTextDocuments()
    openedLibraryRef.current = null
    refreshStateRef.current = { ...IDLE_REFRESH }

    if (!activeLibrary) {
      store.dispatch(setTreeNodes([]))
      treeNodesRef.current = []
      treeNodesLibraryIdRef.current = null
      store.dispatch(setPendingCreation(null))
      store.dispatch(setLibraryStatus('idle'))
      return
    }

    store.dispatch(setLibraryStatus('loading'))
    let isCurrent = true
    const measurement = startPerformanceMeasurement('library.switch_load', { libraryId: activeLibrary.id })
    void openLibrary(activeLibrary.id)
      .then((view) => {
        if (!isCurrent) {
          measurement.cancel()
          return
        }
        openedLibraryRef.current = { libraryId: activeLibrary.id, lazy: view.lazy, watched: view.watched }
        commitTreeNodesSnapshot(activeLibrary.id, view.nodes)
        store.dispatch(setLibraryStatus('ready'))
        measurement.success({ nodeCount: view.nodes.length })
      })
      .catch((error: unknown) => {
        if (!isCurrent) {
          measurement.cancel()
          return
        }
        notiaLog('treeSync', 'library open failed', { libraryId: activeLibrary.id }, 'error')
        store.dispatch(setLibraryStatus('error'))
        measurement.error(error instanceof Error ? error : new Error(String(error)))
      })

    return () => {
      isCurrent = false
      measurement.cancel({ stage: 'cleanup' })
    }
  }, [activeLibrary, commitTreeNodesSnapshot, persistDirtyTextDocuments])

  // Visible state that belongs to the previous library.
  useEffect(() => {
    resetTabsAndClearDrawioControllers()
    store.dispatch(setPendingCreation(null))
    store.dispatch(setRenamingPath(null))
    store.dispatch(setContextMenu(null))
    store.dispatch(setDialogState(null))
    store.dispatch(setSearchMenuOpen(false))
    store.dispatch(setSearchQuery(''))
    store.dispatch(setSearchMatchedPaths([]))
    store.dispatch(setIsSearchLoading(false))
    store.dispatch(setActiveHeaderAction(''))
    if (treeChangeTimerRef.current !== null) {
      window.clearTimeout(treeChangeTimerRef.current)
      treeChangeTimerRef.current = null
    }
  }, [activeLibraryId, resetTabsAndClearDrawioControllers])

  useEffect(() => {
    const libraryId = store.getState().library.selectedLibraryId
    setTreeNodesForLibrary(libraryId, (current) => setSelectedFileByPath(current, activeTabPath))
  }, [activeTabPath, setTreeNodesForLibrary])

  // A change announced while the explorer was hidden is applied when it shows.
  useEffect(() => {
    if (!shouldRefreshActiveLibraryTree || !refreshStateRef.current.deferred) { return }
    refreshStateRef.current.deferred = false
    void refreshActiveLibraryTree(true)
  }, [refreshActiveLibraryTree, shouldRefreshActiveLibraryTree])

  useEffect(() => {
    requestVisibleRefresh()
  }, [requestVisibleRefresh])

  // Changes announced by the watcher or by the interface's own mutations.
  useEffect(() => {
    const handleLibraryTreeChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ vaultPath?: string; pathHint?: string }>
      const changedVaultPath = normalizePath(customEvent.detail?.vaultPath ?? '')
      const changedPathHint = normalizePath(customEvent.detail?.pathHint ?? '')
      const currentActiveLibraryPath = normalizePath(activeLibrary?.path ?? '')
      if (!currentActiveLibraryPath) { return }
      const matchesCurrentLibrary = changedVaultPath
        ? changedVaultPath === currentActiveLibraryPath
        : changedPathHint
          ? isSameOrNestedPath(currentActiveLibraryPath, changedPathHint)
          : true
      if (!matchesCurrentLibrary) { return }

      if (treeChangeTimerRef.current !== null) {
        window.clearTimeout(treeChangeTimerRef.current)
      }
      treeChangeTimerRef.current = window.setTimeout(() => {
        treeChangeTimerRef.current = null
        bumpLibraryIndexRevision()
        if (!shouldRefreshActiveLibraryTree) {
          refreshStateRef.current.deferred = true
          return
        }
        void refreshActiveLibraryTree(true)
      }, 120)
    }

    window.addEventListener('notia:library-tree-changed', handleLibraryTreeChanged)
    return () => {
      window.removeEventListener('notia:library-tree-changed', handleLibraryTreeChanged)
      if (treeChangeTimerRef.current !== null) {
        window.clearTimeout(treeChangeTimerRef.current)
        treeChangeTimerRef.current = null
      }
    }
  }, [activeLibrary?.path, bumpLibraryIndexRevision, refreshActiveLibraryTree, shouldRefreshActiveLibraryTree])

  // Refresh on focus and, for libraries the backend cannot watch, on an interval.
  useEffect(() => {
    if (!activeLibrary) { return }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestVisibleRefresh()
    }
    window.addEventListener('focus', requestVisibleRefresh)
    window.addEventListener('pageshow', requestVisibleRefresh)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const intervalId = explorerRefreshIntervalMs > 0
      ? window.setInterval(() => {
        if (openedLibraryRef.current && !openedLibraryRef.current.watched) requestVisibleRefresh()
      }, Math.max(1000, explorerRefreshIntervalMs))
      : null
    return () => {
      window.removeEventListener('focus', requestVisibleRefresh)
      window.removeEventListener('pageshow', requestVisibleRefresh)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (intervalId !== null) window.clearInterval(intervalId)
    }
  }, [activeLibrary, explorerRefreshIntervalMs, requestVisibleRefresh])

  // Watcher events of the backend reach the explorer as tree changes.
  useEffect(() => {
    if (!activeLibrary) { return }
    let isDisposed = false
    let unsubscribe: (() => void) | null = null
    void subscribeToDesktopLibraryTreeWatchBridge()
      .then((nextUnsubscribe) => {
        if (isDisposed) nextUnsubscribe()
        else unsubscribe = nextUnsubscribe
      })
      .catch((error: unknown) => {
        console.warn('[notia] library watch events unavailable', error)
      })
    return () => {
      isDisposed = true
      unsubscribe?.()
      void stopDesktopLibraryTreeWatch()
    }
  }, [activeLibrary])

  return {
    setTreeNodesForLibrary,
    handleToggleFolder,
    handleCollapseAllFolders,
    handleExpandAllFolders,
    notifyLibraryTreeChanged,
    bumpLibraryIndexRevision,
  }
}
