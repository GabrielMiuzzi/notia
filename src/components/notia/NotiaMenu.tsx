import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { Bot } from 'lucide-react'
import {
  EXPLORER_HEADER_ACTIONS,
  LEFT_RAIL_ACTIONS,
  TAB_ICON,
  TITLEBAR_RIGHT_ACTIONS,
  TOP_TOOLBAR_ACTIONS,
} from '../../constants/notiaMenu'
import {
  createLibraryEntry,
  performLibraryEntryOperation,
  readLibraryTree,
  readLibraryTreeSignature,
} from '../../services/libraries/libraryRuntime'
import { dispatchLibraryTreeChanged } from '../../services/libraries/libraryTreeEvents'
import {
  invalidateLibrarySearchGraphIndex,
  searchIndexedLibraryFiles,
} from '../../services/libraries/librarySearchGraphIndex'
import {
  startDesktopLibraryTreeWatch,
  stopDesktopLibraryTreeWatch,
  subscribeToDesktopLibraryTreeWatchBridge,
} from '../../services/libraries/libraryTreeWatchRuntime'
import {
  readLibraryFileContent,
  writeLibraryFileContent,
} from '../../services/libraries/libraryDocumentRuntime'
import { controlWindow } from '../../services/window/windowRuntime'
import { applySearchMatchesToTree } from '../../engines/tree/applySearchMatchesToTree'
import { isTextualViewKind, resolveFileViewKind } from '../../services/views/fileViewResolver'
import { buildWikiLinkTargets } from '../../engines/markdown/wikiLinkEngine'
import { loadThemePreference, saveThemePreference, type NotiaTheme } from '../../services/preferences/themeStorage'
import {
  loadExplorerFolderExpandedState,
  loadExplorerRefreshIntervalMs,
  saveExplorerFolderExpandedState,
} from '../../services/preferences/explorerPanelStorage'
import { loadInkdocPreferences } from '../../services/preferences/inkdocSettingsStorage'
import { loadAiPreferences } from '../../services/preferences/aiSettingsStorage'
import { useConfirmationEngine } from '../../context/confirmation/useConfirmationEngine'
import type { NotiaFileNode, NotiaLibrary } from '../../types/notia'
import type { ColdPassEntry } from '../../types/coldpass'
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
import { TaskManagerApp, type TaskManagerChatContext } from '../../modules/task-manager/components/TaskManagerApp'
import { ColdPassView } from './views/ColdPassView'
import { ChatWorkspaceView } from './views/chat/ChatWorkspaceView'
import { ColdPassPasskeyModal } from './ColdPassPasskeyModal'
import { ColdPassCredentialModal } from './ColdPassCredentialModal'
import { pathExists, pickFile } from '../../services/files/filesystemEngine'
import {
  resolveColdPassPaths,
  saveColdPassEntries,
  unlockColdPassSession,
  type ColdPassSessionData,
} from '../../services/coldpass/coldpassStorage'
import { importColdPassEntriesFromCsvFile, type ColdPassCsvImportResult } from '../../services/coldpass/coldpassCsvImport'
import type { DrawioDocumentController } from '../../modules/drawio/types'
import { ensureChatLibraryStructure } from '../../services/chat/chatLibraryStructure'
import { toStoredLibraryPath } from '../../services/libraries/libraryPathMapping'
import { startPerformanceMeasurement } from '../../services/runtime/performanceBaseline'
import { useGraphWorkspace } from './hooks/useGraphWorkspace'
import { useLibraryConfigSync } from './hooks/useLibraryConfigSync'
import { useRightPanelChatContext } from './hooks/useRightPanelChatContext'
import { useLibrarySession } from './hooks/useLibrarySession'

const MARKDOWN_AUTOSAVE_DEBOUNCE_MS = 1200
const TEXT_AUTOSAVE_DEBOUNCE_MS = 380
const EMPTY_COLDPASS_ENTRIES: ColdPassEntry[] = []

interface PendingTextSaveJob {
  source: string
  timeoutId: number
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

function stripFileExtension(value: string): string {
  const lastDotIndex = value.lastIndexOf('.')
  if (lastDotIndex <= 0) {
    return value
  }
  return value.slice(0, lastDotIndex)
}

function collectFilesFromTree(nodes: NotiaFileNode[]): string[] {
  const paths: string[] = []

  const visit = (currentNodes: NotiaFileNode[]) => {
    for (const node of currentNodes) {
      if (node.type === 'file' && node.path) {
        paths.push(node.path)
      }

      if (node.children && node.children.length > 0) {
        visit(node.children)
      }
    }
  }

  visit(nodes)
  return paths
}

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

function collectNestedChatHistoryFiles(nodes: NotiaFileNode[], remainingSegments: string[]): string[] {
  if (remainingSegments.length === 0) {
    return collectFilesFromTree(nodes)
  }

  const [nextSegment, ...restSegments] = remainingSegments
  const matchingFolder = nodes.find((node) => (
    node.type === 'folder' && node.name.trim().toLowerCase() === nextSegment
  ))

  if (!matchingFolder?.children) {
    return []
  }

  return collectNestedChatHistoryFiles(matchingFolder.children, restSegments)
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
  chat: boolean
  taskManager: boolean
  coldPass: boolean
}

const GRAPH_WORKSPACE_TAB_PATH = '__workspace_graph__'
const CHAT_WORKSPACE_TAB_PATH = '__workspace_chat__'
const TASK_MANAGER_WORKSPACE_TAB_PATH = '__workspace_task_manager__'
const COLDPASS_WORKSPACE_TAB_PATH = '__workspace_coldpass__'

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

  if (specialTabs.chat) {
    tabs.push({ path: CHAT_WORKSPACE_TAB_PATH, title: 'Chat' })
  }

  if (specialTabs.taskManager) {
    tabs.push({ path: TASK_MANAGER_WORKSPACE_TAB_PATH, title: 'Task manager' })
  }

  if (specialTabs.coldPass) {
    tabs.push({ path: COLDPASS_WORKSPACE_TAB_PATH, title: 'ColdPass' })
  }

  return tabs
}

function isOpenTextDocumentTab(tab: OpenDocumentTab | null): tab is OpenTextDocumentTab {
  return Boolean(tab && isTextFileDocument(tab.document))
}

