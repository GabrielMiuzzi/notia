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
import { type TaskManagerChatContext } from '../../modules/task-manager/types/taskManagerTypes'
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
import { useToolbarActions } from './hooks/useToolbarActions'
import { useFileTreeActions } from './hooks/useFileTreeActions'
import { useLibraryManagerActions } from './hooks/useLibraryManagerActions'
import { useRightPanelMount } from './hooks/useRightPanelMount'
import { useHeavyViewMount } from './hooks/useHeavyViewMount'
import { useGlobalEventListeners } from './hooks/useGlobalEventListeners'
import { useLibraryLinkCacheAutoRebuild } from './hooks/useLibraryLinkCacheAutoRebuild'
import { useTelegramAgentBridge } from './hooks/useTelegramAgentBridge'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { toggleSidebar, toggleRightChatPanel, closeSearchMenu, setSettingsOpen, setLibraryManagerOpen, setRightChatPanelOpen } from '../../features/ui/uiSlice'
import { selectIsRightChatPanelOpen } from '../../features/ui/uiSelectors'
import { toggleTheme, setAiSettings, setInkMathPreferences, setExplorerRefreshIntervalMs, setTelegramSettings, setBackupPreferences } from '../../features/preferences/preferencesSlice'
import { selectTheme, selectAiSettings, selectInkMathPreferences, selectExplorerRefreshIntervalMs, selectTelegramSettings, selectBackupPreferences } from '../../features/preferences/preferencesSelectors'
import { setSelectedLibraryId } from '../../features/library/librarySlice'
import { selectSelectedLibraryId, selectActiveLibrary } from '../../features/library/librarySelectors'
import { setActiveTabPath, COLDPASS_WORKSPACE_TAB_PATH } from '../../features/documents/documentsSlice'
import { selectTreeNodes, selectActiveDocument, selectActiveWorkspaceView, selectFlatFileList } from '../../features/documents/documentsSelectors'
import { notiaTimer } from '../../services/runtime/notiaLogger'
import { useWindowsBackups } from './hooks/useWindowsBackups'

// --- Pure helper function ---

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '')
}

