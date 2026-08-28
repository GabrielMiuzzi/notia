import { useCallback, useEffect, useRef } from 'react'
import { useAppSelector } from '../../../store/hooks'
import { store } from '../../../store/index'
import { setTreeNodes, setPendingCreation, setSearchQuery, setSearchMatchedPaths, setIsSearchLoading, setContextMenu, setDialogState, setRenamingPath, addLoadingFolderId, removeLoadingFolderId, setFlatFileList } from '../../../features/documents/documentsSlice'
import { selectIsSidebarOpen, selectIsRightChatPanelOpen } from '../../../features/ui/uiSelectors'
import { setSearchMenuOpen, setActiveHeaderAction } from '../../../features/ui/uiSlice'
import { selectIsSearchActive, selectActiveWorkspaceView, selectActiveTabPath } from '../../../features/documents/documentsSelectors'
import { selectActiveLibrary } from '../../../features/library/librarySelectors'
import { selectExplorerRefreshIntervalMs } from '../../../features/preferences/preferencesSelectors'
import { bumpIndexRevision, setLibraryStatus } from '../../../features/library/librarySlice'
import { notiaLog, notiaTimer } from '../../../services/runtime/notiaLogger'
import {
  readLibraryTree,
  readLibraryTreeSignature,
  readLibraryDirectory,
  readLibraryFlatFileList,
} from '../../../services/libraries/libraryRuntime'
import { dispatchLibraryTreeChanged } from '../../../services/libraries/libraryTreeEvents'
import {
  invalidateLibrarySearchGraphIndex,
} from '../../../services/libraries/librarySearchGraphIndex'
import {
  startDesktopLibraryTreeWatch,
  stopDesktopLibraryTreeWatch,
  subscribeToDesktopLibraryTreeWatchBridge,
} from '../../../services/libraries/libraryTreeWatchRuntime'
import {
  loadExplorerFolderExpandedState,
  saveExplorerFolderExpandedState,
} from '../../../services/preferences/explorerPanelStorage'
import { getRuntimeDevice } from '../../../utils/platform/getRuntimeDevice'
import { setAllFoldersExpanded } from '../../../utils/tree/setAllFoldersExpanded'
import { setSelectedFileByPath } from '../../../utils/tree/setSelectedFileByPath'
import { toggleFolderNodeExpanded } from '../../../utils/tree/toggleFolderNodeExpanded'
import { ensureChatLibraryStructure } from '../../../services/chat/chatLibraryStructure'
import { ensureAgentPromptFile } from '../../../services/ai/agentPromptRuntime'
import { initializeLibraryDatabase } from '../../../services/libraries/libraryDatabase'
import { startPerformanceMeasurement } from '../../../services/runtime/performanceBaseline'
import type { NotiaFileNode } from '../../../types/notia'
import type { SetStateAction } from 'react'

// --- Pure helper functions (tree sync only) ---

function countTreeNodes(nodes: NotiaFileNode[]): number {
  let count = 0
  const visit = (currentNodes: NotiaFileNode[]) => {
    for (const node of currentNodes) {
      count += 1
      if (node.children && node.children.length > 0) {
        visit(node.children)
      }
    }
  }
  visit(nodes)
  return count
}

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

