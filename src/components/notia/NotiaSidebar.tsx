import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react'
import { Search } from 'lucide-react'
import { shallowEqual } from 'react-redux'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { selectIsSidebarOpen, selectActiveRailActionId, selectIsSearchMenuOpen } from '../../features/ui/uiSelectors'
import { closeSearchMenu } from '../../features/ui/uiSlice'
import { selectLibraries, selectSelectedLibraryId, selectActiveLibraryName, selectActiveLibrary } from '../../features/library/librarySelectors'
import { selectIsSearchActive, selectIsSearchLoading, selectPendingCreation, selectRenamingPath, selectSearchMatchedCount, selectSearchMatchedPaths, selectSearchQuery, selectTreeNodes, selectLoadingFolderIds, selectFolderLoadError } from '../../features/documents/documentsSelectors'
import { setSearchQuery } from '../../features/documents/documentsSlice'
import { LEFT_RAIL_GROUPS, TOP_TOOLBAR_ACTIONS } from '../../constants/notiaMenu'
import { backendSupports } from '../../services/transport'
import { useNotiaAction } from '../../context/notiaActions/useNotiaAction'
import { FileTree } from './FileTree'
import { IconRail } from './IconRail'
import { WorkspaceFooter } from './WorkspaceFooter'
import { applySearchMatchesToTree } from '../../engines/tree/applySearchMatchesToTree'

/** Meeting records with the microphone of the computer running Notia, so a
 * browser connected to a server does not offer it. */
const railGroups = backendSupports('start_speech_session')
  ? LEFT_RAIL_GROUPS
  : LEFT_RAIL_GROUPS.map((group) => group.filter((action) => action.id !== 'meeting'))

function ExplorerSearch() {
  const dispatch = useAppDispatch()
  const query = useAppSelector(selectSearchQuery)
  const matchedCount = useAppSelector(selectSearchMatchedCount)
  const isLoading = useAppSelector(selectIsSearchLoading)
  const isFocusRequested = useAppSelector(selectIsSearchMenuOpen)
  const inputRef = useRef<HTMLInputElement>(null)

  // "Ir a archivo" and similar entry points ask the explorer to focus search.
  useEffect(() => {
    if (!isFocusRequested) {
      return
    }
    inputRef.current?.focus()
    inputRef.current?.select()
    dispatch(closeSearchMenu())
  }, [dispatch, isFocusRequested])

  const hasQuery = query.trim().length > 0
  return (
    <div className="notia-explorer-search-block">
      <label className="notia-explorer-search">
        <Search size={15} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Buscar archivos"
          aria-label="Buscar en la librería por título o contenido"
          onChange={(event) => dispatch(setSearchQuery(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && hasQuery) {
              event.preventDefault()
              dispatch(setSearchQuery(''))
            }
          }}
        />
      </label>
      {hasQuery ? (
        <div className="notia-explorer-search-meta" role="status" aria-live="polite">
          {isLoading ? 'Buscando…' : `${matchedCount} coincidencia${matchedCount === 1 ? '' : 's'}`}
        </div>
      ) : null}
    </div>
  )
}