function NotiaMenuComponent() {
  const dispatch = useAppDispatch()
  const isRightChatPanelOpen = useAppSelector(selectIsRightChatPanelOpen)
  const theme = useAppSelector(selectTheme)
  const explorerRefreshIntervalMs = useAppSelector(selectExplorerRefreshIntervalMs)
  const inkMathPreferences = useAppSelector(selectInkMathPreferences, shallowEqual)
  const aiPreferences = useAppSelector(selectAiSettings, shallowEqual)
  const telegramPreferences = useAppSelector(selectTelegramSettings, shallowEqual)
  const backupPreferences = useAppSelector(selectBackupPreferences, shallowEqual)
  const activeLibraryId = useAppSelector(selectSelectedLibraryId)
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const treeNodes = useAppSelector(selectTreeNodes)
  const flatFileList = useAppSelector(selectFlatFileList)
  const activeDocument = useAppSelector(selectActiveDocument)
  const activeWorkspaceView = useAppSelector(selectActiveWorkspaceView)
  useWindowsBackups(activeLibrary, backupPreferences.directoryPath)

  useEffect(() => {
    const mountTimer = notiaTimer('ui', 'NotiaMenu.mount')
    return () => {
      mountTimer.success()
    }
  }, [])

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

  const activeLibraryPath = activeLibrary?.path
  const activeLibraryAndroidTreeUri = activeLibrary?.androidTreeUri

  const resolveActiveLibraryAndroidDirectoryUri = useCallback((pathValue?: string | null): string | undefined => {
    if (!activeLibraryAndroidTreeUri) { return undefined }
    if (!pathValue) { return activeLibraryAndroidTreeUri }
    const normalizedLibraryPath = normalizePath(activeLibraryPath ?? '')
    const normalizedPath = normalizePath(pathValue)
    if (normalizedPath === normalizedLibraryPath || normalizedPath.startsWith(`${normalizedLibraryPath}/`)) {
      return activeLibraryAndroidTreeUri
    }
    return undefined
  }, [activeLibraryAndroidTreeUri, activeLibraryPath])

  // --- Stable callback refs for circular dependencies between hooks ---
  const persistTextDocumentSourceRef = useRef<((targetPath: string, targetSource: string) => Promise<boolean>) | null>(null)
  const bumpLibraryIndexRevisionRef = useRef<() => void>(() => {})

  const { clearPendingTextSaveByPath, clearAllPendingTextSaves } = useTextDocumentAutosave({
    persistTextDocumentSource: useCallback(
      (targetPath: string, targetSource: string) => persistTextDocumentSourceRef.current?.(targetPath, targetSource) ?? Promise.resolve(true),
      [],
    ),
  })

  // resetTabs from useTabManager is needed by useLibraryTreeSync,
  // but bumpLibraryIndexRevision from useLibraryTreeSync is needed by useTabManager.
  // Break the cycle: useTabManager takes bumpLibraryIndexRevision via ref.
  const resetTabsActionCallback = useCallback(() => {
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
    resetTabsAndClearDrawioControllers: resetTabsActionCallback,
  })

  // Wire up the bumpLibraryIndexRevision ref so useTabManager can use it
  useEffect(() => {
    bumpLibraryIndexRevisionRef.current = bumpLibraryIndexRevision
  }, [bumpLibraryIndexRevision])

  const bumpLibraryIndexRevisionCallback = useCallback(() => { bumpLibraryIndexRevisionRef.current() }, [])

  const tabManager = useTabManager({
    resolveActiveLibraryAndroidDirectoryUri,
    clearPendingTextSaveByPath,
    bumpLibraryIndexRevision: bumpLibraryIndexRevisionCallback,
    resetColdPassSession,
    activeLibraryPath: activeLibraryPath,
  })

  // Wire up the persistTextDocumentSource ref so autosave uses the tab manager version
  useEffect(() => {
    persistTextDocumentSourceRef.current = tabManager.persistTextDocumentSource
  }, [tabManager.persistTextDocumentSource])

  useEffect(() => {
    closeColdPassTabRef.current = () => { void tabManager.closeTabByPath(COLDPASS_WORKSPACE_TAB_PATH) }
  }, [tabManager])

  const {
    handleOpenFile,
    handleOpenFileFromView,
  } = useDocumentOpener({
    openDocumentInTab: tabManager.openDocumentInTab,
    resolveActiveLibraryAndroidDirectoryUri,
  })

  const activeLibraryForToolbar = activeLibrary ?? null

  const {
    handleHeaderActionClick,
    handleRailActionClick,
    handleExplorerToolClick,
  } = useToolbarActions({
    activeLibrary: activeLibraryForToolbar,
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
    activeLibrary: activeLibraryForToolbar,
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
  const handleInkMathPreferencesChange = useCallback<(value: Parameters<typeof setInkMathPreferences>[0]) => void>(
    (next) => dispatch(setInkMathPreferences(next)),
    [dispatch],
  )
  const handleTelegramPreferencesChange = useCallback<(value: Parameters<typeof setTelegramSettings>[0]) => void>(
    (next) => dispatch(setTelegramSettings(next)), [dispatch],
  )

  useLibraryConfigSync({
    activeLibrary: activeLibraryForToolbar,
    aiPreferences,
    explorerRefreshIntervalMs,
    inkMathPreferences,
    setAiPreferences: handleAiPreferencesChange,
    setExplorerRefreshIntervalMs: handleExplorerRefreshIntervalMsChange,
    setInkMathPreferences: handleInkMathPreferencesChange,
    telegramPreferences,
    setTelegramPreferences: handleTelegramPreferencesChange,
  })

  useTelegramAgentBridge({
    library: activeLibraryForToolbar,
    aiPreferences,
    telegram: telegramPreferences,
    onTelegramChange: handleTelegramPreferencesChange,
    onLibraryChanged: () => notifyLibraryTreeChanged(activeLibraryPath ?? undefined),
  })

  useLibrarySearch({
    treeNodes,
    treeNodesLibraryId: activeLibraryId,
    flatFileList,
  })

  useLibraryLinkCacheAutoRebuild()

  const handleWindowAction = useCallback((action: NotiaWindowAction) => { void controlWindow(action) }, [])
  const handleOpenLibraryManager = useCallback(() => { dispatch(setLibraryManagerOpen(true)) }, [dispatch])
  const handleOpenSettings = useCallback(() => { dispatch(setSettingsOpen(true)) }, [dispatch])
  const handleChatWorkspaceTreeChanged = useCallback((pathHint?: string) => {
    notifyLibraryTreeChanged(pathHint ?? activeLibraryPath ?? undefined)
  }, [activeLibraryPath, notifyLibraryTreeChanged])

  // Stable tabManager action selectors — avoid rebuilding the whole object on every render
  const {
    handleCloseTab,
    handleCloseActiveTab,
    handleCycleToNextTab,
    handleActivateTab,
    handleTextDocumentChange,
  } = tabManager

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
    [activeLibrary],
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
    agentCorpusPaths: rightPanelAgentCorpusPaths,
    agentScope: rightPanelAgentScope,
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
    graphChatHasExplicitSelection: graphChatSelectedPaths.length > 0,
    taskManagerActivePanelId,
    taskManagerChatContext,
  })

  // --- NotiaActions context value ---
  const actionsValue = useMemo(() => ({
    openFile: handleOpenFile,
    openFileFromView: handleOpenFileFromView,
    closeTab: handleCloseTab,
    closeActiveTab: handleCloseActiveTab,
    cycleToNextTab: handleCycleToNextTab,
    toggleFolder: handleToggleFolder,
    toggleSidebar: handleSidebarToggle,
    toggleRightChatPanel: handleRightChatPanelToggle,
    toggleTheme: handleThemeToggle,
    selectLibrary: handleSelectLibrary,
    activateTab: handleActivateTab,
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
    textDocumentChange: handleTextDocumentChange,
    chatWorkspaceTreeChanged: handleChatWorkspaceTreeChanged,
    windowAction: handleWindowAction,
    coldPassOpenCredentialModal: handleOpenColdPassCredentialModal,
    coldPassImportVault: handleImportColdPassVault,
    coldPassEditCredential: handleEditColdPassCredential,
    coldPassDeleteCredential: handleDeleteColdPassCredential,
  }), [
    handleOpenFile,
    handleOpenFileFromView,
    handleCloseTab,
    handleCloseActiveTab,
    handleCycleToNextTab,
    handleToggleFolder,
    handleSidebarToggle,
    handleRightChatPanelToggle,
    handleThemeToggle,
    handleSelectLibrary,
    handleActivateTab,
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
    handleTextDocumentChange,
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
            isMeetingContext={activeWorkspaceView === 'meeting'}
            agentCorpusPaths={rightPanelAgentCorpusPaths}
            agentScope={rightPanelAgentScope}
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
            rightPanelTransientSelectedPaths={graphChatSelectedPaths}
            onRightPanelTransientSelectedPathsChange={setGraphChatSelectedPaths}
            isAndroidRuntime={isAndroidRuntime}
          />
        </div>
      <NotiaModals
          onAiPreferencesChange={handleAiPreferencesChange}
          onExplorerRefreshIntervalMsChange={handleExplorerRefreshIntervalMsChange}
          onInkMathPreferencesChange={handleInkMathPreferencesChange}
        onTelegramPreferencesChange={handleTelegramPreferencesChange}
        backupPreferences={backupPreferences}
        onBackupPreferencesChange={(value) => dispatch(setBackupPreferences(value))}
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

export function NotiaMenu() {
  return <NotiaMenuComponent />
}
