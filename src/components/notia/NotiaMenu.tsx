import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { Bot } from 'lucide-react'
import {
  EXPLORER_HEADER_ACTIONS,
  LEFT_RAIL_ACTIONS,
  TAB_ICON,
  TITLEBAR_RIGHT_ACTIONS,
  TOP_TOOLBAR_ACTIONS,
} from '../../constants/notiaMenu'
import {
  loadActiveLibraryId,
  loadLibraries,
  saveActiveLibraryId,
  saveLibraries,
} from '../../services/libraries/libraryStorage'
import {
  createLibraryEntry,
  filterExistingLibraries,
  performLibraryEntryOperation,
  readLibraryTree,
  readLibraryTreeSignature,
  searchLibraryFiles,
} from '../../services/libraries/libraryRuntime'
import {
  readLibraryFileContent,
  writeLibraryFileContent,
} from '../../services/libraries/libraryDocumentRuntime'
import { controlWindow } from '../../services/window/windowRuntime'
import { applySearchMatchesToTree } from '../../engines/tree/applySearchMatchesToTree'
import { isTextualViewKind, resolveFileViewKind } from '../../services/views/fileViewResolver'
import { buildWikiLinkTargets } from '../../engines/markdown/wikiLinkEngine'
import { useLibraryGraphData } from '../../hooks/useLibraryGraphData'
import { loadThemePreference, saveThemePreference, type NotiaTheme } from '../../services/preferences/themeStorage'
import {
  loadExplorerFolderExpandedState,
  loadExplorerRefreshIntervalMs,
  saveExplorerFolderExpandedState,
  saveExplorerRefreshIntervalMs,
} from '../../services/preferences/explorerPanelStorage'
import { loadInkdocPreferences, saveInkdocPreferences } from '../../services/preferences/inkdocSettingsStorage'
import { useConfirmationEngine } from '../../context/confirmation/useConfirmationEngine'
import type { NotiaFileNode, NotiaLibrary } from '../../types/notia'
import {
  isTextFileDocument,
  type NotiaDocumentSaveStatus,
  type OpenFileDocument,
  type OpenTextFileDocument,
} from '../../types/views/fileDocument'
import { getFileExtension } from '../../utils/files/getFileExtension'
import { toFileUrl } from '../../utils/files/toFileUrl'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import { setFolderExpandedByPath } from '../../utils/tree/setFolderExpandedByPath'
import { setAllFoldersExpanded } from '../../utils/tree/setAllFoldersExpanded'
import { setSelectedFileByPath } from '../../utils/tree/setSelectedFileByPath'
import { toggleFolderNodeExpanded } from '../../utils/tree/toggleFolderNodeExpanded'
import { FileTreeContextMenu } from './FileTreeContextMenu'
import { AppDialogModal } from './AppDialogModal'
import { FileTree } from './FileTree'
import { IconRail } from './IconRail'
import { LibraryManagerModal } from './LibraryManagerModal'
import { MainView } from './MainView'
import { SettingsModal } from './SettingsModal'
import { WindowTitleBar } from './WindowTitleBar'
import { WorkspaceFooter } from './WorkspaceFooter'
import { GraphView } from './views/GraphView'
import { TaskManagerApp } from '../../modules/task-manager/components/TaskManagerApp'

const MARKDOWN_AUTOSAVE_DEBOUNCE_MS = 1200
const TEXT_AUTOSAVE_DEBOUNCE_MS = 380

interface PendingTextSaveJob {
  source: string
  timeoutId: number
}

function findInitialActiveLibrary(libraries: NotiaLibrary[]): string | null {
  if (libraries.length === 0) {
    return null
  }
  const savedId = loadActiveLibraryId()
  if (savedId && libraries.some((library) => library.id === savedId)) {
    return savedId
  }
  return libraries[0].id
}

function getParentDirectory(filePath: string): string {
  const lastForwardSlash = filePath.lastIndexOf('/')
  const lastBackwardSlash = filePath.lastIndexOf('\\')
  const separatorIndex = Math.max(lastForwardSlash, lastBackwardSlash)
  if (separatorIndex < 0) {
    return filePath
  }
  if (separatorIndex === 0) {
    return filePath.slice(0, 1)
  }
  if (separatorIndex === 2 && /^[a-zA-Z]:[\\/]/.test(filePath)) {
    return filePath.slice(0, 3)
  }
  return filePath.slice(0, separatorIndex)
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

function areLibrariesEquivalent(current: NotiaLibrary[], next: NotiaLibrary[]): boolean {
  if (current.length !== next.length) {
    return false
  }

  return current.every((library, index) => {
    const candidate = next[index]
    if (!candidate) {
      return false
    }

    return library.id === candidate.id
      && library.path === candidate.path
      && (library.androidTreeUri ?? '') === (candidate.androidTreeUri ?? '')
  })
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

      return {
        ...node,
        children: nextChildren,
      }
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

function findTreeNodeByPath(nodes: NotiaFileNode[], path: string): NotiaFileNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node
    }

    if (node.children && node.children.length > 0) {
      const nestedNode = findTreeNodeByPath(node.children, path)
      if (nestedNode) {
        return nestedNode
      }
    }
  }

  return null
}

function resolveTextAutosaveDebounceMs(document: OpenTextFileDocument): number {
  return document.viewKind === 'markdown'
    ? MARKDOWN_AUTOSAVE_DEBOUNCE_MS
    : TEXT_AUTOSAVE_DEBOUNCE_MS
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

function joinParentPath(parentPath: string, originalPath: string, name: string): string {
  const separator = originalPath.includes('\\') ? '\\' : '/'
  if (parentPath.endsWith('/') || parentPath.endsWith('\\')) {
    return `${parentPath}${name}`
  }
  return `${parentPath}${separator}${name}`
}

interface OpenDocumentTab {
  document: OpenFileDocument
  saveStatus: NotiaDocumentSaveStatus
  latestSavedSource: string
}

type OpenTextDocumentTab = Omit<OpenDocumentTab, 'document'> & {
  document: OpenTextFileDocument
}

interface WorkspaceTitleTab {
  path: string
  title: string
}

interface OpenWorkspaceSpecialTabs {
  graph: boolean
  taskManager: boolean
}

const GRAPH_WORKSPACE_TAB_PATH = '__workspace_graph__'
const TASK_MANAGER_WORKSPACE_TAB_PATH = '__workspace_task_manager__'

function getDisplayBaseName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return value
  }

  const stripQueryAndHash = (input: string): string => input.replace(/[?#].*$/, '')
  const decodePath = (input: string): string => {
    try {
      return decodeURIComponent(input)
    } catch {
      return input
    }
  }

  let normalized = stripQueryAndHash(trimmed).replace(/\\/g, '/')
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      normalized = decodePath(`${parsed.hostname}${parsed.pathname}`).replace(/\\/g, '/')
    } catch {
      normalized = decodePath(normalized)
    }
  } else {
    normalized = decodePath(normalized)
  }

  let leaf = normalized.split('/').filter(Boolean).pop() ?? normalized
  if (!leaf) {
    leaf = trimmed
  }

  const lastColonIndex = leaf.lastIndexOf(':')
  if (lastColonIndex > 0) {
    leaf = leaf.slice(lastColonIndex + 1)
  }

  const lastDotIndex = leaf.lastIndexOf('.')
  if (lastDotIndex > 0) {
    return leaf.slice(0, lastDotIndex)
  }
  return leaf
}

function resolveWorkspaceTabTitle(tab: OpenDocumentTab): string {
  return getDisplayBaseName(tab.document.name || tab.document.path)
}

