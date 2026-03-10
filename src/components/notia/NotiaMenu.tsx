/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  performLibraryEntryOperation,
  readLibraryTree,
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
import { loadExplorerRefreshIntervalMs, saveExplorerRefreshIntervalMs } from '../../services/preferences/explorerPanelStorage'
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
import { setFolderExpandedByPath } from '../../utils/tree/setFolderExpandedByPath'
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

function isOpenTextDocumentTab(tab: OpenDocumentTab | null): tab is OpenTextDocumentTab {
  return Boolean(tab && isTextFileDocument(tab.document))
}

export function NotiaMenu() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [activeWorkspaceView, setActiveWorkspaceView] = useState<'documents' | 'graph' | 'task-manager'>(
    'documents',
  )
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
  const [libraries, setLibraries] = useState<NotiaLibrary[]>(() => loadLibraries())
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(() =>
    findInitialActiveLibrary(loadLibraries()),
  )
  const [treeNodes, setTreeNodes] = useState<NotiaFileNode[]>([])
  const [openTabs, setOpenTabs] = useState<OpenDocumentTab[]>([])
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

  const activeTabPathRef = useRef<string | null>(null)
  const openTabsRef = useRef<OpenDocumentTab[]>([])
  const treeNodesRef = useRef<NotiaFileNode[]>([])
  const libraryTreeRefreshTimerRef = useRef<number | null>(null)

  const activeLibrary = useMemo(
    () => libraries.find((library) => library.id === activeLibraryId) ?? null,
    [activeLibraryId, libraries],
  )
  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.document.path === activeTabPath) ?? null,
    [activeTabPath, openTabs],
  )
  const activeTextTab = useMemo(
    () => (isOpenTextDocumentTab(activeTab) ? activeTab : null),
    [activeTab],
  )
  const activeDocument = activeTab?.document ?? null
  const saveStatus = activeTab?.saveStatus ?? 'idle'
  const normalizedSearchQuery = searchQuery.trim()
  const searchMatchedPathSet = useMemo(() => new Set(searchMatchedPaths), [searchMatchedPaths])
  const isSearchActive = normalizedSearchQuery.length > 0
  const displayedTreeNodes = useMemo(
    () => applySearchMatchesToTree(treeNodes, searchMatchedPathSet, isSearchActive),
    [treeNodes, searchMatchedPathSet, isSearchActive],
  )
  const titleBarTabs = useMemo(
    () => openTabs.map((tab) => ({ path: tab.document.path, title: tab.document.name })),
    [openTabs],
  )
  const markdownWikiLinkTargets = useMemo(
    () => buildWikiLinkTargets(treeNodes, activeLibrary?.path ?? null),
    [activeLibrary?.path, treeNodes],
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
  const { graphModel, isGraphLoading } = useLibraryGraphData({
    libraryPath: activeLibrary?.path ?? null,
    rootPath: activeLibrary?.path ?? null,
    treeNodes,
    revision: graphRevision,
  })

  const resetTabs = useCallback(() => {
    setOpenTabs([])
    setActiveTabPath(null)
  }, [])

  useEffect(() => {
    saveLibraries(libraries)
  }, [libraries])

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
    activeTabPathRef.current = activeTabPath
  }, [activeTabPath])

  useEffect(() => {
    openTabsRef.current = openTabs
  }, [openTabs])

  useEffect(() => {
    treeNodesRef.current = treeNodes
  }, [treeNodes])

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
      setTreeNodes([])
      setPendingCreation(null)
      return
    }

    let isCurrent = true
    readLibraryTree(activeLibrary.path, {
      androidDirectoryUri: activeLibrary.androidTreeUri,
    }).then((nodes) => {
      if (!isCurrent) {
        return
      }

      const expandedStateByPath = collectFolderExpandedState(treeNodesRef.current)
      const withExpandedState = applyFolderExpandedState(nodes, expandedStateByPath)
      const selectedNodes = setSelectedFileByPath(withExpandedState, activeTabPathRef.current)
      setTreeNodes(selectedNodes)
    })

    return () => {
      isCurrent = false
    }
  }, [activeLibrary])

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
  }, [activeLibraryId, resetTabs])

  useEffect(() => {
    setTreeNodes((current) => setSelectedFileByPath(current, activeTabPath))
  }, [activeTabPath])

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
    if (!activeTextTab) {
      return
    }

    const targetPath = activeTextTab.document.path
    const targetSource = activeTextTab.document.source
    const latestSavedSource = activeTextTab.latestSavedSource
    const saveDebounceMs = activeTextTab.document.viewKind === 'markdown' ? 1200 : 380

    if (targetSource === latestSavedSource) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void writeLibraryFileContent(targetPath, targetSource).then((result) => {
        const currentTab = openTabsRef.current.find((tab) => tab.document.path === targetPath)
        if (!currentTab || !isTextFileDocument(currentTab.document) || currentTab.document.source !== targetSource) {
          return
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
          setGraphRevision((current) => current + 1)
          return
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
      })
    }, saveDebounceMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [activeTextTab])

  const handleSidebarToggle = () => {
    setIsSidebarOpen((current) => {
      const next = !current
      if (!next) {
        setIsSearchMenuOpen(false)
        setActiveHeaderAction('')
      }
      return next
    })
  }

  const handleHeaderActionClick = (id: string) => {
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
  }

  const handleCloseSearchMenu = useCallback(() => {
    setIsSearchMenuOpen(false)
    setActiveHeaderAction((current) => (current === 'search' ? '' : current))
  }, [])

  const handleSelectLibrary = (libraryId: string) => {
    setActiveLibraryId(libraryId)
  }

  const handleToggleFolder = (folderId: string) => {
    setTreeNodes((current) => toggleFolderNodeExpanded(current, folderId))
  }

  const handleThemeToggle = () => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  const handleRailActionClick = (actionId: string) => {
    if (actionId === 'graph-view') {
      setActiveWorkspaceView((current) => (current === 'graph' ? 'documents' : 'graph'))
      return
    }

    if (actionId === 'task-manager') {
      setActiveWorkspaceView((current) => (current === 'task-manager' ? 'documents' : 'task-manager'))
    }
  }

  const handleExplorerToolClick = (toolId: string) => {
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
    }
  }

  const handleWindowAction = (action: 'minimize' | 'maximize' | 'close') => {
    void controlWindow(action)
  }

  const handleActivateTab = useCallback((tabPath: string) => {
    if (!openTabsRef.current.some((tab) => tab.document.path === tabPath)) {
      return
    }

    setActiveTabPath(tabPath)
  }, [])

  const handleCloseTab = useCallback((tabPath: string) => {
    const currentTabs = openTabsRef.current
    const closingIndex = currentTabs.findIndex((tab) => tab.document.path === tabPath)
    if (closingIndex < 0) {
      return
    }

    const remainingTabs = currentTabs.filter((tab) => tab.document.path !== tabPath)
    const currentActiveTabPath = activeTabPathRef.current
    let nextActiveTabPath = currentActiveTabPath

    if (currentActiveTabPath === tabPath) {
      if (remainingTabs.length === 0) {
        nextActiveTabPath = null
      } else {
        const fallbackIndex = closingIndex > 0 ? closingIndex - 1 : 0
        const safeFallbackIndex = Math.min(fallbackIndex, remainingTabs.length - 1)
        nextActiveTabPath = remainingTabs[safeFallbackIndex].document.path
      }
    }

    if (nextActiveTabPath && !remainingTabs.some((tab) => tab.document.path === nextActiveTabPath)) {
      nextActiveTabPath = remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].document.path : null
    }

    setOpenTabs(remainingTabs)
    setActiveTabPath(nextActiveTabPath)
  }, [])

  const handleCloseActiveTab = useCallback(() => {
    const currentActiveTabPath = activeTabPathRef.current
    if (!currentActiveTabPath) {
      return
    }

    handleCloseTab(currentActiveTabPath)
  }, [handleCloseTab])

  const handleCycleToNextTab = useCallback(() => {
    const currentTabs = openTabsRef.current
    if (currentTabs.length <= 1) {
      return
    }

    const currentActiveTabPath = activeTabPathRef.current
    const activeIndex = currentTabs.findIndex((tab) => tab.document.path === currentActiveTabPath)
    const nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % currentTabs.length
    setActiveTabPath(currentTabs[nextIndex].document.path)
  }, [])

  const closeTabsByPath = useCallback((path: string) => {
    const currentTabs = openTabsRef.current
    const remainingTabs = currentTabs.filter((tab) => !isSameOrNestedPath(path, tab.document.path))
    if (remainingTabs.length === currentTabs.length) {
      return
    }

    const currentActiveTabPath = activeTabPathRef.current
    const nextActiveTabPath =
      currentActiveTabPath && remainingTabs.some((tab) => tab.document.path === currentActiveTabPath)
        ? currentActiveTabPath
        : remainingTabs.length > 0
          ? remainingTabs[remainingTabs.length - 1].document.path
          : null

    setOpenTabs(remainingTabs)
    setActiveTabPath(nextActiveTabPath)
  }, [])

  const renameOpenTabPath = useCallback((path: string, nextPath: string, name: string) => {
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
  }, [])

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

  const refreshActiveLibraryTree = useCallback(async () => {
    if (!activeLibrary) {
      return
    }

    const refreshedNodes = await readLibraryTree(activeLibrary.path, {
      androidDirectoryUri: activeLibrary.androidTreeUri,
    })
    const expandedStateByPath = collectFolderExpandedState(treeNodesRef.current)
    const withExpandedState = applyFolderExpandedState(refreshedNodes, expandedStateByPath)
    const selectedNodes = setSelectedFileByPath(withExpandedState, activeTabPathRef.current)
    setTreeNodes(selectedNodes)
  }, [activeLibrary])

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
        void refreshActiveLibraryTree()
        setGraphRevision((current) => current + 1)
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
  }, [activeLibrary?.path, refreshActiveLibraryTree])

  useEffect(() => {
    if (!activeLibrary?.path) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return
      }

      void refreshActiveLibraryTree()
    }, explorerRefreshIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activeLibrary?.path, explorerRefreshIntervalMs, refreshActiveLibraryTree])

  const handleOpenFile = async (filePath: string) => {
    setActiveWorkspaceView('documents')

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
  }

  const handleTextDocumentChange = (nextSource: string) => {
    if (!activeTabPath) {
      return
    }

    setOpenTabs((current) =>
      current.map((tab) => {
        if (tab.document.path !== activeTabPath || !isTextFileDocument(tab.document)) {
          return tab
        }

        if (tab.document.source === nextSource) {
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
  }

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
      setGraphRevision((current) => current + 1)
    },
    [],
  )

  const handleSubmitPendingCreation = async (name: string) => {
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
  }

  const handleCancelPendingCreation = () => {
    setPendingCreation(null)
  }

  const handleNodeContextMenu = (node: NotiaFileNode, position: { x: number; y: number }) => {
    setPendingCreation(null)
    setContextMenu({ type: 'node', x: position.x, y: position.y, node })
  }

  const handleEmptyContextMenu = (position: { x: number; y: number }) => {
    setPendingCreation(null)
    setRenamingPath(null)
    setContextMenu({ type: 'empty', x: position.x, y: position.y })
  }

  const handleRenameSubmit = async (path: string, name: string) => {
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
  }

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
      setTreeNodes((current) => setFolderExpandedByPath(current, targetPath, true))
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
      setTreeNodes((current) => setFolderExpandedByPath(current, targetPath, true))
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
      setTreeNodes((current) => setFolderExpandedByPath(current, targetPath, true))
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

  const libraryName = activeLibrary?.name ?? 'Sin librerias'
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

  const handleDialogClose = () => {
    setDialogState(null)
  }

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
        rightActions={TITLEBAR_RIGHT_ACTIONS}
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
                  onOpenFile={(filePath) => {
                    void handleOpenFile(filePath)
                  }}
                  pendingCreation={pendingCreation}
                  onSubmitPendingCreation={handleSubmitPendingCreation}
                  onCancelPendingCreation={handleCancelPendingCreation}
                  renamingPath={renamingPath}
                  onSubmitRename={handleRenameSubmit}
                  onCancelRename={() => setRenamingPath(null)}
                  onNodeContextMenu={handleNodeContextMenu}
                  onEmptyContextMenu={handleEmptyContextMenu}
                />
                <WorkspaceFooter
                  name={libraryName}
                  icon={Bot}
                  libraries={libraries}
                  activeLibraryId={activeLibraryId}
                  onSelectLibrary={handleSelectLibrary}
                  onOpenLibraryManager={() => setIsLibraryManagerOpen(true)}
                  onOpenSettings={() => setIsSettingsOpen(true)}
                />
              </div>
            </div>
          ) : null}
        </aside>
        {activeWorkspaceView === 'graph' ? (
          <GraphView
            graphModel={graphModel}
            libraryName={libraryName}
            isLoading={isGraphLoading}
            onOpenFile={(filePath) => {
              void handleOpenFile(filePath)
            }}
          />
        ) : activeWorkspaceView === 'task-manager' ? (
          <TaskManagerApp embedded vaultPath={activeLibrary?.path ?? null} />
        ) : (
          <MainView
            activeDocument={activeDocument}
            saveStatus={saveStatus}
            onTextDocumentChange={handleTextDocumentChange}
            onInkdocDocumentPersist={handleInkdocDocumentPersist}
            rootPath={activeLibrary?.path ?? null}
            libraryFilePaths={libraryFilePaths}
            markdownWikiLinkTargets={markdownWikiLinkTargets}
            onOpenLinkedFile={(filePath) => {
              void handleOpenFile(filePath)
            }}
          />
        )}
      </div>
      <SettingsModal
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        explorerRefreshIntervalMs={explorerRefreshIntervalMs}
        onExplorerRefreshIntervalMsChange={setExplorerRefreshIntervalMs}
      />
      <LibraryManagerModal
        open={isLibraryManagerOpen}
        libraries={libraries}
        activeLibraryId={activeLibraryId}
        onLibraryAdded={handleLibraryAdded}
        onClose={() => setIsLibraryManagerOpen(false)}
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