function buildTreeNodesStructureSignature(nodes: NotiaFileNode[]): string {
  let hash = 2166136261
  const visit = (list: NotiaFileNode[]) => {
    for (const node of list) {
      const token = `${node.type}|${node.path ?? ''}|${node.name}`
      for (let index = 0; index < token.length; index += 1) {
        hash ^= token.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      if (node.children && node.children.length > 0) {
        visit(node.children)
      }
    }
  }
  visit(nodes)
  return (hash >>> 0).toString(16).padStart(8, '0')
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
  clearAllPendingTextSaves: () => void
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

export function useLibraryTreeSync({
  activeLibraryId,
  clearAllPendingTextSaves,
  resetTabsAndClearDrawioControllers,
}: UseLibraryTreeSyncParams): UseLibraryTreeSyncActions {
  // These selectors are ONLY consumed by tree sync logic
  const isSidebarOpen = useAppSelector(selectIsSidebarOpen)
  const isRightChatPanelOpen = useAppSelector(selectIsRightChatPanelOpen)
  const isSearchActive = useAppSelector(selectIsSearchActive)
  const explorerRefreshIntervalMs = useAppSelector(selectExplorerRefreshIntervalMs)

  // These selectors are shared with other code outside this hook, but are needed internally
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const activeTabPath = useAppSelector(selectActiveTabPath)
  const activeWorkspaceView = useAppSelector(selectActiveWorkspaceView)

  const isAndroidRuntime = getRuntimeDevice() === 'Android'

  // --- Refs ---
  const treeNodesRef = useRef<NotiaFileNode[]>([])
  const libraryTreeRefreshTimerRef = useRef<number | null>(null)
  const isTreeRefreshInFlightRef = useRef(false)
  const isTreeSignatureProbeInFlightRef = useRef(false)
  const hasQueuedTreeRefreshRef = useRef(false)
  const hasDeferredTreeRefreshRef = useRef(false)
  const lastAutomaticTreeProbeAtRef = useRef(0)
  const lastKnownTreeSignatureRef = useRef('')
  const treeNodesLibraryIdRef = useRef<string | null>(null)
  const activeTabPathRef = useRef<string | null>(null)

  // Sync activeTabPath into ref
  useEffect(() => {
    activeTabPathRef.current = activeTabPath
  }, [activeTabPath])

  // Sync treeNodes from Redux into ref
  useEffect(() => {
    treeNodesRef.current = store.getState().documents.treeNodes
  })

  // --- Computed shouldRefresh flags ---
  const shouldRefreshVisibleExplorerTree =
    activeWorkspaceView !== 'task-manager' && (
      activeWorkspaceView === 'graph'
      || activeWorkspaceView === 'chat'
      || isRightChatPanelOpen
      || isSidebarOpen
    )
  const shouldRefreshActiveLibraryTree = shouldRefreshVisibleExplorerTree || isSearchActive

  // --- Callbacks ---

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
    const current = treeNodesRef.current
    const next = resolveTreeNodeUpdate(current, update)
    if (current === next || areTreeNodeListsEqual(current, next)) {
      return
    }
    treeNodesLibraryIdRef.current = libraryId
    persistExplorerFolderState(libraryId, next)
    store.dispatch(setTreeNodes(next))
  }, [persistExplorerFolderState])

  const commitTreeNodesSnapshot = useCallback((libraryId: string, nodes: NotiaFileNode[]) => {
    lastKnownTreeSignatureRef.current = buildTreeNodesStructureSignature(nodes)
    const library = store.getState().library.libraries.find((entry) => entry.id === libraryId) ?? null
    const expandedStateByPath = treeNodesLibraryIdRef.current === libraryId
      ? collectFolderExpandedState(treeNodesRef.current)
      : loadExplorerFolderExpandedState(library)
    const withExpandedState = applyFolderExpandedState(nodes, expandedStateByPath)
    const selectedNodes = setSelectedFileByPath(withExpandedState, activeTabPathRef.current)
    setTreeNodesForLibrary(libraryId, (current) => (
      areTreeNodeListsEqual(current, selectedNodes)
        ? current
        : selectedNodes
    ))
  }, [setTreeNodesForLibrary])

  const refreshActiveLibraryTree = useCallback(async () => {
    if (!activeLibrary) {
      return
    }
    if (isTreeRefreshInFlightRef.current) {
      hasQueuedTreeRefreshRef.current = true
      notiaLog('treeSync', 'refresh queued (already in flight)', {
        libraryId: activeLibrary.id,
      })
      return
    }
    isTreeRefreshInFlightRef.current = true
    const refreshMeasurement = startPerformanceMeasurement('explorer.refresh_tree', {
      libraryId: activeLibrary.id,
      libraryPath: activeLibrary.path,
    })
    const refreshTimer = notiaTimer('treeSync', 'refreshActiveLibraryTree', {
      libraryId: activeLibrary.id,
    })
    try {
      const refreshedNodes = await readLibraryTree(activeLibrary.path, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })
      commitTreeNodesSnapshot(activeLibrary.id, refreshedNodes)
      refreshMeasurement.success({ nodeCount: countTreeNodes(refreshedNodes) })
      refreshTimer.success({ nodeCount: countTreeNodes(refreshedNodes) })
    } catch (error) {
      refreshMeasurement.error(error)
      refreshTimer.error(error)
      throw error
    } finally {
      isTreeRefreshInFlightRef.current = false
      if (hasQueuedTreeRefreshRef.current) {
        hasQueuedTreeRefreshRef.current = false
        void refreshActiveLibraryTree()
      }
    }
  }, [activeLibrary, commitTreeNodesSnapshot])

  const probeActiveLibraryTreeChanges = useCallback(async () => {
    if (!activeLibrary?.path || isTreeRefreshInFlightRef.current || isTreeSignatureProbeInFlightRef.current) {
      return
    }
    isTreeSignatureProbeInFlightRef.current = true
    const probeTimer = notiaTimer('treeSync', 'probeActiveLibraryTreeChanges', {
      libraryId: activeLibrary.id,
    })
    try {
      const nextSignature = await readLibraryTreeSignature(activeLibrary.path, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })
      if (!nextSignature) { return }
      if (!lastKnownTreeSignatureRef.current) {
        lastKnownTreeSignatureRef.current = nextSignature
        probeTimer.success({ action: 'initial_signature' })
        return
      }
      if (nextSignature === lastKnownTreeSignatureRef.current) {
        probeTimer.success({ action: 'no_change' })
        return
      }
      lastKnownTreeSignatureRef.current = nextSignature
      notiaLog('treeSync', 'tree change detected, refreshing', {
        libraryId: activeLibrary.id,
      })
      probeTimer.success({ action: 'change_detected' })
      await refreshActiveLibraryTree()
    } finally {
      isTreeSignatureProbeInFlightRef.current = false
    }
  }, [activeLibrary, refreshActiveLibraryTree])

  const requestAutomaticTreeProbe = useCallback(() => {
    if (!activeLibrary?.path || !shouldRefreshActiveLibraryTree) {
      return
    }
    if (isAndroidRuntime) { return }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return
    }
    const minimumIntervalMs = Math.max(1000, explorerRefreshIntervalMs)
    if (minimumIntervalMs <= 0) { return }
    const now = Date.now()
    if ((now - lastAutomaticTreeProbeAtRef.current) < minimumIntervalMs) { return }
    lastAutomaticTreeProbeAtRef.current = now
    void probeActiveLibraryTreeChanges()
  }, [
    activeLibrary?.path,
    explorerRefreshIntervalMs,
    probeActiveLibraryTreeChanges,
    shouldRefreshActiveLibraryTree,
  ])

  const notifyLibraryTreeChanged = useCallback((pathHint?: string) => {
    dispatchLibraryTreeChanged({
      pathHint: pathHint ?? activeLibrary?.path,
    })
  }, [activeLibrary?.path])

  const bumpLibraryIndexRevision = useCallback(() => {
    store.dispatch(bumpIndexRevision())
  }, [])

  const handleToggleFolder = useCallback((folderId: string) => {
    const libraryId = store.getState().library.selectedLibraryId
    const currentTreeNodes = treeNodesRef.current

    // On Android with lazy loading, a folder may have hasChildren=true but
    // children not yet loaded. In that case, we need to fetch the children
    // before toggling expansion.
    if (isAndroidRuntime) {
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

      const folder = findFolder(currentTreeNodes)
      if (folder && folder.type === 'folder' && folder.hasChildren && !folder.children?.length) {
        // This folder hasn't loaded its children yet — fetch them lazily.
        const folderPath = folder.path
        // On Android, use the folder's content URI (node.id) as the directory URI
        // for the read call. This ensures we read the correct subdirectory, not
        // the library root. Fall back to the library tree URI only for the root.
        const library = store.getState().library.libraries.find((l) => l.id === libraryId)
        const androidUri = folder.id?.startsWith('content://')
          ? folder.id
          : library?.androidTreeUri

        if (folderPath) {
          store.dispatch(addLoadingFolderId(folderId))
          void readLibraryDirectory(folderPath, { androidDirectoryUri: androidUri })
            .then((children) => {
              // Inject the loaded children into the tree
              const injectChildren = (nodes: NotiaFileNode[]): NotiaFileNode[] =>
                nodes.map((node) => {
                  if (node.id === folderId) {
                    return {
                      ...node,
                      expanded: true,
                      hasChildren: Boolean(children.length) || node.hasChildren,
                      children: children.length > 0 ? children : undefined,
                    }
                  }
                  if (node.type === 'folder' && node.expanded && node.children) {
                    return { ...node, children: injectChildren(node.children) }
                  }
                  return node
                })

              const updated = injectChildren(currentTreeNodes)
              setTreeNodesForLibrary(libraryId, updated)
            })
            .catch((error) => {
              console.error('[notia] failed to load folder children:', folderPath, error)
            })
            .finally(() => {
              store.dispatch(removeLoadingFolderId(folderId))
            })
          return
        }
      }
    }

    setTreeNodesForLibrary(libraryId, (current) => toggleFolderNodeExpanded(current, folderId))
  }, [isAndroidRuntime, setTreeNodesForLibrary])

  const handleCollapseAllFolders = useCallback(() => {
    if (!activeLibrary) { return }
    setTreeNodesForLibrary(activeLibrary.id, (current) => setAllFoldersExpanded(current, false))
  }, [activeLibrary, setTreeNodesForLibrary])

  const handleExpandAllFolders = useCallback(() => {
    if (!activeLibrary) { return }
    setTreeNodesForLibrary(activeLibrary.id, (current) => setAllFoldersExpanded(current, true))
  }, [activeLibrary, setTreeNodesForLibrary])

  // --- Effects ---

  // Library load effect
  useEffect(() => {
    if (!activeLibrary) {
      clearAllPendingTextSaves()
      store.dispatch(setTreeNodes([]))
      treeNodesLibraryIdRef.current = null
      store.dispatch(setPendingCreation(null))
      lastKnownTreeSignatureRef.current = ''
      lastAutomaticTreeProbeAtRef.current = 0
      isTreeRefreshInFlightRef.current = false
      isTreeSignatureProbeInFlightRef.current = false
      hasQueuedTreeRefreshRef.current = false
      hasDeferredTreeRefreshRef.current = false
      if (libraryTreeRefreshTimerRef.current !== null) {
        window.clearTimeout(libraryTreeRefreshTimerRef.current)
        libraryTreeRefreshTimerRef.current = null
      }
      store.dispatch(setLibraryStatus('idle'))
      return
    }

    clearAllPendingTextSaves()
    lastKnownTreeSignatureRef.current = ''
    lastAutomaticTreeProbeAtRef.current = 0
    isTreeRefreshInFlightRef.current = false
    isTreeSignatureProbeInFlightRef.current = false
    hasQueuedTreeRefreshRef.current = false
    hasDeferredTreeRefreshRef.current = false
    store.dispatch(setLibraryStatus('loading'))

    notiaLog('treeSync', 'library loading started', {
      libraryId: activeLibrary.id,
      libraryPath: activeLibrary.path,
      refreshIntervalMs: explorerRefreshIntervalMs,
      isAndroid: isAndroidRuntime,
    })

    let isCurrent = true
    const libraryLoadMeasurement = startPerformanceMeasurement('library.switch_load', {
      libraryId: activeLibrary.id,
      libraryPath: activeLibrary.path,
    })
    void (async () => {
      try {
        try {
          await Promise.all([
            ensureChatLibraryStructure(activeLibrary),
            ensureAgentPromptFile(activeLibrary),
            [initializeLibraryDatabase(activeLibrary.path, activeLibrary.androidTreeUri).then((result) => {
              if (!result.ok) {
                throw new Error(result.error ?? 'No se pudo inicializar la base SQLite.')
              }
            })],
          ])
        } catch (error) {
          console.warn('[notia] could not ensure auxiliary library structure', {
            libraryPath: activeLibrary.path,
            error,
          })
        }

        const nodes = isAndroidRuntime
          ? await readLibraryDirectory(activeLibrary.path, {
              androidDirectoryUri: activeLibrary.androidTreeUri,
            })
          : await readLibraryTree(activeLibrary.path, {
              androidDirectoryUri: activeLibrary.androidTreeUri,
            })
        if (!isCurrent) {
          libraryLoadMeasurement.cancel()
          return
        }
        notiaLog('treeSync', 'tree read completed', {
          libraryId: activeLibrary.id,
          nodeCount: nodes.length,
        })
        commitTreeNodesSnapshot(activeLibrary.id, nodes)
        store.dispatch(setLibraryStatus('ready'))
        notiaLog('treeSync', 'library ready', {
          libraryId: activeLibrary.id,
          nodeCount: nodes.length,
        })
        libraryLoadMeasurement.success({ nodeCount: countTreeNodes(nodes) })

        // On Android, trigger background flat file list fetch for search
        // and graph engines. This does NOT block the UI — the flat file
        // list populates search/index in the background.
        if (isAndroidRuntime) {
          void readLibraryFlatFileList(activeLibrary.path, {
            androidDirectoryUri: activeLibrary.androidTreeUri,
          }).then((flatFiles) => {
            if (!isCurrent) { return }
            notiaLog('treeSync', 'flat file list loaded', {
              libraryId: activeLibrary.id,
              fileCount: flatFiles.length,
            })
            store.dispatch(setFlatFileList(flatFiles))
          }).catch((error) => {
            console.error('[notia] failed to load flat file list:', error)
          })
        }
      } catch (error) {
        if (!isCurrent) {
          libraryLoadMeasurement.cancel()
          return
        }
        store.dispatch(setLibraryStatus('error'))
        libraryLoadMeasurement.error(error instanceof Error ? error : new Error(String(error)))
      }
    })()

    return () => {
      isCurrent = false
      libraryLoadMeasurement.cancel({ stage: 'cleanup' })
    }
  }, [activeLibrary, clearAllPendingTextSaves, commitTreeNodesSnapshot])

  // Library ID reset effect
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
    lastKnownTreeSignatureRef.current = ''
    lastAutomaticTreeProbeAtRef.current = 0
    isTreeSignatureProbeInFlightRef.current = false
    hasDeferredTreeRefreshRef.current = false
    hasQueuedTreeRefreshRef.current = false
    isTreeRefreshInFlightRef.current = false
    if (libraryTreeRefreshTimerRef.current !== null) {
      window.clearTimeout(libraryTreeRefreshTimerRef.current)
      libraryTreeRefreshTimerRef.current = null
    }
  }, [activeLibraryId, clearAllPendingTextSaves, resetTabsAndClearDrawioControllers])

  // Selection sync effect
  useEffect(() => {
    const libraryId = store.getState().library.selectedLibraryId
    setTreeNodesForLibrary(libraryId, (current) => setSelectedFileByPath(current, activeTabPath))
  }, [activeTabPath, setTreeNodesForLibrary])

  // Deferred refresh effect
  useEffect(() => {
    if (!activeLibrary?.path || !shouldRefreshActiveLibraryTree) { return }
    if (!hasDeferredTreeRefreshRef.current) { return }
    hasDeferredTreeRefreshRef.current = false
    void refreshActiveLibraryTree()
  }, [activeLibrary?.path, refreshActiveLibraryTree, shouldRefreshActiveLibraryTree])

  // Auto-probe trigger effect
  useEffect(() => {
    if (!activeLibrary?.path || !shouldRefreshActiveLibraryTree) { return }
    requestAutomaticTreeProbe()
  }, [activeLibrary?.path, requestAutomaticTreeProbe, shouldRefreshActiveLibraryTree])

  // Tree change event listener
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

      if (libraryTreeRefreshTimerRef.current !== null) {
        window.clearTimeout(libraryTreeRefreshTimerRef.current)
      }

      invalidateLibrarySearchGraphIndex(currentActiveLibraryPath, changedPathHint ?? currentActiveLibraryPath)

      libraryTreeRefreshTimerRef.current = window.setTimeout(() => {
        libraryTreeRefreshTimerRef.current = null
        if (!shouldRefreshActiveLibraryTree) {
          hasDeferredTreeRefreshRef.current = true
          bumpLibraryIndexRevision()
          return
        }
        hasDeferredTreeRefreshRef.current = false
        void refreshActiveLibraryTree()
        bumpLibraryIndexRevision()
      }, 120)
    }

    window.addEventListener('notia:library-tree-changed', handleLibraryTreeChanged)
    return () => {
      window.removeEventListener('notia:library-tree-changed', handleLibraryTreeChanged)
      if (libraryTreeRefreshTimerRef.current !== null) {
        window.clearTimeout(libraryTreeRefreshTimerRef.current)
        libraryTreeRefreshTimerRef.current = null
      }
    }
  }, [activeLibrary?.path, bumpLibraryIndexRevision, refreshActiveLibraryTree, shouldRefreshActiveLibraryTree])

  // Visibility/focus listeners
  useEffect(() => {
    if (!activeLibrary?.path) { return }

    const requestProbe = () => {
      if (!shouldRefreshActiveLibraryTree) { return }
      requestAutomaticTreeProbe()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') { return }
      requestProbe()
    }

    window.addEventListener('focus', requestProbe)
    window.addEventListener('pageshow', requestProbe)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', requestProbe)
      window.removeEventListener('pageshow', requestProbe)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [activeLibrary?.path, requestAutomaticTreeProbe, shouldRefreshActiveLibraryTree])

  // File watcher effect (desktop only)
  useEffect(() => {
    if (isAndroidRuntime || !activeLibrary?.path) { return }

    let isDisposed = false
    let unsubscribe: (() => void) | null = null

    void (async () => {
      try {
        const nextUnsubscribe = await subscribeToDesktopLibraryTreeWatchBridge()
        if (isDisposed) {
          nextUnsubscribe()
          return
        }
        unsubscribe = nextUnsubscribe
        await startDesktopLibraryTreeWatch(activeLibrary.path)
      } catch (error) {
        console.warn('[notia] could not start desktop library tree watch bridge', {
          libraryPath: activeLibrary.path,
          error,
        })
      }
    })()

    return () => {
      isDisposed = true
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
      void stopDesktopLibraryTreeWatch()
    }
  }, [activeLibrary?.path, isAndroidRuntime])

  return {
    setTreeNodesForLibrary,
    handleToggleFolder,
    handleCollapseAllFolders,
    handleExpandAllFolders,
    notifyLibraryTreeChanged,
    bumpLibraryIndexRevision,
  }
}
