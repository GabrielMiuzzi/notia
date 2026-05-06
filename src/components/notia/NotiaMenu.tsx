import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shallowEqual } from 'react-redux'
import {
  EXPLORER_HEADER_ACTIONS,
  TAB_ICON,
  TITLEBAR_RIGHT_ACTIONS,
  TOP_TOOLBAR_ACTIONS,
} from '../../constants/notiaMenu'
import { controlWindow } from '../../services/window/windowRuntime'
import { NotiaActionsContext } from '../../context/notiaActions/NotiaActionsContext'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import { NotiaSidebar } from './NotiaSidebar'
import { NotiaWorkspace } from './NotiaWorkspace'
import { NotiaRightPanel } from './NotiaRightPanel'
import { NotiaModals } from './NotiaModals'
import { WindowTitleBar } from './WindowTitleBar'
import { type TaskManagerChatContext } from '../../modules/task-manager/components/TaskManagerApp'
import type { DrawioDocumentController } from '../../modules/drawio/types'
import { useGraphWorkspace } from './hooks/useGraphWorkspace'
import { useLibraryConfigSync } from './hooks/useLibraryConfigSync'
import { useRightPanelChatContext } from './hooks/useRightPanelChatContext'
import { useRightPanelChatFiles } from './hooks/useRightPanelChatFiles'
import { useLibrarySearch } from './hooks/useLibrarySearch'
import { useTextDocumentAutosave } from './hooks/useTextDocumentAutosave'
import { useColdPassSession } from './hooks/useColdPassSession'
import { useLibraryTreeSync } from './hooks/useLibraryTreeSync'
import { useTabManager } from './hooks/useTabManager'
import { useDocumentOpener } from './hooks/useDocumentOpener'
import { useDocumentPersist } from './hooks/useDocumentPersist'
import { useToolbarActions } from './hooks/useToolbarActions'
import { useFileTreeActions } from './hooks/useFileTreeActions'
import { useLibraryManagerActions } from './hooks/useLibraryManagerActions'
import { useRightPanelMount } from './hooks/useRightPanelMount'
import { useHeavyViewMount } from './hooks/useHeavyViewMount'
import { useGlobalEventListeners } from './hooks/useGlobalEventListeners'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { toggleSidebar, toggleRightChatPanel, closeSearchMenu, setSettingsOpen, setLibraryManagerOpen, setRightChatPanelOpen } from '../../features/ui/uiSlice'
import { selectIsRightChatPanelOpen } from '../../features/ui/uiSelectors'
import { toggleTheme, setAiSettings, setInkdocPreferences, setExplorerRefreshIntervalMs } from '../../features/preferences/preferencesSlice'
import { selectTheme, selectAiSettings, selectInkdocPreferences, selectExplorerRefreshIntervalMs } from '../../features/preferences/preferencesSelectors'
import { setSelectedLibraryId } from '../../features/library/librarySlice'
import { selectSelectedLibraryId, selectActiveLibrary } from '../../features/library/librarySelectors'
import { setActiveTabPath, resetTabs as resetTabsAction, COLDPASS_WORKSPACE_TAB_PATH } from '../../features/documents/documentsSlice'
import { selectTreeNodes, selectActiveDocument, selectActiveWorkspaceView, selectFlatFileList } from '../../features/documents/documentsSelectors'