export function NotiaMenu() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isRightChatPanelOpen, setIsRightChatPanelOpen] = useState(false)
  const [libraryIndexRevision, setLibraryIndexRevision] = useState(0)
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
  const [aiPreferences, setAiPreferences] = useState(() => loadAiPreferences())
  const [treeNodes, setTreeNodes] = useState<NotiaFileNode[]>([])
  const [openTabs, setOpenTabs] = useState<OpenDocumentTab[]>([])
  const [openWorkspaceSpecialTabs, setOpenWorkspaceSpecialTabs] = useState<OpenWorkspaceSpecialTabs>({
    graph: false,
    chat: false,
    taskManager: false,
    coldPass: false,
  })
  const [taskManagerActivePanelId, setTaskManagerActivePanelId] = useState('default')
  const [taskManagerChatContext, setTaskManagerChatContext] = useState<TaskManagerChatContext | null>(null)
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
  const [coldPassSession, setColdPassSession] = useState<ColdPassSessionData | null>(null)
  const [coldPassPromptState, setColdPassPromptState] = useState<{
    open: boolean
    requiresConfirmation: boolean
    errorMessage: string | null
    isSubmitting: boolean
  }>({
    open: false,
    requiresConfirmation: false,
    errorMessage: null,
    isSubmitting: false,
  })
  const [coldPassCredentialModalState, setColdPassCredentialModalState] = useState<{
    open: boolean
    mode: 'create' | 'edit'
    editingIndex: number | null
    errorMessage: string | null
    isSubmitting: boolean
  }>({
    open: false,
    mode: 'create',
    editingIndex: null,
    errorMessage: null,
    isSubmitting: false,
  })
  const [coldPassDeletePromptState, setColdPassDeletePromptState] = useState<{
    open: boolean
    deletingIndex: number | null
    errorMessage: string | null
    isSubmitting: boolean
  }>({
    open: false,
    deletingIndex: null,
    errorMessage: null,
    isSubmitting: false,
  })
  const [coldPassImportPromptState, setColdPassImportPromptState] = useState<{
    open: boolean
    pendingImport: ColdPassCsvImportResult | null
    errorMessage: string | null
    isSubmitting: boolean
    isSelectingFile: boolean
  }>({
    open: false,
    pendingImport: null,
    errorMessage: null,
    isSubmitting: false,
    isSelectingFile: false,
  })
  const { confirm } = useConfirmationEngine()
  const runtimeDevice = useMemo(() => getRuntimeDevice(), [])
  const isAndroidRuntime = runtimeDevice === 'Android'
  const titlebarRightActions = useMemo(
    () => (isAndroidRuntime ? [] : TITLEBAR_RIGHT_ACTIONS),
    [isAndroidRuntime],
  )
  const {
    activeLibrary,
    activeLibraryId,
    libraries,
    resolveActiveLibraryAndroidDirectoryUri,
    setActiveLibraryId,
    setLibraries,
  } = useLibrarySession()

  const activeTabPathRef = useRef<string | null>(null)
  const openTabsRef = useRef<OpenDocumentTab[]>([])
  const openingDocumentPathsRef = useRef<Set<string>>(new Set())
  const openWorkspaceSpecialTabsRef = useRef<OpenWorkspaceSpecialTabs>({
    graph: false,
    chat: false,
    taskManager: false,
    coldPass: false,
  })
  const drawioControllersRef = useRef<Map<string, DrawioDocumentController>>(new Map())
  const treeNodesRef = useRef<NotiaFileNode[]>([])
  const pendingTextSaveByPathRef = useRef<Map<string, PendingTextSaveJob>>(new Map())
  const libraryTreeRefreshTimerRef = useRef<number | null>(null)
  const isTreeRefreshInFlightRef = useRef(false)
  const isTreeSignatureProbeInFlightRef = useRef(false)
  const hasQueuedTreeRefreshRef = useRef(false)
  const hasDeferredTreeRefreshRef = useRef(false)
  const lastAutomaticTreeProbeAtRef = useRef(0)
  const lastKnownTreeSignatureRef = useRef('')
  const treeNodesLibraryIdRef = useRef<string | null>(null)
  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.document.path === activeTabPath) ?? null,
    [activeTabPath, openTabs],
  )
  const activeDocument = activeTab?.document ?? null
  const activeWorkspaceView = activeTabPath === GRAPH_WORKSPACE_TAB_PATH
    ? 'graph'
    : activeTabPath === CHAT_WORKSPACE_TAB_PATH
      ? 'chat'
    : activeTabPath === TASK_MANAGER_WORKSPACE_TAB_PATH
      ? 'task-manager'
      : activeTabPath === COLDPASS_WORKSPACE_TAB_PATH
        ? 'coldpass'
      : 'documents'
  const activeRailActionId = useMemo(() => (
    activeWorkspaceView === 'graph'
      ? 'graph-view'
      : activeWorkspaceView === 'chat'
        ? 'chat'
        : activeWorkspaceView === 'task-manager'
          ? 'task-manager'
          : activeWorkspaceView === 'coldpass'
            ? 'coldpass'
            : null
  ), [activeWorkspaceView])
  const [mountedHeavyWorkspaceView, setMountedHeavyWorkspaceView] = useState<typeof activeWorkspaceView>(activeWorkspaceView)
  const [isRightPanelChatMounted, setIsRightPanelChatMounted] = useState<boolean>(
    !isAndroidRuntime ? isRightChatPanelOpen : false,
  )
  const shouldRefreshVisibleExplorerTree =
    activeWorkspaceView !== 'task-manager' && (
      activeWorkspaceView === 'graph'
      || activeWorkspaceView === 'chat'
      || isRightChatPanelOpen
      || isSidebarOpen
    )
  const normalizedSearchQuery = searchQuery.trim()
  const isSearchActive = normalizedSearchQuery.length > 0
  const shouldRefreshActiveLibraryTree = shouldRefreshVisibleExplorerTree || isSearchActive
  const isMarkdownDocumentActive = activeDocument?.viewKind === 'markdown'
  const saveStatus = activeTab?.saveStatus ?? 'idle'
  const searchMatchedPathSet = useMemo(() => new Set(searchMatchedPaths), [searchMatchedPaths])
  const deferredSearchMatchedPaths = useDeferredValue(searchMatchedPaths)
  const deferredSearchMatchedPathSet = useMemo(
    () => new Set(deferredSearchMatchedPaths),
    [deferredSearchMatchedPaths],
  )
  const displayedTreeNodes = useMemo(
    () => applySearchMatchesToTree(treeNodes, deferredSearchMatchedPathSet, isSearchActive),
    [deferredSearchMatchedPathSet, isSearchActive, treeNodes],
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
    if (activeWorkspaceView !== 'documents') {
      return []
    }

    return collectFilesFromTree(treeNodes)
  }, [activeWorkspaceView, treeNodes])
  const previousChatFiles = useMemo(() => {
    const shouldPrepareChatHistory = activeWorkspaceView === 'chat' || isRightChatPanelOpen
    if (!activeLibrary?.path || !shouldPrepareChatHistory) {
      return []
    }

    return collectNestedChatHistoryFiles(treeNodes, ['chat', 'chats'])
      .map((filePath) => ({
        runtimePath: normalizePath(filePath),
        storedPath: normalizePath(toStoredLibraryPath(activeLibrary.path, filePath)),
      }))
      .filter(({ storedPath }) => (
        storedPath.toLowerCase().startsWith('chat/chats/')
        && storedPath.toLowerCase().endsWith('.md')
      ))
      .sort((left, right) => right.storedPath.localeCompare(left.storedPath, 'es'))
      .map((filePath) => {
        const relativeChatPath = filePath.storedPath.slice('chat/chats/'.length)
        return {
          id: filePath.storedPath,
          filePath: filePath.runtimePath,
          title: stripFileExtension(relativeChatPath),
        }
      })
  }, [activeLibrary?.path, activeWorkspaceView, isRightChatPanelOpen, treeNodes])
  const activeTaskManagerVault = useMemo(
    () => (activeLibrary
      ? {
          path: activeLibrary.path,
          androidTreeUri: activeLibrary.androidTreeUri,
        }
      : null),
    [activeLibrary?.androidTreeUri, activeLibrary?.path],
  )
  const coldPassEntries = coldPassSession?.entries ?? EMPTY_COLDPASS_ENTRIES
  const {
    graphChatContextSummary,
    graphChatEffectivePaths,
    graphChatSelectedPaths,
    graphModel,
    graphSourcesByPath,
    isGraphLoading,
    setGraphChatSelectedPaths,
  } = useGraphWorkspace({
    activeLibrary,
    activeWorkspaceView,
    graphRevision: libraryIndexRevision,
    treeNodes,
  })
  const {
    preferredContextMode: rightPanelPreferredContextMode,
    preferredContextName: rightPanelPreferredContextName,
    preferredContextPaths: rightPanelPreferredContextPaths,
    preferredContextScopeKey: rightPanelPreferredContextScopeKey,
    rightPanelChatContextKey,
    rightPanelChatContextLabel,
    transientContextMode: rightPanelTransientContextMode,
    transientContextPaths: rightPanelTransientContextPaths,
    transientContextSummary: rightPanelTransientContextSummary,
  } = useRightPanelChatContext({
    activeDocument,
    activeWorkspaceView,
    graphChatContextSummary,
    graphChatEffectivePaths,
    taskManagerActivePanelId,
    taskManagerChatContext,
  })
  const isHeavyWorkspaceView =
    activeWorkspaceView === 'graph'
    || activeWorkspaceView === 'chat'
    || activeWorkspaceView === 'task-manager'
  const shouldDeferHeavyWorkspaceMount =
    isAndroidRuntime
    && isHeavyWorkspaceView
    && mountedHeavyWorkspaceView !== activeWorkspaceView

  useEffect(() => {
    if (!isAndroidRuntime || !isHeavyWorkspaceView) {
      setMountedHeavyWorkspaceView(activeWorkspaceView)
      return
    }

    if (mountedHeavyWorkspaceView === activeWorkspaceView) {
      return
    }

    let frameId = 0
    let nestedFrameId = 0
    frameId = window.requestAnimationFrame(() => {
      nestedFrameId = window.requestAnimationFrame(() => {
        setMountedHeavyWorkspaceView(activeWorkspaceView)
      })
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      window.cancelAnimationFrame(nestedFrameId)
    }
  }, [activeWorkspaceView, isAndroidRuntime, isHeavyWorkspaceView, mountedHeavyWorkspaceView])

  useEffect(() => {
    if (!isAndroidRuntime) {
      setIsRightPanelChatMounted(isRightChatPanelOpen)
      return
    }

    if (!isRightChatPanelOpen) {
      setIsRightPanelChatMounted(false)
      return
    }

    let frameId = 0
    let nestedFrameId = 0
    frameId = window.requestAnimationFrame(() => {
      nestedFrameId = window.requestAnimationFrame(() => {
        setIsRightPanelChatMounted(true)
      })
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      window.cancelAnimationFrame(nestedFrameId)
    }
  }, [isAndroidRuntime, isRightChatPanelOpen])

  const resetTabs = useCallback(() => {
    drawioControllersRef.current.clear()
    setOpenTabs([])
    setOpenWorkspaceSpecialTabs({
      graph: false,
      chat: false,
      taskManager: false,
      coldPass: false,
    })
    setColdPassSession(null)
    setColdPassPromptState({
      open: false,
      requiresConfirmation: false,
      errorMessage: null,
      isSubmitting: false,
    })
    setColdPassCredentialModalState({
      open: false,
      mode: 'create',
      editingIndex: null,
      errorMessage: null,
      isSubmitting: false,
    })
    setColdPassDeletePromptState({
      open: false,
      deletingIndex: null,
      errorMessage: null,
      isSubmitting: false,
    })
    setColdPassImportPromptState({
      open: false,
      pendingImport: null,
      errorMessage: null,
      isSubmitting: false,
      isSelectingFile: false,
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

  const bumpLibraryIndexRevision = useCallback(() => {
    setLibraryIndexRevision((current) => current + 1)
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

      const result = await writeLibraryFileContent(targetPath, targetSource, {
        androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(targetPath),
      })
      const latestTab = openTabsRef.current.find((tab) => tab.document.path === targetPath)
      if (!latestTab || !isTextFileDocument(latestTab.document) || latestTab.document.source !== targetSource) {
        return true
      }

      if (result.ok) {
        if (activeLibrary?.path) {
          invalidateLibrarySearchGraphIndex(activeLibrary.path, targetPath)
        }
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
        bumpLibraryIndexRevision()
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
    [activeLibrary?.path, bumpLibraryIndexRevision, resolveActiveLibraryAndroidDirectoryUri],
  )

  useEffect(() => {
    saveThemePreference(theme)
  }, [theme])

  useLibraryConfigSync({
    activeLibrary,
    aiPreferences,
    explorerRefreshIntervalMs,
    inkdocPreferences,
    setAiPreferences,
    setExplorerRefreshIntervalMs,
    setInkdocPreferences,
  })

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

    const library = libraries.find((entry) => entry.id === libraryId) ?? null
    saveExplorerFolderExpandedState(library, collectFolderExpandedState(nodes))
  }, [libraries])

  const setTreeNodesForLibrary = useCallback((
    libraryId: string | null,
    update: SetStateAction<NotiaFileNode[]>,
  ) => {
    setTreeNodes((current) => {
      const next = resolveTreeNodeUpdate(current, update)
      if (current === next || areTreeNodeListsEqual(current, next)) {
        return current
      }

      treeNodesLibraryIdRef.current = libraryId
      persistExplorerFolderState(libraryId, next)
      return next
    })
  }, [persistExplorerFolderState])

  const commitTreeNodesSnapshot = useCallback((libraryId: string, nodes: NotiaFileNode[]) => {
    lastKnownTreeSignatureRef.current = buildTreeNodesStructureSignature(nodes)
    const library = libraries.find((entry) => entry.id === libraryId) ?? null
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
  }, [libraries, setTreeNodesForLibrary])

  const refreshActiveLibraryTree = useCallback(async () => {
    if (!activeLibrary) {
      return
    }

    if (isTreeRefreshInFlightRef.current) {
      hasQueuedTreeRefreshRef.current = true
      return
    }

    isTreeRefreshInFlightRef.current = true
    const refreshMeasurement = startPerformanceMeasurement('explorer.refresh_tree', {
      libraryId: activeLibrary.id,
      libraryPath: activeLibrary.path,
    })
    try {
      const refreshedNodes = await readLibraryTree(activeLibrary.path, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })
      commitTreeNodesSnapshot(activeLibrary.id, refreshedNodes)
      refreshMeasurement.success({
        nodeCount: countTreeNodes(refreshedNodes),
      })
    } catch (error) {
      refreshMeasurement.error(error)
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

  const requestAutomaticTreeProbe = useCallback(() => {
    if (!activeLibrary?.path || !shouldRefreshActiveLibraryTree) {
      return
    }

    if (isAndroidRuntime) {
      return
    }

    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return
    }

    const minimumIntervalMs = Math.max(1000, explorerRefreshIntervalMs)

    if (minimumIntervalMs <= 0) {
      return
    }

    const now = Date.now()
    if ((now - lastAutomaticTreeProbeAtRef.current) < minimumIntervalMs) {
      return
    }

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

  const handleChatWorkspaceTreeChanged = useCallback((pathHint?: string) => {
    notifyLibraryTreeChanged(pathHint ?? activeLibrary?.path)
  }, [activeLibrary?.path, notifyLibraryTreeChanged])

  useEffect(() => {
    if (!activeLibrary || normalizedSearchQuery.length === 0) {
      setSearchMatchedPaths([])
      setIsSearchLoading(false)
      return
    }

    if (treeNodesLibraryIdRef.current !== activeLibrary.id) {
      setSearchMatchedPaths([])
      setIsSearchLoading(false)
      return
    }

    let isCurrent = true
    setIsSearchLoading(true)

    const timeoutId = window.setTimeout(() => {
      void searchIndexedLibraryFiles({
        libraryPath: activeLibrary.path,
        treeNodes,
        query: normalizedSearchQuery,
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })
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
  }, [activeLibrary, normalizedSearchQuery, treeNodes, libraryIndexRevision])

  useEffect(() => {
    if (!activeLibrary) {
      clearAllPendingTextSaves()
      setTreeNodes([])
      treeNodesLibraryIdRef.current = null
      setPendingCreation(null)
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
      return
    }

    clearAllPendingTextSaves()
    lastKnownTreeSignatureRef.current = ''
    lastAutomaticTreeProbeAtRef.current = 0
    isTreeRefreshInFlightRef.current = false
    isTreeSignatureProbeInFlightRef.current = false
    hasQueuedTreeRefreshRef.current = false
    hasDeferredTreeRefreshRef.current = false

    let isCurrent = true
    const libraryLoadMeasurement = startPerformanceMeasurement('library.switch_load', {
      libraryId: activeLibrary.id,
      libraryPath: activeLibrary.path,
    })
    void (async () => {
      try {
        try {
          await ensureChatLibraryStructure(activeLibrary)
        } catch (error) {
          console.warn('[notia] could not ensure chat library structure', {
            libraryPath: activeLibrary.path,
            error,
          })
        }

        const nodes = await readLibraryTree(activeLibrary.path, {
          androidDirectoryUri: activeLibrary.androidTreeUri,
        })
        if (!isCurrent) {
          libraryLoadMeasurement.cancel()
          return
        }

        commitTreeNodesSnapshot(activeLibrary.id, nodes)
        libraryLoadMeasurement.success({
          nodeCount: countTreeNodes(nodes),
        })
      } catch (error) {
        if (!isCurrent) {
          libraryLoadMeasurement.cancel()
          return
        }
        libraryLoadMeasurement.error(error instanceof Error ? error : new Error(String(error)))
      }
    })()

    return () => {
      isCurrent = false
      libraryLoadMeasurement.cancel({
        stage: 'cleanup',
      })
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
    lastAutomaticTreeProbeAtRef.current = 0
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
    if (activeWorkspaceView !== 'coldpass' || !activeLibrary || coldPassSession?.filePath) {
      return
    }

    let cancelled = false

    const openColdPassPrompt = async () => {
      const { filePath } = resolveColdPassPaths(activeLibrary.path)
      const coldPassFileExists = await pathExists(filePath, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })
      if (cancelled) {
        return
      }

      setColdPassPromptState((current) => (
        current.open
          ? current
          : {
              open: true,
              requiresConfirmation: !coldPassFileExists,
              errorMessage: null,
              isSubmitting: false,
            }
      ))
    }

    void openColdPassPrompt()

    return () => {
      cancelled = true
    }
  }, [activeLibrary, activeWorkspaceView, coldPassSession?.filePath])

  useEffect(() => {
    setTreeNodesForLibrary(activeLibraryId, (current) => setSelectedFileByPath(current, activeTabPath))
  }, [activeLibraryId, activeTabPath, setTreeNodesForLibrary])

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-notia-prevent-menu-close]')) {
        return
      }
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

  const handleRightChatPanelToggle = useCallback(() => {
    setIsRightChatPanelOpen((current) => !current)
  }, [])

  useEffect(() => {
    if (activeWorkspaceView === 'chat') {
      setIsRightChatPanelOpen(false)
    }
  }, [activeWorkspaceView])

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

    if (actionId === 'chat') {
      setOpenWorkspaceSpecialTabs((current) => (
        current.chat
          ? current
          : {
              ...current,
              chat: true,
            }
      ))
      setActiveTabPath(CHAT_WORKSPACE_TAB_PATH)
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
      return
    }

    if (actionId === 'coldpass') {
      setOpenWorkspaceSpecialTabs((current) => (
        current.coldPass
          ? current
          : {
              ...current,
              coldPass: true,
            }
      ))
      setActiveTabPath(COLDPASS_WORKSPACE_TAB_PATH)
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
    if (
      tabPath === GRAPH_WORKSPACE_TAB_PATH
      || tabPath === CHAT_WORKSPACE_TAB_PATH
      || tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH
      || tabPath === COLDPASS_WORKSPACE_TAB_PATH
    ) {
      const specialTabs = openWorkspaceSpecialTabsRef.current
      if (
        (tabPath === GRAPH_WORKSPACE_TAB_PATH && !specialTabs.graph)
        || (tabPath === CHAT_WORKSPACE_TAB_PATH && !specialTabs.chat)
        || (tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH && !specialTabs.taskManager)
        || (tabPath === COLDPASS_WORKSPACE_TAB_PATH && !specialTabs.coldPass)
      ) {
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
        const result = await writeLibraryFileContent(tabPath, tab.document.source, {
          androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(tabPath),
        })
        if (result.ok) {
          if (activeLibrary?.path) {
            invalidateLibrarySearchGraphIndex(activeLibrary.path, tabPath)
          }
          bumpLibraryIndexRevision()
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

      if (tab.document.viewKind === 'drawio') {
        const controller = drawioControllersRef.current.get(tabPath)
        if (controller) {
          try {
            await controller.flush()
            return true
          } catch (error) {
            const message = error instanceof Error && error.message.trim()
              ? error.message
              : 'No se pudo guardar el archivo draw.io.'

            setOpenTabs((current) =>
              current.map((currentTab) => (
                currentTab.document.path === tabPath
                  ? { ...currentTab, saveStatus: 'error' }
                  : currentTab
              )),
            )
            setDialogState((current) => {
              if (current) {
                return current
              }

              return {
                type: 'info',
                title: 'No se pudo guardar',
                message,
              }
            })
            return false
          }
        }

        if (tab.document.source === tab.latestSavedSource) {
          return true
        }

        const result = await writeLibraryFileContent(tabPath, tab.document.source, {
          androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(tabPath),
        })
        if (result.ok) {
          if (activeLibrary?.path) {
            invalidateLibrarySearchGraphIndex(activeLibrary.path, tabPath)
          }
          bumpLibraryIndexRevision()
          return true
        }

        setDialogState((current) => {
          if (current) {
            return current
          }

          return {
            type: 'info',
            title: 'No se pudo guardar',
            message: result.error ?? 'No se pudo guardar el archivo draw.io.',
          }
        })
        return false
      }

      return true
    },
    [activeLibrary?.path, bumpLibraryIndexRevision, clearPendingTextSaveByPath, persistTextDocumentSource],
  )

  const closeTabByPath = useCallback(async (tabPath: string) => {
    if (
      tabPath === GRAPH_WORKSPACE_TAB_PATH
      || tabPath === CHAT_WORKSPACE_TAB_PATH
      || tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH
      || tabPath === COLDPASS_WORKSPACE_TAB_PATH
    ) {
      const currentSpecialTabs = openWorkspaceSpecialTabsRef.current
      if (
        (tabPath === GRAPH_WORKSPACE_TAB_PATH && !currentSpecialTabs.graph)
        || (tabPath === CHAT_WORKSPACE_TAB_PATH && !currentSpecialTabs.chat)
        || (tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH && !currentSpecialTabs.taskManager)
        || (tabPath === COLDPASS_WORKSPACE_TAB_PATH && !currentSpecialTabs.coldPass)
      ) {
        return
      }

      const currentTabs = buildWorkspaceTitleTabs(openTabsRef.current, currentSpecialTabs)
      const closingIndex = currentTabs.findIndex((tab) => tab.path === tabPath)
      if (closingIndex < 0) {
        return
      }

      const nextSpecialTabs: OpenWorkspaceSpecialTabs = {
        graph: tabPath === GRAPH_WORKSPACE_TAB_PATH ? false : currentSpecialTabs.graph,
        chat: tabPath === CHAT_WORKSPACE_TAB_PATH ? false : currentSpecialTabs.chat,
        taskManager: tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH ? false : currentSpecialTabs.taskManager,
        coldPass: tabPath === COLDPASS_WORKSPACE_TAB_PATH ? false : currentSpecialTabs.coldPass,
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
      if (tabPath === COLDPASS_WORKSPACE_TAB_PATH) {
        setColdPassSession(null)
        setColdPassPromptState({
          open: false,
          requiresConfirmation: false,
          errorMessage: null,
          isSubmitting: false,
        })
        setColdPassCredentialModalState({
          open: false,
          mode: 'create',
          editingIndex: null,
          errorMessage: null,
          isSubmitting: false,
        })
        setColdPassDeletePromptState({
          open: false,
          deletingIndex: null,
          errorMessage: null,
          isSubmitting: false,
        })
        setColdPassImportPromptState({
          open: false,
          pendingImport: null,
          errorMessage: null,
          isSubmitting: false,
          isSelectingFile: false,
        })
      }
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

  const handleSubmitColdPassPasskey = useCallback((passkey: string) => {
    if (!activeLibrary) {
      return
    }

    setColdPassPromptState({
      open: true,
      requiresConfirmation: coldPassPromptState.requiresConfirmation,
      errorMessage: null,
      isSubmitting: true,
    })

    void unlockColdPassSession(activeLibrary, passkey)
      .then((session) => {
        setColdPassSession(session)
        setColdPassPromptState({
          open: false,
          requiresConfirmation: false,
          errorMessage: null,
          isSubmitting: false,
        })
      })
      .catch((error) => {
        setColdPassSession(null)
        setColdPassPromptState({
          open: true,
          requiresConfirmation: coldPassPromptState.requiresConfirmation,
          errorMessage: error instanceof Error ? error.message : 'No se pudo desbloquear ColdPass.',
          isSubmitting: false,
        })
      })
  }, [activeLibrary, coldPassPromptState.requiresConfirmation])

  const handleCloseColdPassPrompt = useCallback(() => {
    setColdPassPromptState({
      open: false,
      requiresConfirmation: false,
      errorMessage: null,
      isSubmitting: false,
    })

    if (activeWorkspaceView === 'coldpass' && !coldPassSession) {
      void closeTabByPath(COLDPASS_WORKSPACE_TAB_PATH)
    }
  }, [activeWorkspaceView, closeTabByPath, coldPassSession])

  const handleOpenColdPassCredentialModal = useCallback(() => {
    if (!coldPassSession) {
      return
    }

    setColdPassCredentialModalState({
      open: true,
      mode: 'create',
      editingIndex: null,
      errorMessage: null,
      isSubmitting: false,
    })
  }, [coldPassSession])

  const handleEditColdPassCredential = useCallback((index: number) => {
    if (!coldPassSession || !coldPassSession.entries[index]) {
      return
    }

    setColdPassCredentialModalState({
      open: true,
      mode: 'edit',
      editingIndex: index,
      errorMessage: null,
      isSubmitting: false,
    })
  }, [coldPassSession])

  const handleCloseColdPassCredentialModal = useCallback(() => {
    setColdPassCredentialModalState({
      open: false,
      mode: 'create',
      editingIndex: null,
      errorMessage: null,
      isSubmitting: false,
    })
  }, [])

  const handleDeleteColdPassCredential = useCallback(async (index: number) => {
    if (!coldPassSession || !coldPassSession.entries[index]) {
      return
    }

    const entry = coldPassSession.entries[index]
    const shouldDelete = await confirm({
      title: 'Eliminar credencial',
      message: `Eliminar la credencial "${entry.name || entry.username || 'sin nombre'}"? Esta accion no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })

    if (!shouldDelete) {
      return
    }

    setColdPassDeletePromptState({
      open: true,
      deletingIndex: index,
      errorMessage: null,
      isSubmitting: false,
    })
  }, [coldPassSession, confirm])

  const handleImportColdPassVault = useCallback(() => {
    if (!coldPassSession) {
      return
    }

    setColdPassImportPromptState({
      open: false,
      pendingImport: null,
      errorMessage: null,
      isSubmitting: false,
      isSelectingFile: true,
    })

    void pickFile('Importar vault CSV', ['csv'])
      .then((selectedFile) => {
        if (!selectedFile) {
          setColdPassImportPromptState({
            open: false,
            pendingImport: null,
            errorMessage: null,
            isSubmitting: false,
            isSelectingFile: false,
          })
          return null
        }

        return importColdPassEntriesFromCsvFile(selectedFile.path)
      })
      .then((importResult) => {
        if (!importResult) {
          return
        }

        if (importResult.importedEntries.length === 0) {
          setColdPassImportPromptState({
            open: false,
            pendingImport: null,
            errorMessage: null,
            isSubmitting: false,
            isSelectingFile: false,
          })
          setDialogState({
            type: 'info',
            title: 'Sin credenciales para importar',
            message: 'El CSV seleccionado no contiene filas importables para ColdPass.',
          })
          return
        }

        setColdPassImportPromptState({
          open: true,
          pendingImport: importResult,
          errorMessage: null,
          isSubmitting: false,
          isSelectingFile: false,
        })
      })
      .catch((error) => {
        setColdPassImportPromptState({
          open: false,
          pendingImport: null,
          errorMessage: null,
          isSubmitting: false,
          isSelectingFile: false,
        })
        setDialogState({
          type: 'info',
          title: 'No se pudo importar el vault',
          message: error instanceof Error ? error.message : 'No se pudo validar el CSV seleccionado.',
        })
      })
  }, [coldPassSession])

  const handleSubmitColdPassCredential = useCallback((entry: ColdPassEntry) => {
    if (!coldPassSession) {
      return
    }

    const nextEntries = [...coldPassSession.entries]
    if (
      coldPassCredentialModalState.mode === 'edit'
      && coldPassCredentialModalState.editingIndex !== null
      && nextEntries[coldPassCredentialModalState.editingIndex]
    ) {
      const previousEntry = nextEntries[coldPassCredentialModalState.editingIndex]
      const nextPasswordHistory = [...previousEntry.passwordHistory]
      if (previousEntry.password && previousEntry.password !== entry.password) {
        nextPasswordHistory.unshift(previousEntry.password)
      }

      nextEntries[coldPassCredentialModalState.editingIndex] = {
        ...entry,
        id: previousEntry.id,
        passwordHistory: nextPasswordHistory,
      }
    } else {
      nextEntries.push({
        ...entry,
        id: entry.id || crypto.randomUUID(),
        passwordHistory: entry.passwordHistory ?? [],
      })
    }

    setColdPassCredentialModalState({
      open: true,
      mode: coldPassCredentialModalState.mode,
      editingIndex: coldPassCredentialModalState.editingIndex,
      errorMessage: null,
      isSubmitting: true,
    })

    void saveColdPassEntries(
      coldPassSession.filePath,
      coldPassSession.passkey,
      nextEntries,
      activeLibrary?.androidTreeUri,
    )
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error ?? 'No se pudo guardar la credencial.')
        }

        setColdPassSession({
          ...coldPassSession,
          entries: nextEntries,
          markdown: result.markdown,
        })
        setColdPassCredentialModalState({
          open: false,
          mode: 'create',
          editingIndex: null,
          errorMessage: null,
          isSubmitting: false,
        })
      })
      .catch((error) => {
        setColdPassCredentialModalState({
          open: true,
          mode: coldPassCredentialModalState.mode,
          editingIndex: coldPassCredentialModalState.editingIndex,
          errorMessage: error instanceof Error ? error.message : 'No se pudo guardar la credencial.',
          isSubmitting: false,
        })
      })
  }, [activeLibrary?.androidTreeUri, coldPassCredentialModalState.editingIndex, coldPassCredentialModalState.mode, coldPassSession])

  const handleCloseColdPassDeletePrompt = useCallback(() => {
    setColdPassDeletePromptState({
      open: false,
      deletingIndex: null,
      errorMessage: null,
      isSubmitting: false,
    })
  }, [])

  const handleCloseColdPassImportPrompt = useCallback(() => {
    setColdPassImportPromptState({
      open: false,
      pendingImport: null,
      errorMessage: null,
      isSubmitting: false,
      isSelectingFile: false,
    })
  }, [])

  const handleSubmitColdPassDeletePasskey = useCallback((passkey: string) => {
    if (
      !coldPassSession
      || coldPassDeletePromptState.deletingIndex === null
      || !coldPassSession.entries[coldPassDeletePromptState.deletingIndex]
    ) {
      return
    }

    if (passkey !== coldPassSession.passkey) {
      setColdPassDeletePromptState((current) => ({
        ...current,
        open: true,
        errorMessage: 'La passkey no coincide.',
        isSubmitting: false,
      }))
      return
    }

    const nextEntries = coldPassSession.entries.filter((_, index) => index !== coldPassDeletePromptState.deletingIndex)
    setColdPassDeletePromptState((current) => ({
      ...current,
      open: true,
      errorMessage: null,
      isSubmitting: true,
    }))

    void saveColdPassEntries(
      coldPassSession.filePath,
      coldPassSession.passkey,
      nextEntries,
      activeLibrary?.androidTreeUri,
    )
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error ?? 'No se pudo eliminar la credencial.')
        }

        setColdPassSession({
          ...coldPassSession,
          entries: nextEntries,
          markdown: result.markdown,
        })
        setColdPassDeletePromptState({
          open: false,
          deletingIndex: null,
          errorMessage: null,
          isSubmitting: false,
        })
      })
      .catch((error) => {
        setColdPassDeletePromptState((current) => ({
          ...current,
          open: true,
          errorMessage: error instanceof Error ? error.message : 'No se pudo eliminar la credencial.',
          isSubmitting: false,
        }))
      })
  }, [activeLibrary?.androidTreeUri, coldPassDeletePromptState.deletingIndex, coldPassSession])

  const handleSubmitColdPassImportPasskey = useCallback((passkey: string) => {
    if (!coldPassSession || !coldPassImportPromptState.pendingImport) {
      return
    }

    if (passkey !== coldPassSession.passkey) {
      setColdPassImportPromptState((current) => ({
        ...current,
        open: true,
        errorMessage: 'La passkey no coincide.',
        isSubmitting: false,
      }))
      return
    }

    const importSummary = coldPassImportPromptState.pendingImport
    const nextEntries = [...coldPassSession.entries, ...importSummary.importedEntries]
    setColdPassImportPromptState((current) => ({
      ...current,
      open: true,
      errorMessage: null,
      isSubmitting: true,
    }))

    void saveColdPassEntries(
      coldPassSession.filePath,
      coldPassSession.passkey,
      nextEntries,
      activeLibrary?.androidTreeUri,
    )
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error ?? 'No se pudo importar el vault.')
        }

        setColdPassSession({
          ...coldPassSession,
          entries: nextEntries,
          markdown: result.markdown,
        })
        setDialogState({
          type: 'info',
          title: 'Vault importado',
          message: importSummary.skippedRowCount > 0
            ? `Se importaron ${importSummary.importedEntries.length} credenciales desde ${importSummary.sourceFileName} y se omitieron ${importSummary.skippedRowCount} filas vacias.`
            : `Se importaron ${importSummary.importedEntries.length} credenciales desde ${importSummary.sourceFileName}.`,
        })
        setColdPassImportPromptState({
          open: false,
          pendingImport: null,
          errorMessage: null,
          isSubmitting: false,
          isSelectingFile: false,
        })
      })
      .catch((error) => {
        setColdPassImportPromptState((current) => ({
          ...current,
          open: true,
          errorMessage: error instanceof Error ? error.message : 'No se pudo importar el vault.',
          isSubmitting: false,
        }))
      })
  }, [activeLibrary?.androidTreeUri, coldPassImportPromptState.pendingImport, coldPassSession])

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
        drawioControllersRef.current.delete(tab.document.path)
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
    const drawioController = drawioControllersRef.current.get(path)
    if (drawioController) {
      drawioControllersRef.current.delete(path)
      drawioControllersRef.current.set(nextPath, drawioController)
    }
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
    setOpenTabs((current) => {
      if (current.some((tab) => tab.document.path === document.path)) {
        return current
      }

      return [...current, { document, latestSavedSource, saveStatus: 'idle' }]
    })
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
    if (!activeLibrary?.path || !shouldRefreshActiveLibraryTree) {
      return
    }

    if (!hasDeferredTreeRefreshRef.current) {
      return
    }

    hasDeferredTreeRefreshRef.current = false
    void refreshActiveLibraryTree()
  }, [activeLibrary?.path, refreshActiveLibraryTree, shouldRefreshActiveLibraryTree])

  useEffect(() => {
    if (!activeLibrary?.path || !shouldRefreshActiveLibraryTree) {
      return
    }

    requestAutomaticTreeProbe()
  }, [activeLibrary?.path, requestAutomaticTreeProbe, shouldRefreshActiveLibraryTree])

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

  useEffect(() => {
    if (!activeLibrary?.path) {
      return
    }

    const requestProbe = () => {
      if (!shouldRefreshActiveLibraryTree) {
        return
      }

      requestAutomaticTreeProbe()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return
      }

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

  useEffect(() => {
    if (isAndroidRuntime || !activeLibrary?.path) {
      return
    }

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
      }
      void stopDesktopLibraryTreeWatch()
    }
  }, [activeLibrary?.path, isAndroidRuntime])

  const handleOpenFile = useCallback(async (filePath: string) => {
    const existingTab = openTabsRef.current.find((tab) => tab.document.path === filePath)
    if (existingTab) {
      setActiveTabPath(filePath)
      return
    }

    if (openingDocumentPathsRef.current.has(filePath)) {
      setActiveTabPath(filePath)
      return
    }

    const extension = getFileExtension(filePath)
    const viewKind = resolveFileViewKind(extension)

    setContextMenu(null)
    setPendingCreation(null)
    setRenamingPath(null)

    const openFileMeasurement = startPerformanceMeasurement('document.open', {
      extension,
      filePath,
      viewKind,
    })

    if (isTextualViewKind(viewKind) || viewKind === 'inkdoc' || viewKind === 'drawio') {
      openingDocumentPathsRef.current.add(filePath)
      try {
        const result = await readLibraryFileContent(filePath, {
          androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(filePath),
        })
        if (!result.ok) {
          openFileMeasurement.error(new Error(result.error ?? 'Could not read file.'))
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
        openFileMeasurement.success({
          sourceLength: result.content.length,
        })
        return
      } finally {
        openingDocumentPathsRef.current.delete(filePath)
      }
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
    openFileMeasurement.success()
  }, [openDocumentInTab, resolveActiveLibraryAndroidDirectoryUri])

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

      const result = await writeLibraryFileContent(targetPath, nextSource, {
        androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(targetPath),
      })
      if (!result.ok) {
        throw new Error(result.error ?? 'No se pudo guardar el archivo Inkdoc.')
      }

      if (activeLibrary?.path) {
        invalidateLibrarySearchGraphIndex(activeLibrary.path, targetPath)
      }
      setOpenTabs((current) =>
        current.map((tab) =>
          tab.document.path === targetPath ? { ...tab, latestSavedSource: nextSource, saveStatus: 'idle' } : tab,
        ),
      )
      bumpLibraryIndexRevision()
    },
    [activeLibrary?.path, bumpLibraryIndexRevision, resolveActiveLibraryAndroidDirectoryUri],
  )

  const handleDrawioDocumentPersist = useCallback(
    async (targetPath: string, nextSource: string): Promise<void> => {
      setOpenTabs((current) =>
        current.map((tab) => {
          if (tab.document.path !== targetPath || tab.document.viewKind !== 'drawio') {
            return tab
          }

          return {
            ...tab,
            saveStatus: 'saving',
            document: {
              ...tab.document,
              source: nextSource,
            },
          }
        }),
      )

      const result = await writeLibraryFileContent(targetPath, nextSource, {
        androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(targetPath),
      })
      if (!result.ok) {
        setOpenTabs((current) =>
          current.map((tab) => (
            tab.document.path === targetPath
              ? { ...tab, saveStatus: 'error' }
              : tab
          )),
        )
        throw new Error(result.error ?? 'No se pudo guardar el archivo draw.io.')
      }

      if (activeLibrary?.path) {
        invalidateLibrarySearchGraphIndex(activeLibrary.path, targetPath)
      }
      setOpenTabs((current) =>
        current.map((tab) => {
          if (tab.document.path !== targetPath || tab.document.viewKind !== 'drawio') {
            return tab
          }

          return {
            ...tab,
            latestSavedSource: nextSource,
            saveStatus: 'idle',
            document: {
              ...tab.document,
              source: nextSource,
            },
          }
        }),
      )
      bumpLibraryIndexRevision()
    },
    [activeLibrary?.path, bumpLibraryIndexRevision, resolveActiveLibraryAndroidDirectoryUri],
  )

  const handleDrawioControllerReady = useCallback(
    (filePath: string, controller: DrawioDocumentController | null) => {
      if (controller) {
        drawioControllersRef.current.set(filePath, controller)
        return
      }

      drawioControllersRef.current.delete(filePath)
    },
    [],
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
    notifyLibraryTreeChanged(pendingCreation.parentPath)
  }, [activeLibrary, notifyLibraryTreeChanged, pendingCreation])

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
    const result = await performLibraryEntryOperation({
      action: 'rename',
      targetPath: path,
      newName: name,
    }, {
      androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(path),
    })
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
    notifyLibraryTreeChanged(path)
  }, [closeTabsByPath, notifyLibraryTreeChanged, renameOpenTabPath, resolveActiveLibraryAndroidDirectoryUri])

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
      }, {
        androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(targetDirectory || activeLibrary.path)
          ?? resolveActiveLibraryAndroidDirectoryUri(clipboardEntry.path),
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
      notifyLibraryTreeChanged(targetDirectory || clipboardEntry.path)
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
      }, {
        androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(targetPath),
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
      notifyLibraryTreeChanged(targetPath)
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
      setIsLibraryManagerOpen(false)
      return
    }

    setLibraries((current) => [...current, library])
    setActiveLibraryId(library.id)
    setIsLibraryManagerOpen(false)
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
      }, {
        androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(normalizedTargetDirectoryPath)
          ?? resolveActiveLibraryAndroidDirectoryUri(normalizedSourcePath),
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
      notifyLibraryTreeChanged(normalizedTargetDirectoryPath)
    })()
  }, [activeLibrary, closeTabsByPath, notifyLibraryTreeChanged, resolveActiveLibraryAndroidDirectoryUri])
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
    <div
      className={`notia-app-shell ${theme === 'dark' ? 'notia-theme-dark' : 'notia-theme-light'} ${
        isAndroidRuntime ? 'notia-app-shell--android' : ''
      }`.trim()}
    >
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
        showRightPanelToggle={activeWorkspaceView !== 'chat'}
        isRightPanelOpen={isRightChatPanelOpen}
        onToggleRightPanel={handleRightChatPanelToggle}
        onWindowAction={handleWindowAction}
      />
      <div className="notia-workspace" data-notia-prevent-menu-close>
        <aside className={`notia-sidebar ${isSidebarOpen ? 'notia-sidebar--open' : 'notia-sidebar--closed'}`} data-notia-prevent-menu-close>
          <div className="notia-primary-rail" data-notia-prevent-menu-close>
            <IconRail
              actions={LEFT_RAIL_ACTIONS}
              activeActionId={activeRailActionId}
              onActionClick={handleRailActionClick}
            />
          </div>
          {isSidebarOpen ? (
            <div className="notia-panel" data-notia-prevent-menu-close>
              <div className="notia-files-pane" data-notia-prevent-menu-close>
                <FileTree
                  nodes={displayedTreeNodes}
                  rootPath={activeLibrary?.path ?? null}
                  isSearchActive={isSearchActive}
                  searchMatchedFilePaths={deferredSearchMatchedPathSet}
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
                <div data-notia-prevent-menu-close>
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
            </div>
          ) : null}
        </aside>
        {shouldDeferHeavyWorkspaceMount ? (
          <main className="notia-main">
            <div className="notia-workspace-deferred-view" role="status" aria-live="polite">
              <div className="notia-workspace-deferred-card">
                <strong>
                  {activeWorkspaceView === 'graph'
                    ? 'Preparando graph view'
                    : activeWorkspaceView === 'task-manager'
                      ? 'Preparando Task Manager'
                      : 'Preparando chat'}
                </strong>
                <span>
                  {activeWorkspaceView === 'graph'
                    ? 'Android muestra primero la vista y completa la carga pesada justo despues.'
                    : activeWorkspaceView === 'task-manager'
                      ? 'Android abre primero el modulo y deja la lectura del vault para el siguiente frame.'
                      : 'Android abre primero el espacio y completa la carga del historial a continuacion.'}
                </span>
              </div>
            </div>
          </main>
        ) : activeWorkspaceView === 'graph' ? (
          <GraphView
            graphModel={graphModel}
            graphSourcesByPath={graphSourcesByPath}
            libraryName={libraryName}
            isLoading={isGraphLoading}
            onOpenFile={handleOpenFileFromView}
            chatSelectedPaths={graphChatSelectedPaths}
            onChatSelectedPathsChange={setGraphChatSelectedPaths}
          />
        ) : activeWorkspaceView === 'chat' ? (
          <ChatWorkspaceView
            library={activeLibrary}
            aiPreferences={aiPreferences}
            previousChats={previousChatFiles}
            historyHydrationMode={isAndroidRuntime ? 'minimal' : 'full'}
            onChatCreated={handleChatWorkspaceTreeChanged}
            onChatDeleted={handleChatWorkspaceTreeChanged}
          />
        ) : activeWorkspaceView === 'task-manager' ? (
          <TaskManagerApp
            embedded
            vault={activeTaskManagerVault}
            onOpenTaskFile={handleOpenFile}
            onActivePanelChange={setTaskManagerActivePanelId}
            onActiveChatContextChange={setTaskManagerChatContext}
          />
        ) : activeWorkspaceView === 'coldpass' ? (
          <ColdPassView
            entries={coldPassEntries}
            isUnlocked={Boolean(coldPassSession)}
            isImportingVault={coldPassImportPromptState.isSelectingFile}
            onCreateCredential={handleOpenColdPassCredentialModal}
            onImportVault={handleImportColdPassVault}
            onEditCredential={handleEditColdPassCredential}
            onDeleteCredential={handleDeleteColdPassCredential}
          />
        ) : (
          <MainView
            activeDocument={activeDocument}
            saveStatus={saveStatus}
            onTextDocumentChange={handleTextDocumentChange}
            onInkdocDocumentPersist={handleInkdocDocumentPersist}
            onDrawioDocumentPersist={handleDrawioDocumentPersist}
            onDrawioControllerReady={handleDrawioControllerReady}
            rootPath={activeLibrary?.path ?? null}
            libraryAndroidTreeUri={activeLibrary?.androidTreeUri}
            libraryFilePaths={libraryFilePaths}
            inkdocPreferences={inkdocPreferences}
            aiPreferences={aiPreferences}
            markdownWikiLinkTargets={markdownWikiLinkTargets}
            onOpenLinkedFile={handleOpenFileFromView}
          />
        )}
        <aside className={`notia-right-panel ${isRightChatPanelOpen ? 'notia-right-panel--open' : 'notia-right-panel--closed'}`}>
          {isRightChatPanelOpen ? (
            isRightPanelChatMounted ? (
              <ChatWorkspaceView
                key={rightPanelChatContextKey}
                library={activeLibrary}
                aiPreferences={aiPreferences}
                previousChats={previousChatFiles}
                title="Chat lateral"
                description="Acceso rapido a la IA desde el panel derecho."
                showHistoryPanel={false}
                composerContextLabel={rightPanelChatContextLabel}
                preferredContextPaths={rightPanelPreferredContextPaths}
                preferredContextName={rightPanelPreferredContextName}
                preferredContextMode={rightPanelPreferredContextMode}
                preferredContextScopeKey={rightPanelPreferredContextScopeKey}
                transientContextPaths={rightPanelTransientContextPaths}
                transientContextMode={rightPanelTransientContextMode}
                transientContextSummary={rightPanelTransientContextSummary}
                persistTransientContext={false}
                selectMatchingChatOnly
                historyHydrationMode={isAndroidRuntime ? 'minimal' : 'full'}
                onChatCreated={handleChatWorkspaceTreeChanged}
                onChatDeleted={handleChatWorkspaceTreeChanged}
              />
            ) : (
              <main className="notia-main">
                <div className="notia-workspace-deferred-view notia-workspace-deferred-view--panel" role="status" aria-live="polite">
                  <div className="notia-workspace-deferred-card">
                    <strong>Preparando chat lateral</strong>
                    <span>Android abre primero el panel y carga el chat en el siguiente frame.</span>
                  </div>
                </div>
              </main>
            )
          ) : null}
        </aside>
      </div>
      <SettingsModal
        open={isSettingsOpen}
        onClose={handleCloseSettings}
        explorerRefreshIntervalMs={explorerRefreshIntervalMs}
        onExplorerRefreshIntervalMsChange={setExplorerRefreshIntervalMs}
        inkdocPreferences={inkdocPreferences}
        onInkdocPreferencesChange={setInkdocPreferences}
        aiPreferences={aiPreferences}
        onAiPreferencesChange={setAiPreferences}
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
      <ColdPassPasskeyModal
        open={coldPassPromptState.open}
        title={coldPassPromptState.requiresConfirmation ? 'Crear ColdPass' : 'Desbloquear ColdPass'}
        message={coldPassPromptState.requiresConfirmation
          ? 'ColdPass/ColdPass.md no existe todavia. Ingresá una passkey para crear la bóveda cifrada. Si la olvidás, no hay forma de recuperar el contenido cifrado.'
          : 'La passkey se usa para desencriptar ColdPass/ColdPass.md solo en memoria. Si la olvidás, no hay forma de recuperar el contenido cifrado. Al cerrar la pestaña, el contenido se olvida.'}
        requiresConfirmation={coldPassPromptState.requiresConfirmation}
        errorMessage={coldPassPromptState.errorMessage}
        isSubmitting={coldPassPromptState.isSubmitting}
        onSubmit={handleSubmitColdPassPasskey}
        onClose={handleCloseColdPassPrompt}
      />
      <ColdPassPasskeyModal
        open={coldPassDeletePromptState.open}
        title="Confirmar eliminacion"
        message="Ingresá la passkey de ColdPass para confirmar la eliminacion de esta credencial."
        errorMessage={coldPassDeletePromptState.errorMessage}
        isSubmitting={coldPassDeletePromptState.isSubmitting}
        onSubmit={handleSubmitColdPassDeletePasskey}
        onClose={handleCloseColdPassDeletePrompt}
      />
      <ColdPassPasskeyModal
        open={coldPassImportPromptState.open}
        title="Confirmar importacion"
        message={coldPassImportPromptState.pendingImport
          ? `Se validaron ${coldPassImportPromptState.pendingImport.importedEntries.length} credenciales desde ${coldPassImportPromptState.pendingImport.sourceFileName}. Ingresá la passkey de ColdPass para importarlas dentro de la bóveda cifrada.`
          : 'Ingresá la passkey de ColdPass para confirmar la importacion del vault.'}
        errorMessage={coldPassImportPromptState.errorMessage}
        isSubmitting={coldPassImportPromptState.isSubmitting}
        onSubmit={handleSubmitColdPassImportPasskey}
        onClose={handleCloseColdPassImportPrompt}
      />
      <ColdPassCredentialModal
        open={coldPassCredentialModalState.open}
        mode={coldPassCredentialModalState.mode}
        initialEntry={
          coldPassCredentialModalState.mode === 'edit'
            && coldPassCredentialModalState.editingIndex !== null
            ? coldPassSession?.entries[coldPassCredentialModalState.editingIndex] ?? null
            : null
        }
        isSubmitting={coldPassCredentialModalState.isSubmitting}
        errorMessage={coldPassCredentialModalState.errorMessage}
        onSubmit={handleSubmitColdPassCredential}
        onClose={handleCloseColdPassCredentialModal}
      />
    </div>
  )
}