function buildWorkspaceTitleTabs(
  documentTabs: OpenDocumentTab[],
  specialTabs: OpenWorkspaceSpecialTabs,
): WorkspaceTitleTab[] {
  const tabs: WorkspaceTitleTab[] = documentTabs.map((tab) => ({
    path: tab.document.path,
    title: resolveWorkspaceTabTitle(tab),
  }))

  if (specialTabs.graph) {
    tabs.push({ path: GRAPH_WORKSPACE_TAB_PATH, title: 'Graph view' })
  }

  if (specialTabs.taskManager) {
    tabs.push({ path: TASK_MANAGER_WORKSPACE_TAB_PATH, title: 'Task manager' })
  }

  return tabs
}

function isOpenTextDocumentTab(tab: OpenDocumentTab | null): tab is OpenTextDocumentTab {
  return Boolean(tab && isTextFileDocument(tab.document))
}

export function NotiaMenu() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [graphRevision, setGraphRevision] = useState(0)
  const [activeHeaderAction, setActiveHeaderAction] = useState('')
  const [isSearchMenuOpen, setIsSearchMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchedPaths, setSearchMatchedPaths] = useState<string[]>([])
  const [isSearchLoading, setIsSearchLoading] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isLibraryManagerOpen, setIsLibraryManagerOpen] = useState(false)
  const [theme, setTheme] = useState<NotiaTheme>(() => loadThemePreference())
  const [explorerRefreshIntervalMs, setExplorerRefreshIntervalMs] = useState<number>(() => loadExplorerRefreshIntervalMs())
  const [inkdocPreferences, setInkdocPreferences] = useState(() => loadInkdocPreferences())
  const [libraries, setLibraries] = useState<NotiaLibrary[]>(() => loadLibraries())
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(() =>
    findInitialActiveLibrary(loadLibraries()),
  )
  const [treeNodes, setTreeNodes] = useState<NotiaFileNode[]>([])
  const [openTabs, setOpenTabs] = useState<OpenDocumentTab[]>([])
  const [openWorkspaceSpecialTabs, setOpenWorkspaceSpecialTabs] = useState<OpenWorkspaceSpecialTabs>({
    graph: false,
    taskManager: false,
  })
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [pendingCreation, setPendingCreation] = useState<{
    id: string
    kind: 'folder' | 'note' | 'inkdoc'
    initialName: string
    parentPath: string
  } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [clipboardEntry, setClipboardEntry] = useState<{
    path: string
    mode: 'copy' | 'move'
  } | null>(null)
  const [contextMenu, setContextMenu] = useState<
    | { type: 'empty'; x: number; y: number }
    | { type: 'node'; x: number; y: number; node: NotiaFileNode }
    | null
  >(null)
  const [dialogState, setDialogState] = useState<{ type: 'info'; title: string; message: string } | null>(null)
  const { confirm } = useConfirmationEngine()
  const runtimeDevice = useMemo(() => getRuntimeDevice(), [])
  const isAndroidRuntime = runtimeDevice === 'Android'
  const titlebarRightActions = useMemo(
    () => (isAndroidRuntime ? [] : TITLEBAR_RIGHT_ACTIONS),
    [isAndroidRuntime],
  )

  const activeTabPathRef = useRef<string | null>(null)
  const openTabsRef = useRef<OpenDocumentTab[]>([])
  const openWorkspaceSpecialTabsRef = useRef<OpenWorkspaceSpecialTabs>({
    graph: false,
    taskManager: false,
  })
  const treeNodesRef = useRef<NotiaFileNode[]>([])
  const pendingTextSaveByPathRef = useRef<Map<string, PendingTextSaveJob>>(new Map())
  const libraryTreeRefreshTimerRef = useRef<number | null>(null)
  const isTreeRefreshInFlightRef = useRef(false)
  const isTreeSignatureProbeInFlightRef = useRef(false)
  const hasQueuedTreeRefreshRef = useRef(false)
  const hasDeferredTreeRefreshRef = useRef(false)
  const isGraphViewActiveRef = useRef(false)
  const lastKnownTreeSignatureRef = useRef('')
  const treeNodesLibraryIdRef = useRef<string | null>(null)

  const activeLibrary = useMemo(
    () => libraries.find((library) => library.id === activeLibraryId) ?? null,
    [activeLibraryId, libraries],
  )
  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.document.path === activeTabPath) ?? null,
    [activeTabPath, openTabs],
  )
  const activeDocument = activeTab?.document ?? null
  const activeWorkspaceView = activeTabPath === GRAPH_WORKSPACE_TAB_PATH
    ? 'graph'
    : activeTabPath === TASK_MANAGER_WORKSPACE_TAB_PATH
      ? 'task-manager'
      : 'documents'
  const isGraphViewActive = activeWorkspaceView === 'graph'
  const shouldRefreshVisibleExplorerTree =
    activeWorkspaceView !== 'task-manager' && (activeWorkspaceView === 'graph' || isSidebarOpen)
  const isMarkdownDocumentActive = activeDocument?.viewKind === 'markdown'
  const saveStatus = activeTab?.saveStatus ?? 'idle'
  const normalizedSearchQuery = searchQuery.trim()
  const searchMatchedPathSet = useMemo(() => new Set(searchMatchedPaths), [searchMatchedPaths])
  const isSearchActive = normalizedSearchQuery.length > 0
  const displayedTreeNodes = useMemo(
    () => applySearchMatchesToTree(treeNodes, searchMatchedPathSet, isSearchActive),
    [treeNodes, searchMatchedPathSet, isSearchActive],
  )
  const titleBarTabs = useMemo(
    () => buildWorkspaceTitleTabs(openTabs, openWorkspaceSpecialTabs),
    [openTabs, openWorkspaceSpecialTabs],
  )
  const markdownWikiLinkTargets = useMemo(
    () => (isMarkdownDocumentActive ? buildWikiLinkTargets(treeNodes, activeLibrary?.path ?? null) : []),
    [activeLibrary?.path, isMarkdownDocumentActive, treeNodes],
  )
  const libraryFilePaths = useMemo(() => {
    const paths: string[] = []
    const collect = (nodes: NotiaFileNode[]) => {
      for (const node of nodes) {
        if (node.type === 'file' && node.path) {
          paths.push(node.path)
        }

        if (node.children && node.children.length > 0) {
          collect(node.children)
        }
      }
    }

    collect(treeNodes)
    return paths
  }, [treeNodes])
  const { graphModel, graphSourcesByPath, isGraphLoading } = useLibraryGraphData({
    enabled: isGraphViewActive,
    libraryPath: activeLibrary?.path ?? null,
    rootPath: activeLibrary?.path ?? null,
    treeNodes,
    revision: graphRevision,
  })

  const resetTabs = useCallback(() => {
    setOpenTabs([])
    setOpenWorkspaceSpecialTabs({
      graph: false,
      taskManager: false,
    })
    setActiveTabPath(null)
  }, [])

  const clearPendingTextSaveByPath = useCallback((path: string) => {
    const pendingSave = pendingTextSaveByPathRef.current.get(path)
    if (!pendingSave) {
      return
    }

    window.clearTimeout(pendingSave.timeoutId)
    pendingTextSaveByPathRef.current.delete(path)
  }, [])

  const clearAllPendingTextSaves = useCallback(() => {
    for (const pendingSave of pendingTextSaveByPathRef.current.values()) {
      window.clearTimeout(pendingSave.timeoutId)
    }
    pendingTextSaveByPathRef.current.clear()
  }, [])

  const bumpGraphRevisionIfVisible = useCallback(() => {
    if (!isGraphViewActiveRef.current) {
      return
    }

    setGraphRevision((current) => current + 1)
  }, [])

  const persistTextDocumentSource = useCallback(
    async (targetPath: string, targetSource: string): Promise<boolean> => {
      const currentTab = openTabsRef.current.find((tab) => tab.document.path === targetPath)
      if (!currentTab || !isTextFileDocument(currentTab.document) || currentTab.document.source !== targetSource) {
        return true
      }

      setOpenTabs((current) =>
        current.map((tab) => (
          tab.document.path === targetPath && tab.saveStatus !== 'saving'
            ? { ...tab, saveStatus: 'saving' }
            : tab
        )),
      )

      const result = await writeLibraryFileContent(targetPath, targetSource)
      const latestTab = openTabsRef.current.find((tab) => tab.document.path === targetPath)
      if (!latestTab || !isTextFileDocument(latestTab.document) || latestTab.document.source !== targetSource) {
        return true
      }

      if (result.ok) {
        setOpenTabs((current) =>
          current.map((tab) => {
            if (tab.document.path !== targetPath) {
              return tab
            }

            if (tab.latestSavedSource === targetSource && tab.saveStatus === 'idle') {
              return tab
            }

            return {
              ...tab,
              latestSavedSource: targetSource,
              saveStatus: 'idle',
            }
          }),
        )
        bumpGraphRevisionIfVisible()
        return true
      }

      setOpenTabs((current) =>
        current.map((tab) => (tab.document.path === targetPath ? { ...tab, saveStatus: 'error' } : tab)),
      )
      setDialogState((current) => {
        if (current) {
          return current
        }

        return {
          type: 'info',
          title: 'No se pudo guardar',
          message: result.error ?? 'No se pudo guardar el archivo.',
        }
      })
      return false
    },
    [bumpGraphRevisionIfVisible],
  )

  useEffect(() => {
    isGraphViewActiveRef.current = isGraphViewActive
  }, [isGraphViewActive])

  useEffect(() => {
    saveLibraries(libraries)
  }, [libraries])

  useEffect(() => {
    let isCancelled = false

    void (async () => {
      const existingLibraries = await filterExistingLibraries(libraries)
      if (isCancelled || areLibrariesEquivalent(libraries, existingLibraries)) {
        return
      }

      setLibraries(existingLibraries)
    })()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!activeLibraryId) {
      if (libraries.length > 0) {
        setActiveLibraryId(libraries[0].id)
      }
      return
    }

    if (!libraries.some((library) => library.id === activeLibraryId)) {
      setActiveLibraryId(libraries.length > 0 ? libraries[0].id : null)
    }
  }, [activeLibraryId, libraries])

  useEffect(() => {
    saveActiveLibraryId(activeLibraryId)
  }, [activeLibraryId])

  useEffect(() => {
    saveThemePreference(theme)
  }, [theme])

  useEffect(() => {
    saveExplorerRefreshIntervalMs(explorerRefreshIntervalMs)
  }, [explorerRefreshIntervalMs])

  useEffect(() => {
    saveInkdocPreferences(inkdocPreferences)
  }, [inkdocPreferences])

  useEffect(() => {
    activeTabPathRef.current = activeTabPath
  }, [activeTabPath])

  useEffect(() => {
    openTabsRef.current = openTabs
  }, [openTabs])

  useEffect(() => {
    openWorkspaceSpecialTabsRef.current = openWorkspaceSpecialTabs
  }, [openWorkspaceSpecialTabs])

  useEffect(() => {
    treeNodesRef.current = treeNodes
  }, [treeNodes])

  const persistExplorerFolderState = useCallback((libraryId: string | null, nodes: NotiaFileNode[]) => {
    if (!libraryId) {
      return
    }

    saveExplorerFolderExpandedState(libraryId, collectFolderExpandedState(nodes))
  }, [])

  const setTreeNodesForLibrary = useCallback((
    libraryId: string | null,
    update: SetStateAction<NotiaFileNode[]>,
  ) => {
    setTreeNodes((current) => {
      const next = resolveTreeNodeUpdate(current, update)
      treeNodesLibraryIdRef.current = libraryId
      persistExplorerFolderState(libraryId, next)
      return next
    })
  }, [persistExplorerFolderState])

  const commitTreeNodesSnapshot = useCallback((libraryId: string, nodes: NotiaFileNode[]) => {
    lastKnownTreeSignatureRef.current = buildTreeNodesStructureSignature(nodes)
    const expandedStateByPath = treeNodesLibraryIdRef.current === libraryId
      ? collectFolderExpandedState(treeNodesRef.current)
      : loadExplorerFolderExpandedState(libraryId)
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
      return
    }

    isTreeRefreshInFlightRef.current = true
    try {
      const refreshedNodes = await readLibraryTree(activeLibrary.path, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })
      commitTreeNodesSnapshot(activeLibrary.id, refreshedNodes)
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
    try {
      const nextSignature = await readLibraryTreeSignature(activeLibrary.path, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })

      if (!nextSignature) {
        return
      }

      if (!lastKnownTreeSignatureRef.current) {
        lastKnownTreeSignatureRef.current = nextSignature
        return
      }

      if (nextSignature === lastKnownTreeSignatureRef.current) {
        return
      }

      lastKnownTreeSignatureRef.current = nextSignature
      await refreshActiveLibraryTree()
    } finally {
      isTreeSignatureProbeInFlightRef.current = false
    }
  }, [activeLibrary, refreshActiveLibraryTree])

  useEffect(() => {
    if (!activeLibrary || normalizedSearchQuery.length === 0) {
      setSearchMatchedPaths([])
      setIsSearchLoading(false)
      return
    }

    let isCurrent = true
    setIsSearchLoading(true)

    const timeoutId = window.setTimeout(() => {
      void searchLibraryFiles(activeLibrary.path, normalizedSearchQuery)
        .then((paths) => {
          if (!isCurrent) {
            return
          }
          setSearchMatchedPaths(paths)
        })
        .finally(() => {
          if (!isCurrent) {
            return
          }
          setIsSearchLoading(false)
        })
    }, 220)

    return () => {
      isCurrent = false
      window.clearTimeout(timeoutId)
    }
  }, [activeLibrary, normalizedSearchQuery])

  useEffect(() => {
    if (!activeLibrary) {
      clearAllPendingTextSaves()
      setTreeNodes([])
      treeNodesLibraryIdRef.current = null
      setPendingCreation(null)
      lastKnownTreeSignatureRef.current = ''
      isTreeRefreshInFlightRef.current = false
      isTreeSignatureProbeInFlightRef.current = false
      hasQueuedTreeRefreshRef.current = false
      hasDeferredTreeRefreshRef.current = false
      if (libraryTreeRefreshTimerRef.current !== null) {
        window.clearTimeout(libraryTreeRefreshTimerRef.current)
        libraryTreeRefreshTimerRef.current = null
      }
      return
    }

    clearAllPendingTextSaves()
    lastKnownTreeSignatureRef.current = ''
    isTreeRefreshInFlightRef.current = false
    isTreeSignatureProbeInFlightRef.current = false
    hasQueuedTreeRefreshRef.current = false
    hasDeferredTreeRefreshRef.current = false

    let isCurrent = true
    void readLibraryTree(activeLibrary.path, {
      androidDirectoryUri: activeLibrary.androidTreeUri,
    }).then((nodes) => {
      if (!isCurrent) {
        return
      }

      commitTreeNodesSnapshot(activeLibrary.id, nodes)
    })

    return () => {
      isCurrent = false
    }
  }, [activeLibrary, clearAllPendingTextSaves, commitTreeNodesSnapshot])

  useEffect(() => {
    setPendingCreation(null)
    setRenamingPath(null)
    setContextMenu(null)
    setDialogState(null)
    setIsSearchMenuOpen(false)
    setSearchQuery('')
    setSearchMatchedPaths([])
    setIsSearchLoading(false)
    setActiveHeaderAction('')
    resetTabs()
    clearAllPendingTextSaves()
    lastKnownTreeSignatureRef.current = ''
    isTreeSignatureProbeInFlightRef.current = false
    hasDeferredTreeRefreshRef.current = false
    hasQueuedTreeRefreshRef.current = false
    isTreeRefreshInFlightRef.current = false
    if (libraryTreeRefreshTimerRef.current !== null) {
      window.clearTimeout(libraryTreeRefreshTimerRef.current)
      libraryTreeRefreshTimerRef.current = null
    }
  }, [activeLibraryId, clearAllPendingTextSaves, resetTabs])

  useEffect(() => {
    setTreeNodesForLibrary(activeLibraryId, (current) => setSelectedFileByPath(current, activeTabPath))
  }, [activeLibraryId, activeTabPath, setTreeNodesForLibrary])

  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }

    window.addEventListener('click', handleGlobalClick)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('click', handleGlobalClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    const dirtySourceByPath = new Map<string, string>()

    for (const tab of openTabs) {
      if (!isOpenTextDocumentTab(tab)) {
        continue
      }

      if (tab.saveStatus === 'error') {
        continue
      }

      if (tab.document.source === tab.latestSavedSource) {
        continue
      }

      dirtySourceByPath.set(tab.document.path, tab.document.source)
    }

    for (const [path, pendingSave] of pendingTextSaveByPathRef.current) {
      const dirtySource = dirtySourceByPath.get(path)
      if (dirtySource && dirtySource === pendingSave.source) {
        continue
      }

      window.clearTimeout(pendingSave.timeoutId)
      pendingTextSaveByPathRef.current.delete(path)
    }

    for (const tab of openTabs) {
      if (!isOpenTextDocumentTab(tab)) {
        continue
      }

      if (tab.saveStatus === 'error') {
        continue
      }

      if (tab.document.source === tab.latestSavedSource) {
        continue
      }

      const targetPath = tab.document.path
      const targetSource = tab.document.source
      const pendingSave = pendingTextSaveByPathRef.current.get(targetPath)
      if (pendingSave && pendingSave.source === targetSource) {
        continue
      }

      if (pendingSave) {
        window.clearTimeout(pendingSave.timeoutId)
      }

      const timeoutId = window.setTimeout(() => {
        const queuedSave = pendingTextSaveByPathRef.current.get(targetPath)
        if (!queuedSave || queuedSave.source !== targetSource) {
          return
        }

        pendingTextSaveByPathRef.current.delete(targetPath)
        void persistTextDocumentSource(targetPath, targetSource)
      }, resolveTextAutosaveDebounceMs(tab.document))

      pendingTextSaveByPathRef.current.set(targetPath, {
        source: targetSource,
        timeoutId,
      })
    }
  }, [openTabs, persistTextDocumentSource])

  useEffect(() => {
    return () => {
      clearAllPendingTextSaves()
    }
  }, [clearAllPendingTextSaves])

  const handleSidebarToggle = useCallback(() => {
    setIsSidebarOpen((current) => {
      const next = !current
      if (!next) {
        setIsSearchMenuOpen(false)
        setActiveHeaderAction('')
      }
      return next
    })
  }, [])

  const handleHeaderActionClick = useCallback((id: string) => {
    if (id === 'layout') {
      handleSidebarToggle()
      return
    }

    if (id === 'search') {
      setIsSearchMenuOpen((current) => {
        const next = !current
        setActiveHeaderAction(next ? 'search' : '')
        return next
      })
      return
    }

    setActiveHeaderAction(id)
  }, [handleSidebarToggle])

  const handleCloseSearchMenu = useCallback(() => {
    setIsSearchMenuOpen(false)
    setActiveHeaderAction((current) => (current === 'search' ? '' : current))
  }, [])

  const handleSelectLibrary = useCallback((libraryId: string) => {
    setActiveLibraryId(libraryId)
  }, [])

  const handleToggleFolder = useCallback((folderId: string) => {
    setTreeNodesForLibrary(activeLibraryId, (current) => toggleFolderNodeExpanded(current, folderId))
  }, [activeLibraryId, setTreeNodesForLibrary])

  const handleThemeToggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  const handleRailActionClick = useCallback((actionId: string) => {
    if (actionId === 'graph-view') {
      setOpenWorkspaceSpecialTabs((current) => (
        current.graph
          ? current
          : {
              ...current,
              graph: true,
            }
      ))
      setActiveTabPath(GRAPH_WORKSPACE_TAB_PATH)
      return
    }

    if (actionId === 'task-manager') {
      setOpenWorkspaceSpecialTabs((current) => (
        current.taskManager
          ? current
          : {
              ...current,
              taskManager: true,
            }
      ))
      setActiveTabPath(TASK_MANAGER_WORKSPACE_TAB_PATH)
    }
  }, [])

  const handleExplorerToolClick = useCallback((toolId: string) => {
    if (!activeLibrary) {
      return
    }

    setContextMenu(null)
    setRenamingPath(null)

    if (toolId === 'new-note') {
      setPendingCreation({
        id: `pending-note-${Date.now()}`,
        kind: 'note',
        initialName: 'Nueva nota',
        parentPath: activeLibrary.path,
      })
      return
    }

    if (toolId === 'new-inkdoc') {
      setPendingCreation({
        id: `pending-inkdoc-${Date.now()}`,
        kind: 'inkdoc',
        initialName: 'Nuevo inkdoc',
        parentPath: activeLibrary.path,
      })
      return
    }

    if (toolId === 'new-folder') {
      setPendingCreation({
        id: `pending-folder-${Date.now()}`,
        kind: 'folder',
        initialName: 'Nueva carpeta',
        parentPath: activeLibrary.path,
      })
      return
    }

    if (toolId === 'collapse-folders') {
      setTreeNodesForLibrary(activeLibrary.id, (current) => setAllFoldersExpanded(current, false))
      return
    }

    if (toolId === 'expand-folders') {
      setTreeNodesForLibrary(activeLibrary.id, (current) => setAllFoldersExpanded(current, true))
    }
  }, [activeLibrary, setTreeNodesForLibrary])

  const handleWindowAction = useCallback((action: NotiaWindowAction) => {
    void controlWindow(action)
  }, [])

  const handleActivateTab = useCallback((tabPath: string) => {
    if (tabPath === GRAPH_WORKSPACE_TAB_PATH || tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH) {
      const specialTabs = openWorkspaceSpecialTabsRef.current
      if ((tabPath === GRAPH_WORKSPACE_TAB_PATH && !specialTabs.graph) || (tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH && !specialTabs.taskManager)) {
        return
      }

      setActiveTabPath(tabPath)
      return
    }

    if (!openTabsRef.current.some((tab) => tab.document.path === tabPath)) {
      return
    }

    setActiveTabPath(tabPath)
  }, [])

  const persistOpenTabBeforeClose = useCallback(
    async (tab: OpenDocumentTab): Promise<boolean> => {
      const tabPath = tab.document.path
      clearPendingTextSaveByPath(tabPath)

      if (isTextFileDocument(tab.document)) {
        if (tab.document.source === tab.latestSavedSource) {
          return true
        }

        return persistTextDocumentSource(tabPath, tab.document.source)
      }

      if (tab.document.viewKind === 'inkdoc' && tab.document.source !== tab.latestSavedSource) {
        const result = await writeLibraryFileContent(tabPath, tab.document.source)
        if (result.ok) {
          bumpGraphRevisionIfVisible()
          return true
        }

        setDialogState((current) => {
          if (current) {
            return current
          }

          return {
            type: 'info',
            title: 'No se pudo guardar',
            message: result.error ?? 'No se pudo guardar el archivo Inkdoc.',
          }
        })
        return false
      }

      return true
    },
    [bumpGraphRevisionIfVisible, clearPendingTextSaveByPath, persistTextDocumentSource],
  )

  const closeTabByPath = useCallback(async (tabPath: string) => {
    if (tabPath === GRAPH_WORKSPACE_TAB_PATH || tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH) {
      const currentSpecialTabs = openWorkspaceSpecialTabsRef.current
      if ((tabPath === GRAPH_WORKSPACE_TAB_PATH && !currentSpecialTabs.graph) || (tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH && !currentSpecialTabs.taskManager)) {
        return
      }

      const currentTabs = buildWorkspaceTitleTabs(openTabsRef.current, currentSpecialTabs)
      const closingIndex = currentTabs.findIndex((tab) => tab.path === tabPath)
      if (closingIndex < 0) {
        return
      }

      const nextSpecialTabs: OpenWorkspaceSpecialTabs = {
        graph: tabPath === GRAPH_WORKSPACE_TAB_PATH ? false : currentSpecialTabs.graph,
        taskManager: tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH ? false : currentSpecialTabs.taskManager,
      }
      const remainingTabs = buildWorkspaceTitleTabs(openTabsRef.current, nextSpecialTabs)
      const currentActiveTabPath = activeTabPathRef.current
      let nextActiveTabPath = currentActiveTabPath

      if (currentActiveTabPath === tabPath) {
        if (remainingTabs.length === 0) {
          nextActiveTabPath = null
        } else {
          const fallbackIndex = closingIndex > 0 ? closingIndex - 1 : 0
          const safeFallbackIndex = Math.min(fallbackIndex, remainingTabs.length - 1)
          nextActiveTabPath = remainingTabs[safeFallbackIndex].path
        }
      }

      if (nextActiveTabPath && !remainingTabs.some((tab) => tab.path === nextActiveTabPath)) {
        nextActiveTabPath = remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].path : null
      }

      setOpenWorkspaceSpecialTabs(nextSpecialTabs)
      setActiveTabPath(nextActiveTabPath)
      return
    }

    const tabToClose = openTabsRef.current.find((tab) => tab.document.path === tabPath)
    if (!tabToClose) {
      return
    }

    const canClose = await persistOpenTabBeforeClose(tabToClose)
    if (!canClose) {
      return
    }

    const currentTabs = openTabsRef.current
    const closingIndex = currentTabs.findIndex((tab) => tab.document.path === tabPath)
    if (closingIndex < 0) {
      return
    }

    const remainingDocumentTabs = currentTabs.filter((tab) => tab.document.path !== tabPath)
    const workspaceTabsBeforeClose = buildWorkspaceTitleTabs(currentTabs, openWorkspaceSpecialTabsRef.current)
    const workspaceTabsAfterClose = buildWorkspaceTitleTabs(remainingDocumentTabs, openWorkspaceSpecialTabsRef.current)
    const currentActiveTabPath = activeTabPathRef.current
    let nextActiveTabPath = currentActiveTabPath

    if (currentActiveTabPath === tabPath) {
      if (workspaceTabsAfterClose.length === 0) {
        nextActiveTabPath = null
      } else {
        const workspaceClosingIndex = workspaceTabsBeforeClose.findIndex((tab) => tab.path === tabPath)
        const fallbackIndex = workspaceClosingIndex > 0 ? workspaceClosingIndex - 1 : 0
        const safeFallbackIndex = Math.min(fallbackIndex, workspaceTabsAfterClose.length - 1)
        nextActiveTabPath = workspaceTabsAfterClose[safeFallbackIndex].path
      }
    }

    if (nextActiveTabPath && !workspaceTabsAfterClose.some((tab) => tab.path === nextActiveTabPath)) {
      nextActiveTabPath = workspaceTabsAfterClose.length > 0 ? workspaceTabsAfterClose[workspaceTabsAfterClose.length - 1].path : null
    }

    setOpenTabs(remainingDocumentTabs)
    setActiveTabPath(nextActiveTabPath)
  }, [persistOpenTabBeforeClose])

  const handleCloseTab = useCallback((tabPath: string) => {
    void closeTabByPath(tabPath)
  }, [closeTabByPath])

  const handleCloseActiveTab = useCallback(() => {
    const currentActiveTabPath = activeTabPathRef.current
    if (!currentActiveTabPath) {
      return
    }

    void closeTabByPath(currentActiveTabPath)
  }, [closeTabByPath])

  const handleCycleToNextTab = useCallback(() => {
    const currentTabs = buildWorkspaceTitleTabs(openTabsRef.current, openWorkspaceSpecialTabsRef.current)
    if (currentTabs.length <= 1) {
      return
    }

    const currentActiveTabPath = activeTabPathRef.current
    const activeIndex = currentTabs.findIndex((tab) => tab.path === currentActiveTabPath)
    const nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % currentTabs.length
    setActiveTabPath(currentTabs[nextIndex].path)
  }, [])

  const closeTabsByPath = useCallback((path: string) => {
    const currentTabs = openTabsRef.current
    const remainingDocumentTabs = currentTabs.filter((tab) => !isSameOrNestedPath(path, tab.document.path))
    if (remainingDocumentTabs.length === currentTabs.length) {
      return
    }

    for (const tab of currentTabs) {
      if (isSameOrNestedPath(path, tab.document.path)) {
        clearPendingTextSaveByPath(tab.document.path)
      }
    }

    const workspaceTabsAfterClose = buildWorkspaceTitleTabs(remainingDocumentTabs, openWorkspaceSpecialTabsRef.current)
    const currentActiveTabPath = activeTabPathRef.current
    const nextActiveTabPath =
      currentActiveTabPath && workspaceTabsAfterClose.some((tab) => tab.path === currentActiveTabPath)
        ? currentActiveTabPath
        : workspaceTabsAfterClose.length > 0
          ? workspaceTabsAfterClose[workspaceTabsAfterClose.length - 1].path
          : null

    setOpenTabs(remainingDocumentTabs)
    setActiveTabPath(nextActiveTabPath)
  }, [clearPendingTextSaveByPath])

  const renameOpenTabPath = useCallback((path: string, nextPath: string, name: string) => {
    clearPendingTextSaveByPath(path)
    setOpenTabs((current) =>
      current.map((tab) => {
        if (tab.document.path !== path) {
          return tab
        }

        return {
          ...tab,
          document: {
            ...tab.document,
            path: nextPath,
            name,
            extension: getFileExtension(name),
          },
        }
      }),
    )
    setActiveTabPath((current) => (current === path ? nextPath : current))
  }, [clearPendingTextSaveByPath])

  const openDocumentInTab = useCallback((document: OpenFileDocument, latestSavedSource: string) => {
    const existingTab = openTabsRef.current.find((tab) => tab.document.path === document.path)
    if (existingTab) {
      setActiveTabPath(document.path)
      return
    }

    setOpenTabs((current) => [...current, { document, latestSavedSource, saveStatus: 'idle' }])
    setActiveTabPath(document.path)
  }, [])

  useEffect(() => {
    const handleTabShortcuts = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey) {
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        handleCycleToNextTab()
        return
      }

      if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        handleCloseActiveTab()
      }
    }

    window.addEventListener('keydown', handleTabShortcuts)
    return () => {
      window.removeEventListener('keydown', handleTabShortcuts)
    }
  }, [handleCloseActiveTab, handleCycleToNextTab])

  useEffect(() => {
    if (!activeLibrary?.path || !shouldRefreshVisibleExplorerTree) {
      return
    }

    if (!hasDeferredTreeRefreshRef.current) {
      return
    }

    hasDeferredTreeRefreshRef.current = false
    void refreshActiveLibraryTree()
  }, [activeLibrary?.path, refreshActiveLibraryTree, shouldRefreshVisibleExplorerTree])

  useEffect(() => {
    if (!activeLibrary?.path || !shouldRefreshVisibleExplorerTree) {
      return
    }

    void probeActiveLibraryTreeChanges()
  }, [activeLibrary?.path, probeActiveLibraryTreeChanges, shouldRefreshVisibleExplorerTree])

  useEffect(() => {
    const handleLibraryTreeChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ vaultPath?: string; pathHint?: string }>
      const changedVaultPath = normalizePath(customEvent.detail?.vaultPath ?? '')
      const changedPathHint = normalizePath(customEvent.detail?.pathHint ?? '')
      const currentActiveLibraryPath = normalizePath(activeLibrary?.path ?? '')
      if (!currentActiveLibraryPath) {
        return
      }

      const matchesCurrentLibrary = changedVaultPath
        ? changedVaultPath === currentActiveLibraryPath
        : changedPathHint
          ? isSameOrNestedPath(currentActiveLibraryPath, changedPathHint)
          : true
      if (!matchesCurrentLibrary) {
        return
      }

      if (libraryTreeRefreshTimerRef.current !== null) {
        window.clearTimeout(libraryTreeRefreshTimerRef.current)
      }

      libraryTreeRefreshTimerRef.current = window.setTimeout(() => {
        libraryTreeRefreshTimerRef.current = null
        if (!shouldRefreshVisibleExplorerTree) {
          hasDeferredTreeRefreshRef.current = true
          bumpGraphRevisionIfVisible()
          return
        }

        hasDeferredTreeRefreshRef.current = false
        void refreshActiveLibraryTree()
        bumpGraphRevisionIfVisible()
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
  }, [activeLibrary?.path, bumpGraphRevisionIfVisible, refreshActiveLibraryTree, shouldRefreshVisibleExplorerTree])

  useEffect(() => {
    if (!activeLibrary?.path || !shouldRefreshVisibleExplorerTree) {
      return
    }

    if (explorerRefreshIntervalMs <= 0) {
      return
    }

    if (isAndroidRuntime && explorerRefreshIntervalMs < 5000) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return
      }

      void probeActiveLibraryTreeChanges()
    }, explorerRefreshIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [
    activeLibrary?.path,
    explorerRefreshIntervalMs,
    isAndroidRuntime,
    probeActiveLibraryTreeChanges,
    shouldRefreshVisibleExplorerTree,
  ])

  const handleOpenFile = useCallback(async (filePath: string) => {
    const existingTab = openTabsRef.current.find((tab) => tab.document.path === filePath)
    if (existingTab) {
      setActiveTabPath(filePath)
      return
    }

    const extension = getFileExtension(filePath)
    const viewKind = resolveFileViewKind(extension)

    setContextMenu(null)
    setPendingCreation(null)
    setRenamingPath(null)

    if (isTextualViewKind(viewKind) || viewKind === 'inkdoc') {
      const result = await readLibraryFileContent(filePath)
      if (!result.ok) {
        setDialogState({
          type: 'info',
          title: 'No se pudo abrir el archivo',
          message: result.error ?? 'No se pudo leer el contenido del archivo.',
        })
        return
      }

      const name = filePath.split(/[\\/]/).pop() ?? filePath
      const nextDocument: OpenFileDocument = {
        path: filePath,
        name,
        extension,
        viewKind,
        source: result.content,
      }

      openDocumentInTab(nextDocument, result.content)
      return
    }

    const name = filePath.split(/[\\/]/).pop() ?? filePath
    openDocumentInTab(
      {
        path: filePath,
        name,
        extension,
        viewKind,
        imageUrl: toFileUrl(filePath),
      },
      '',
    )
  }, [openDocumentInTab])

  const handleTextDocumentChange = useCallback((nextSource: string) => {
    const targetPath = activeTabPathRef.current
    if (!targetPath) {
      return
    }

    setOpenTabs((current) =>
      current.map((tab) => {
        if (tab.document.path !== targetPath || !isTextFileDocument(tab.document)) {
          return tab
        }

        if (tab.document.source === nextSource) {
          return tab
        }

        return {
          ...tab,
          saveStatus: nextSource === tab.latestSavedSource ? 'idle' : 'saving',
          document: {
            ...tab.document,
            source: nextSource,
          },
        }
      }),
    )
  }, [])

  const handleInkdocDocumentPersist = useCallback(
    async (nextSource: string): Promise<void> => {
      const targetPath = activeTabPathRef.current
      if (!targetPath) {
        return
      }

      setOpenTabs((current) =>
        current.map((tab) => {
          if (tab.document.path !== targetPath || tab.document.viewKind !== 'inkdoc') {
            return tab
          }

          return {
            ...tab,
            document: {
              ...tab.document,
              source: nextSource,
            },
          }
        }),
      )

      const result = await writeLibraryFileContent(targetPath, nextSource)
      if (!result.ok) {
        throw new Error(result.error ?? 'No se pudo guardar el archivo Inkdoc.')
      }

      setOpenTabs((current) =>
        current.map((tab) =>
          tab.document.path === targetPath ? { ...tab, latestSavedSource: nextSource, saveStatus: 'idle' } : tab,
        ),
      )
      bumpGraphRevisionIfVisible()
    },
    [bumpGraphRevisionIfVisible],
  )

  const handleSubmitPendingCreation = useCallback(async (name: string) => {
    if (!activeLibrary || !pendingCreation) {
      setPendingCreation(null)
      return
    }

    const result = await createLibraryEntry(
      pendingCreation.parentPath,
      name,
      pendingCreation.kind,
      { androidDirectoryUri: activeLibrary.androidTreeUri },
    )
    if (!result.ok) {
      setDialogState({
        type: 'info',
        title: 'No se pudo crear',
        message: result.error ?? 'No se pudo crear el elemento.',
      })
      return
    }

    setPendingCreation(null)
    await refreshActiveLibraryTree()
  }, [activeLibrary, pendingCreation, refreshActiveLibraryTree])

  const handleCancelPendingCreation = useCallback(() => {
    setPendingCreation(null)
  }, [])

  const handleNodeContextMenu = useCallback((node: NotiaFileNode, position: { x: number; y: number }) => {
    setPendingCreation(null)
    setContextMenu({ type: 'node', x: position.x, y: position.y, node })
  }, [])

  const handleEmptyContextMenu = useCallback((position: { x: number; y: number }) => {
    setPendingCreation(null)
    setRenamingPath(null)
    setContextMenu({ type: 'empty', x: position.x, y: position.y })
  }, [])

  const handleRenameSubmit = useCallback(async (path: string, name: string) => {
    const result = await performLibraryEntryOperation({ action: 'rename', targetPath: path, newName: name })
    if (!result.ok) {
      setDialogState({
        type: 'info',
        title: 'No se pudo renombrar',
        message: result.error ?? 'No se pudo renombrar el elemento.',
      })
      return
    }

    const hasAnyOpenTabInPath = openTabsRef.current.some((tab) => isSameOrNestedPath(path, tab.document.path))
    if (hasAnyOpenTabInPath) {
      const hasExactOpenTab = openTabsRef.current.some((tab) => tab.document.path === path)
      if (hasExactOpenTab) {
        const nextPath = joinParentPath(getParentDirectory(path), path, name)
        renameOpenTabPath(path, nextPath, name)
      } else {
        closeTabsByPath(path)
      }
    }

    setRenamingPath(null)
    await refreshActiveLibraryTree()
  }, [closeTabsByPath, refreshActiveLibraryTree, renameOpenTabPath])

  const handleContextMenuAction = async (actionId: string) => {
    if (!activeLibrary || !contextMenu) {
      setContextMenu(null)
      return
    }

    if (actionId === 'new-folder-root') {
      setPendingCreation({
        id: `pending-folder-${Date.now()}`,
        kind: 'folder',
        initialName: 'Nueva carpeta',
        parentPath: activeLibrary.path,
      })
      setContextMenu(null)
      return
    }

    if (actionId === 'new-note-root') {
      setPendingCreation({
        id: `pending-note-${Date.now()}`,
        kind: 'note',
        initialName: 'Nueva nota',
        parentPath: activeLibrary.path,
      })
      setContextMenu(null)
      return
    }

    if (actionId === 'new-inkdoc-root') {
      setPendingCreation({
        id: `pending-inkdoc-${Date.now()}`,
        kind: 'inkdoc',
        initialName: 'Nuevo inkdoc',
        parentPath: activeLibrary.path,
      })
      setContextMenu(null)
      return
    }

    if (contextMenu.type !== 'node') {
      setContextMenu(null)
      return
    }

    const targetNode = contextMenu.node
    const targetPath = targetNode.path
    if (!targetPath) {
      setContextMenu(null)
      return
    }

    const targetDirectory = targetNode.type === 'folder' ? targetPath : getParentDirectory(targetPath)

    if (actionId === 'copy') {
      setClipboardEntry({ path: targetPath, mode: 'copy' })
      setContextMenu(null)
      return
    }

    if (actionId === 'copy-system-path') {
      try {
        await navigator.clipboard.writeText(targetPath)
      } catch {
        setDialogState({
          type: 'info',
          title: 'No se pudo copiar',
          message: 'No se pudo copiar el path al portapapeles.',
        })
      }
      setContextMenu(null)
      return
    }

    if (actionId === 'move') {
      setClipboardEntry({ path: targetPath, mode: 'move' })
      setContextMenu(null)
      return
    }

    if (actionId === 'paste') {
      if (!clipboardEntry) {
        setContextMenu(null)
        return
      }

      const pasteResult = await performLibraryEntryOperation({
        action: 'paste',
        sourcePath: clipboardEntry.path,
        targetDirectoryPath: targetDirectory || activeLibrary.path,
        mode: clipboardEntry.mode,
      })
      if (!pasteResult.ok) {
        setDialogState({
          type: 'info',
          title: 'No se pudo pegar',
          message: pasteResult.error ?? 'No se pudo pegar el elemento.',
        })
      } else if (clipboardEntry.mode === 'move') {
        closeTabsByPath(clipboardEntry.path)
        setClipboardEntry(null)
      }

      setContextMenu(null)
      await refreshActiveLibraryTree()
      return
    }

    if (actionId === 'delete') {
      const shouldDelete = await confirm({
        title: 'Confirmar eliminacion',
        message: `Eliminar "${targetNode.name}"? Esta accion no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
        tone: 'danger',
      })

      if (!shouldDelete) {
        setContextMenu(null)
        return
      }

      const deleteResult = await performLibraryEntryOperation({
        action: 'delete',
        targetPath,
      })

      if (!deleteResult.ok) {
        setDialogState({
          type: 'info',
          title: 'No se pudo eliminar',
          message: deleteResult.error ?? 'No se pudo eliminar el elemento.',
        })
        setContextMenu(null)
        return
      }

      closeTabsByPath(targetPath)
      setContextMenu(null)
      await refreshActiveLibraryTree()
      return
    }

    if (actionId === 'rename') {
      setRenamingPath(targetPath)
      setContextMenu(null)
      return
    }

    if (actionId === 'new-subfolder' && targetNode.type === 'folder') {
      setTreeNodesForLibrary(activeLibraryId, (current) => setFolderExpandedByPath(current, targetPath, true))
      setPendingCreation({
        id: `pending-subfolder-${Date.now()}`,
        kind: 'folder',
        initialName: 'Nueva carpeta',
        parentPath: targetPath,
      })
      setContextMenu(null)
      return
    }

    if (actionId === 'new-note' && targetNode.type === 'folder') {
      setTreeNodesForLibrary(activeLibraryId, (current) => setFolderExpandedByPath(current, targetPath, true))
      setPendingCreation({
        id: `pending-note-${Date.now()}`,
        kind: 'note',
        initialName: 'Nueva nota',
        parentPath: targetPath,
      })
      setContextMenu(null)
      return
    }

    if (actionId === 'new-inkdoc' && targetNode.type === 'folder') {
      setTreeNodesForLibrary(activeLibraryId, (current) => setFolderExpandedByPath(current, targetPath, true))
      setPendingCreation({
        id: `pending-inkdoc-${Date.now()}`,
        kind: 'inkdoc',
        initialName: 'Nuevo inkdoc',
        parentPath: targetPath,
      })
      setContextMenu(null)
      return
    }

    setContextMenu(null)
  }

  const handleLibraryAdded = (library: NotiaLibrary) => {
    const existingLibrary = libraries.find((item) => item.path === library.path)
    if (existingLibrary) {
      if (!existingLibrary.androidTreeUri && library.androidTreeUri) {
        setLibraries((current) => current.map((item) => (
          item.id === existingLibrary.id
            ? { ...item, androidTreeUri: library.androidTreeUri }
            : item
        )))
      }
      setActiveLibraryId(existingLibrary.id)
      return
    }

    setLibraries((current) => [...current, library])
    setActiveLibraryId(library.id)
  }
  const handleLibraryRemoved = useCallback(async (library: NotiaLibrary) => {
    const shouldRemove = await confirm({
      title: 'Quitar libreria',
      message: `Quitar "${library.name}" de Notia? Esta accion no borra la carpeta en disco.`,
      confirmLabel: 'Quitar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })
    if (!shouldRemove) {
      return
    }

    closeTabsByPath(library.path)
    setLibraries((current) => current.filter((item) => item.id !== library.id))
  }, [closeTabsByPath, confirm])

  const libraryName = activeLibrary?.name ?? 'Sin librerias'
  const handleOpenFileFromView = useCallback((filePath: string) => {
    void handleOpenFile(filePath)
  }, [handleOpenFile])
  const handleMoveNode = useCallback((sourcePath: string, targetDirectoryPath: string) => {
    if (!activeLibrary) {
      return
    }

    const normalizedSourcePath = normalizePath(sourcePath)
    const normalizedTargetDirectoryPath = normalizePath(targetDirectoryPath)
    if (!normalizedSourcePath || !normalizedTargetDirectoryPath) {
      return
    }

    const sourceNode = findTreeNodeByPath(treeNodesRef.current, sourcePath)
    if (sourceNode?.type === 'folder' && isSameOrNestedPath(normalizedSourcePath, normalizedTargetDirectoryPath)) {
      return
    }

    if (normalizedSourcePath === normalizedTargetDirectoryPath) {
      return
    }

    const currentParentPath = normalizePath(getParentDirectory(normalizedSourcePath))
    if (currentParentPath === normalizedTargetDirectoryPath) {
      return
    }

    void (async () => {
      const moveResult = await performLibraryEntryOperation({
        action: 'paste',
        sourcePath: normalizedSourcePath,
        targetDirectoryPath: normalizedTargetDirectoryPath,
        mode: 'move',
      })

      if (!moveResult.ok) {
        setDialogState({
          type: 'info',
          title: 'No se pudo mover',
          message: moveResult.error ?? 'No se pudo mover el elemento.',
        })
        return
      }

      closeTabsByPath(normalizedSourcePath)
      await refreshActiveLibraryTree()
    })()
  }, [activeLibrary, closeTabsByPath, refreshActiveLibraryTree])
  const handleCancelRename = useCallback(() => {
    setRenamingPath(null)
  }, [])
  const handleOpenLibraryManager = useCallback(() => {
    setIsLibraryManagerOpen(true)
  }, [])
  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true)
  }, [])
  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false)
  }, [])
  const handleCloseLibraryManager = useCallback(() => {
    setIsLibraryManagerOpen(false)
  }, [])
  const contextMenuItems =
    contextMenu?.type === 'empty'
      ? [
          { id: 'new-folder-root', label: 'Crear carpeta nueva' },
          { id: 'new-note-root', label: 'Crear nota nueva' },
          { id: 'new-inkdoc-root', label: 'Crear inkdoc nuevo' },
        ]
      : contextMenu?.type === 'node'
        ? [
            { id: 'copy', label: 'Copiar' },
            ...(contextMenu.node.type === 'file'
              ? [{ id: 'copy-system-path', label: 'Copiar path del sistema' }]
              : []),
            { id: 'paste', label: 'Pegar', disabled: !clipboardEntry },
            { id: 'move', label: 'Mover' },
            { id: 'rename', label: 'Renombrar' },
            { id: 'delete', label: 'Eliminar', danger: true },
            ...(contextMenu.node.type === 'folder'
              ? [
                  { id: 'new-subfolder', label: 'Crear subcarpeta' },
                  { id: 'new-note', label: 'Crear nota' },
                  { id: 'new-inkdoc', label: 'Crear inkdoc' },
                ]
              : []),
          ]
        : []

  const handleDialogClose = useCallback(() => {
    setDialogState(null)
  }, [])

  return (
    <div className={`notia-app-shell ${theme === 'dark' ? 'notia-theme-dark' : 'notia-theme-light'}`}>
      <WindowTitleBar
        tabs={titleBarTabs}
        activeTabPath={activeTabPath}
        tabIcon={TAB_ICON}
        onActivateTab={handleActivateTab}
        onCloseTab={handleCloseTab}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={handleSidebarToggle}
        explorerActions={EXPLORER_HEADER_ACTIONS}
        explorerTools={TOP_TOOLBAR_ACTIONS}
        activeExplorerActionId={activeHeaderAction}
        isSearchMenuOpen={isSearchMenuOpen}
        searchQuery={searchQuery}
        searchResultCount={searchMatchedPathSet.size}
        isSearchLoading={isSearchLoading}
        onExplorerActionClick={handleHeaderActionClick}
        onExplorerToolClick={handleExplorerToolClick}
        onSearchQueryChange={setSearchQuery}
        onSearchMenuClose={handleCloseSearchMenu}
        rightActions={titlebarRightActions}
        theme={theme}
        onToggleTheme={handleThemeToggle}
        onWindowAction={handleWindowAction}
      />
      <div className="notia-workspace">
        <aside className={`notia-sidebar ${isSidebarOpen ? 'notia-sidebar--open' : 'notia-sidebar--closed'}`}>
          <div className="notia-primary-rail">
            <IconRail
              actions={LEFT_RAIL_ACTIONS}
              activeActionId={
                activeWorkspaceView === 'graph'
                  ? 'graph-view'
                  : activeWorkspaceView === 'task-manager'
                    ? 'task-manager'
                    : null
              }
              onActionClick={handleRailActionClick}
            />
          </div>
          {isSidebarOpen ? (
            <div className="notia-panel">
              <div className="notia-files-pane">
                <FileTree
                  nodes={displayedTreeNodes}
                  rootPath={activeLibrary?.path ?? null}
                  isSearchActive={isSearchActive}
                  searchMatchedFilePaths={searchMatchedPathSet}
                  onToggleFolder={handleToggleFolder}
                  onOpenFile={handleOpenFileFromView}
                  pendingCreation={pendingCreation}
                  onSubmitPendingCreation={handleSubmitPendingCreation}
                  onCancelPendingCreation={handleCancelPendingCreation}
                  renamingPath={renamingPath}
                  onSubmitRename={handleRenameSubmit}
                  onCancelRename={handleCancelRename}
                  onNodeContextMenu={handleNodeContextMenu}
                  onEmptyContextMenu={handleEmptyContextMenu}
                  onMoveNode={handleMoveNode}
                />
                <WorkspaceFooter
                  name={libraryName}
                  icon={Bot}
                  libraries={libraries}
                  activeLibraryId={activeLibraryId}
                  onSelectLibrary={handleSelectLibrary}
                  onOpenLibraryManager={handleOpenLibraryManager}
                  onOpenSettings={handleOpenSettings}
                />
              </div>
            </div>
          ) : null}
        </aside>
        {activeWorkspaceView === 'graph' ? (
          <GraphView
            graphModel={graphModel}
            graphSourcesByPath={graphSourcesByPath}
            libraryName={libraryName}
            isLoading={isGraphLoading}
            onOpenFile={handleOpenFileFromView}
          />
        ) : activeWorkspaceView === 'task-manager' ? (
          <TaskManagerApp
            embedded
            vaultPath={activeLibrary?.path ?? null}
            onOpenTaskFile={handleOpenFile}
          />
        ) : (
          <MainView
            activeDocument={activeDocument}
            saveStatus={saveStatus}
            onTextDocumentChange={handleTextDocumentChange}
            onInkdocDocumentPersist={handleInkdocDocumentPersist}
            rootPath={activeLibrary?.path ?? null}
            libraryFilePaths={libraryFilePaths}
            inkdocPreferences={inkdocPreferences}
            markdownWikiLinkTargets={markdownWikiLinkTargets}
            onOpenLinkedFile={handleOpenFileFromView}
          />
        )}
      </div>
      <SettingsModal
        open={isSettingsOpen}
        onClose={handleCloseSettings}
        explorerRefreshIntervalMs={explorerRefreshIntervalMs}
        onExplorerRefreshIntervalMsChange={setExplorerRefreshIntervalMs}
        inkdocPreferences={inkdocPreferences}
        onInkdocPreferencesChange={setInkdocPreferences}
      />
      <LibraryManagerModal
        open={isLibraryManagerOpen}
        libraries={libraries}
        activeLibraryId={activeLibraryId}
        onLibraryAdded={handleLibraryAdded}
        onLibraryRemoved={handleLibraryRemoved}
        onClose={handleCloseLibraryManager}
      />
      <FileTreeContextMenu
        open={Boolean(contextMenu)}
        position={{ x: contextMenu?.x ?? 0, y: contextMenu?.y ?? 0 }}
        items={contextMenuItems}
        onAction={(id) => {
          void handleContextMenuAction(id)
        }}
      />
      <AppDialogModal
        open={Boolean(dialogState)}
        title={dialogState?.title ?? ''}
        message={dialogState?.message ?? ''}
        confirmLabel="Aceptar"
        onConfirm={() => {
          setDialogState(null)
        }}
        onClose={handleDialogClose}
      />
    </div>
  )
}