// --- Pure helper function ---

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function NotiaMenu() {
  const dispatch = useAppDispatch()
  const isRightChatPanelOpen = useAppSelector(selectIsRightChatPanelOpen)
  const theme = useAppSelector(selectTheme)
  const explorerRefreshIntervalMs = useAppSelector(selectExplorerRefreshIntervalMs)
  const inkdocPreferences = useAppSelector(selectInkdocPreferences, shallowEqual)
  const aiPreferences = useAppSelector(selectAiSettings, shallowEqual)
  const activeLibraryId = useAppSelector(selectSelectedLibraryId)
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const treeNodes = useAppSelector(selectTreeNodes)
  const flatFileList = useAppSelector(selectFlatFileList)
  const activeDocument = useAppSelector(selectActiveDocument)
  const activeWorkspaceView = useAppSelector(selectActiveWorkspaceView)

  const [taskManagerActivePanelId, setTaskManagerActivePanelId] = useState('default')
  const [taskManagerChatContext, setTaskManagerChatContext] = useState<TaskManagerChatContext | null>(null)
  const closeColdPassTabRef = useRef<() => void>(() => {})

  const {
    coldPassSession,
    coldPassEntries,
    coldPassPromptState,
    coldPassCredentialModalState,
    coldPassDeletePromptState,
    coldPassImportPromptState,
    isImportingVault,
    handleSubmitColdPassPasskey,
    handleCloseColdPassPrompt,
    handleOpenColdPassCredentialModal,
    handleEditColdPassCredential,
    handleCloseColdPassCredentialModal,
    handleDeleteColdPassCredential,
    handleImportColdPassVault,
    handleSubmitColdPassCredential,
    handleCloseColdPassDeletePrompt,
    handleSubmitColdPassDeletePasskey,
    handleCloseColdPassImportPrompt,
    handleSubmitColdPassImportPasskey,
    resetColdPassSession,
  } = useColdPassSession({
    activeLibrary,
    activeWorkspaceView,
    closeColdPassTab: () => { closeColdPassTabRef.current() },
  })

  const runtimeDevice = useMemo(() => getRuntimeDevice(), [])
  const isAndroidRuntime = runtimeDevice === 'Android'
  const titlebarRightActions = useMemo(
    () => (isAndroidRuntime ? [] : TITLEBAR_RIGHT_ACTIONS),
    [isAndroidRuntime],
  )

  const resolveActiveLibraryAndroidDirectoryUri = useCallback((pathValue?: string | null): string | undefined => {
    if (!activeLibrary?.androidTreeUri) { return undefined }
    if (!pathValue) { return activeLibrary.androidTreeUri }
    const normalizedLibraryPath = normalizePath(activeLibrary.path)
    const normalizedPath = normalizePath(pathValue)
    if (normalizedPath === normalizedLibraryPath || normalizedPath.startsWith(`${normalizedLibraryPath}/`)) {
      return activeLibrary.androidTreeUri
    }
    return undefined
  }, [activeLibrary])

  const drawioControllersRef = useRef<Map<string, DrawioDocumentController>>(new Map())

  // --- Stable callback refs for circular dependencies between hooks ---
  const persistTextDocumentSourceRef = useRef<((targetPath: string, targetSource: string) => Promise<boolean>) | null>(null)
  const bumpLibraryIndexRevisionRef = useRef<() => void>(() => {})

  const { clearPendingTextSaveByPath, clearAllPendingTextSaves } = useTextDocumentAutosave({
    persistTextDocumentSource: useCallback(
      (targetPath: string, targetSource: string) => persistTextDocumentSourceRef.current?.(targetPath, targetSource) ?? Promise.resolve(true),
      [],
    ),
  })

  // resetTabsAndClearDrawioControllers from useTabManager is needed by useLibraryTreeSync,
  // but bumpLibraryIndexRevision from useLibraryTreeSync is needed by useTabManager.
  // Break the cycle: useTabManager takes bumpLibraryIndexRevision via ref.
  const resetTabsAndClearDrawioControllers = useCallback(() => {
    drawioControllersRef.current.clear()
    dispatch(resetTabsAction())
    resetColdPassSession()
    dispatch(setActiveTabPath(null))
  }, [dispatch, resetColdPassSession])

  const {
    handleToggleFolder,
    handleCollapseAllFolders,
    handleExpandAllFolders,
    notifyLibraryTreeChanged,
    bumpLibraryIndexRevision,
  } = useLibraryTreeSync({
    activeLibraryId,
    clearAllPendingTextSaves,
    resetTabsAndClearDrawioControllers,
  })

  // Wire up the bumpLibraryIndexRevision ref so useTabManager can use it
  bumpLibraryIndexRevisionRef.current = bumpLibraryIndexRevision

  const tabManager = useTabManager({
    resolveActiveLibraryAndroidDirectoryUri,
    clearPendingTextSaveByPath,
    drawioControllersRef,
    bumpLibraryIndexRevision: useCallback(() => { bumpLibraryIndexRevisionRef.current() }, []),
    resetColdPassSession,
    activeLibraryPath: activeLibrary?.path,
  })

  // Wire up the persistTextDocumentSource ref so autosave uses the tab manager version
  persistTextDocumentSourceRef.current = tabManager.persistTextDocumentSource

  useEffect(() => {
    closeColdPassTabRef.current = () => { void tabManager.closeTabByPath(COLDPASS_WORKSPACE_TAB_PATH) }
  }, [tabManager.closeTabByPath])

  const {
    handleOpenFile,
    handleOpenFileFromView,
  } = useDocumentOpener({
    openDocumentInTab: tabManager.openDocumentInTab,
    resolveActiveLibraryAndroidDirectoryUri,
  })

  const {
    handleInkdocDocumentPersist,
    handleDrawioDocumentPersist,
    handleDrawioControllerReady,
  } = useDocumentPersist({
    resolveActiveLibraryAndroidDirectoryUri,
    bumpLibraryIndexRevision,
    activeLibraryPath: activeLibrary?.path,
    drawioControllersRef,
  })

  const {
    handleHeaderActionClick,
    handleRailActionClick,
    handleExplorerToolClick,
  } = useToolbarActions({
    activeLibrary,
    handleCollapseAllFolders,
    handleExpandAllFolders,
  })

  const {
    handleSubmitPendingCreation,
    handleCancelPendingCreation,
    handleNodeContextMenu,
    handleEmptyContextMenu,
    handleRenameSubmit,
    handleCancelRename,
    handleMoveNode,
  } = useFileTreeActions({
    activeLibrary,
    resolveActiveLibraryAndroidDirectoryUri,
    notifyLibraryTreeChanged,
    closeTabsByPath: tabManager.closeTabsByPath,
    renameOpenTabPath: tabManager.renameOpenTabPath,
  })

  const {
    handleLibraryAdded,
    handleLibraryRemoved,
  } = useLibraryManagerActions({
    closeTabsByPath: tabManager.closeTabsByPath,
  })

  // --- Mounting hooks ---

  const { mountedHeavyWorkspaceView } = useHeavyViewMount({ activeWorkspaceView, isAndroidRuntime })

  useRightPanelMount({ isAndroidRuntime, isRightChatPanelOpen })

  useGlobalEventListeners({
    handleCloseActiveTab: tabManager.handleCloseActiveTab,
    handleCycleToNextTab: tabManager.handleCycleToNextTab,
  })

  // --- Simple dispatch-only callbacks ---

  const handleSidebarToggle = useCallback(() => { dispatch(toggleSidebar()) }, [dispatch])
  const handleRightChatPanelToggle = useCallback(() => { dispatch(toggleRightChatPanel()) }, [dispatch])
  const handleCloseSearchMenu = useCallback(() => { dispatch(closeSearchMenu()) }, [dispatch])
  const handleSelectLibrary = useCallback((libraryId: string) => { dispatch(setSelectedLibraryId(libraryId)) }, [dispatch])
  const handleThemeToggle = useCallback(() => { dispatch(toggleTheme()) }, [dispatch])

  useEffect(() => {
    if (activeWorkspaceView === 'chat') { dispatch(setRightChatPanelOpen(false)) }
  }, [activeWorkspaceView, dispatch])

  const handleAiPreferencesChange = useCallback<(value: Parameters<typeof setAiSettings>[0]) => void>(
    (next) => dispatch(setAiSettings(next)),
    [dispatch],
  )
  const handleExplorerRefreshIntervalMsChange = useCallback<(value: number) => void>(
    (next) => dispatch(setExplorerRefreshIntervalMs(next)),
    [dispatch],
  )
  const handleInkdocPreferencesChange = useCallback<(value: Parameters<typeof setInkdocPreferences>[0]) => void>(
    (next) => dispatch(setInkdocPreferences(next)),
    [dispatch],
  )

  useLibraryConfigSync({
    activeLibrary,
    aiPreferences,
    explorerRefreshIntervalMs,
    inkdocPreferences,
    setAiPreferences: handleAiPreferencesChange,
    setExplorerRefreshIntervalMs: handleExplorerRefreshIntervalMsChange,
    setInkdocPreferences: handleInkdocPreferencesChange,
  })

  useLibrarySearch({
    treeNodes,
    treeNodesLibraryId: activeLibraryId,
    flatFileList,
  })

  const handleWindowAction = useCallback((action: NotiaWindowAction) => { void controlWindow(action) }, [])
  const handleOpenLibraryManager = useCallback(() => { dispatch(setLibraryManagerOpen(true)) }, [dispatch])
  const handleOpenSettings = useCallback(() => { dispatch(setSettingsOpen(true)) }, [dispatch])
  const handleChatWorkspaceTreeChanged = useCallback((pathHint?: string) => {
    notifyLibraryTreeChanged(pathHint ?? activeLibrary?.path)
  }, [activeLibrary?.path, notifyLibraryTreeChanged])

  // --- Derived values ---

  const previousChatFiles = useRightPanelChatFiles({
    activeLibraryPath: activeLibrary?.path,
    activeWorkspaceView,
    isRightChatPanelOpen,
    treeNodes,
  })

  const activeTaskManagerVault = useMemo(
    () => (activeLibrary
      ? { path: activeLibrary.path, androidTreeUri: activeLibrary.androidTreeUri }
      : null),
    [activeLibrary?.androidTreeUri, activeLibrary?.path],
  )

  const {
    graphChatContextSummary,
    graphChatEffectivePaths,
    graphChatSelectedPaths,
    graphModel,
    graphSourcesByPath,
    isGraphLoading,
    setGraphChatSelectedPaths,
  } = useGraphWorkspace({ activeLibrary, activeWorkspaceView, treeNodes })

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

  // --- NotiaActions context value ---
  const actionsValue = useMemo(() => ({
    openFile: handleOpenFile,
    openFileFromView: handleOpenFileFromView,
    closeTab: tabManager.handleCloseTab,
    closeActiveTab: tabManager.handleCloseActiveTab,
    cycleToNextTab: tabManager.handleCycleToNextTab,
    toggleFolder: handleToggleFolder,
    toggleSidebar: handleSidebarToggle,
    toggleRightChatPanel: handleRightChatPanelToggle,
    toggleTheme: handleThemeToggle,
    selectLibrary: handleSelectLibrary,
    activateTab: tabManager.handleActivateTab,
    openSettings: handleOpenSettings,
    openLibraryManager: handleOpenLibraryManager,
    railActionClick: handleRailActionClick,
    headerActionClick: handleHeaderActionClick,
    explorerToolClick: handleExplorerToolClick,
    closeSearchMenu: handleCloseSearchMenu,
    submitPendingCreation: handleSubmitPendingCreation,
    cancelPendingCreation: handleCancelPendingCreation,
    renameSubmit: handleRenameSubmit,
    cancelRename: handleCancelRename,
    nodeContextMenu: handleNodeContextMenu,
    emptyContextMenu: handleEmptyContextMenu,
    moveNode: handleMoveNode,
    libraryAdded: handleLibraryAdded,
    libraryRemoved: handleLibraryRemoved,
    textDocumentChange: tabManager.handleTextDocumentChange,
    inkdocDocumentPersist: handleInkdocDocumentPersist,
    drawioDocumentPersist: handleDrawioDocumentPersist,
    drawioControllerReady: handleDrawioControllerReady,
    chatWorkspaceTreeChanged: handleChatWorkspaceTreeChanged,
    windowAction: handleWindowAction,
    coldPassOpenCredentialModal: handleOpenColdPassCredentialModal,
    coldPassImportVault: handleImportColdPassVault,
    coldPassEditCredential: handleEditColdPassCredential,
    coldPassDeleteCredential: handleDeleteColdPassCredential,
  }), [
    handleOpenFile,
    handleOpenFileFromView,
    tabManager,
    handleToggleFolder,
    handleSidebarToggle,
    handleRightChatPanelToggle,
    handleThemeToggle,
    handleSelectLibrary,
    handleOpenSettings,
    handleOpenLibraryManager,
    handleRailActionClick,
    handleHeaderActionClick,
    handleExplorerToolClick,
    handleCloseSearchMenu,
    handleSubmitPendingCreation,
    handleCancelPendingCreation,
    handleRenameSubmit,
    handleCancelRename,
    handleNodeContextMenu,
    handleEmptyContextMenu,
    handleMoveNode,
    handleLibraryAdded,
    handleLibraryRemoved,
    handleInkdocDocumentPersist,
    handleDrawioDocumentPersist,
    handleDrawioControllerReady,
    handleChatWorkspaceTreeChanged,
    handleWindowAction,
    handleOpenColdPassCredentialModal,
    handleImportColdPassVault,
    handleEditColdPassCredential,
    handleDeleteColdPassCredential,
  ])

  return (
    <NotiaActionsContext.Provider value={actionsValue}>
      <div
        className={`notia-app-shell ${theme === 'dark' ? 'notia-theme-dark' : 'notia-theme-light'} ${
          isAndroidRuntime ? 'notia-app-shell--android' : ''
        }`.trim()}
      >
        <WindowTitleBar
          tabIcon={TAB_ICON}
          explorerActions={EXPLORER_HEADER_ACTIONS}
          explorerTools={TOP_TOOLBAR_ACTIONS}
          rightActions={titlebarRightActions}
          showRightPanelToggle={activeWorkspaceView !== 'chat'}
        />
        <div className="notia-workspace" data-notia-prevent-menu-close>
          <NotiaSidebar />
          <NotiaWorkspace
            mountedHeavyWorkspaceView={mountedHeavyWorkspaceView}
            isAndroidRuntime={isAndroidRuntime}
            coldPassEntries={coldPassEntries}
            coldPassSession={coldPassSession}
            activeTaskManagerVault={activeTaskManagerVault}
            graphModel={graphModel}
            graphSourcesByPath={graphSourcesByPath}
            isGraphLoading={isGraphLoading}
            graphChatSelectedPaths={graphChatSelectedPaths}
            setGraphChatSelectedPaths={setGraphChatSelectedPaths}
            previousChatFiles={previousChatFiles}
            setTaskManagerActivePanelId={setTaskManagerActivePanelId}
            setTaskManagerChatContext={setTaskManagerChatContext}
            isImportingVault={isImportingVault}
          />
          <NotiaRightPanel
            previousChats={previousChatFiles}
            rightPanelChatContextKey={rightPanelChatContextKey}
            rightPanelChatContextLabel={rightPanelChatContextLabel}
            rightPanelPreferredContextPaths={rightPanelPreferredContextPaths}
            rightPanelPreferredContextName={rightPanelPreferredContextName}
            rightPanelPreferredContextMode={rightPanelPreferredContextMode}
            rightPanelPreferredContextScopeKey={rightPanelPreferredContextScopeKey}
            rightPanelTransientContextPaths={rightPanelTransientContextPaths}
            rightPanelTransientContextMode={rightPanelTransientContextMode}
            rightPanelTransientContextSummary={rightPanelTransientContextSummary}
            isAndroidRuntime={isAndroidRuntime}
          />
        </div>
        <NotiaModals
          onAiPreferencesChange={handleAiPreferencesChange}
          onExplorerRefreshIntervalMsChange={handleExplorerRefreshIntervalMsChange}
          onInkdocPreferencesChange={handleInkdocPreferencesChange}
          coldPassPromptState={coldPassPromptState}
          coldPassDeletePromptState={coldPassDeletePromptState}
          coldPassImportPromptState={coldPassImportPromptState}
          coldPassCredentialModalState={coldPassCredentialModalState}
          coldPassSession={coldPassSession}
          handleSubmitColdPassPasskey={handleSubmitColdPassPasskey}
          handleCloseColdPassPrompt={handleCloseColdPassPrompt}
          handleSubmitColdPassDeletePasskey={handleSubmitColdPassDeletePasskey}
          handleCloseColdPassDeletePrompt={handleCloseColdPassDeletePrompt}
          handleSubmitColdPassImportPasskey={handleSubmitColdPassImportPasskey}
          handleCloseColdPassImportPrompt={handleCloseColdPassImportPrompt}
          handleSubmitColdPassCredential={handleSubmitColdPassCredential}
          handleCloseColdPassCredentialModal={handleCloseColdPassCredentialModal}
        />
      </div>
    </NotiaActionsContext.Provider>
  )
}