function NotiaSidebarComponent() {
  const isSidebarOpen = useAppSelector(selectIsSidebarOpen)
  const activeRailActionId = useAppSelector(selectActiveRailActionId)
  const libraries = useAppSelector(selectLibraries)
  const activeLibraryId = useAppSelector(selectSelectedLibraryId)
  const libraryName = useAppSelector(selectActiveLibraryName)
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const isSearchActive = useAppSelector(selectIsSearchActive)
  const pendingCreation = useAppSelector(selectPendingCreation, shallowEqual)
  const renamingPath = useAppSelector(selectRenamingPath)
  const searchMatchedPaths = useAppSelector(selectSearchMatchedPaths)
  const treeNodes = useAppSelector(selectTreeNodes)
  const loadingFolderIdsList = useAppSelector(selectLoadingFolderIds)
  const folderLoadError = useAppSelector(selectFolderLoadError)

  const rootPath = activeLibrary?.path ?? null

  const handleToggleFolder = useNotiaAction('toggleFolder')
  const handleOpenFileFromView = useNotiaAction('openFileFromView')
  const handleSubmitPendingCreation = useNotiaAction('submitPendingCreation')
  const handleCancelPendingCreation = useNotiaAction('cancelPendingCreation')
  const handleRenameSubmit = useNotiaAction('renameSubmit')
  const handleCancelRename = useNotiaAction('cancelRename')
  const handleNodeContextMenu = useNotiaAction('nodeContextMenu')
  const handleEmptyContextMenu = useNotiaAction('emptyContextMenu')
  const handleMoveNode = useNotiaAction('moveNode')
  const handleRailActionClick = useNotiaAction('railActionClick')
  const handleToggleSidebar = useNotiaAction('toggleSidebar')
  const handleExplorerToolClick = useNotiaAction('explorerToolClick')
  const handleSelectLibrary = useNotiaAction('selectLibrary')
  const handleOpenLibraryManager = useNotiaAction('openLibraryManager')
  const handleOpenSettings = useNotiaAction('openSettings')

  const submitPendingCreation = useCallback((name: string) => {
    void handleSubmitPendingCreation(name)
  }, [handleSubmitPendingCreation])

  const submitRename = useCallback((path: string, name: string) => {
    void handleRenameSubmit(path, name)
  }, [handleRenameSubmit])

  const deferredSearchMatchedPaths = useDeferredValue(searchMatchedPaths)
  const deferredSearchMatchedPathSet = useMemo(
    () => new Set(deferredSearchMatchedPaths),
    [deferredSearchMatchedPaths],
  )
  const displayedTreeNodes = useMemo(
    () => applySearchMatchesToTree(treeNodes, deferredSearchMatchedPathSet, isSearchActive),
    [deferredSearchMatchedPathSet, isSearchActive, treeNodes],
  )
  const loadingFolderIdSet = useMemo(
    () => new Set<string>(loadingFolderIdsList),
    [loadingFolderIdsList],
  )

  return (
    <aside className={`notia-sidebar ${isSidebarOpen ? 'notia-sidebar--open' : 'notia-sidebar--closed'}`} data-notia-prevent-menu-close>
      <IconRail
        groups={railGroups}
        activeActionId={activeRailActionId}
        isExplorerOpen={isSidebarOpen}
        onActionClick={handleRailActionClick}
        onToggleExplorer={handleToggleSidebar}
        onOpenSettings={handleOpenSettings}
      />
      {isSidebarOpen ? (
        <div className="notia-panel" aria-label="Archivos" role="region" data-notia-prevent-menu-close>
          <div className="notia-panel-header">
            <span className="notia-panel-title">Archivos</span>
            <div className="notia-panel-actions">
              {TOP_TOOLBAR_ACTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className="notia-panel-action"
                  aria-label={label}
                  title={label}
                  disabled={!activeLibrary}
                  onClick={() => handleExplorerToolClick(id)}
                >
                  <Icon size={16} strokeWidth={1.75} />
                </button>
              ))}
            </div>
          </div>
          <ExplorerSearch />
          <FileTree
            nodes={displayedTreeNodes}
            rootPath={rootPath}
            isSearchActive={isSearchActive}
            searchMatchedFilePaths={deferredSearchMatchedPathSet}
            onToggleFolder={handleToggleFolder}
            onOpenFile={handleOpenFileFromView}
            pendingCreation={pendingCreation}
            onSubmitPendingCreation={submitPendingCreation}
            onCancelPendingCreation={handleCancelPendingCreation}
            renamingPath={renamingPath}
            onSubmitRename={submitRename}
            onCancelRename={handleCancelRename}
            onNodeContextMenu={handleNodeContextMenu}
            onEmptyContextMenu={handleEmptyContextMenu}
            onMoveNode={handleMoveNode}
            loadingFolderIds={loadingFolderIdSet}
            folderLoadError={folderLoadError}
          />
          <WorkspaceFooter
            name={libraryName}
            libraries={libraries}
            activeLibraryId={activeLibraryId}
            onSelectLibrary={handleSelectLibrary}
            onOpenLibraryManager={handleOpenLibraryManager}
          />
        </div>
      ) : null}
    </aside>
  )
}

export const NotiaSidebar = memo(NotiaSidebarComponent)
NotiaSidebar.displayName = 'NotiaSidebar'
