import { memo, useCallback, useDeferredValue, useMemo } from 'react'
import { Bot } from 'lucide-react'
import { shallowEqual } from 'react-redux'
import { useAppSelector } from '../../store/hooks'
import { selectIsSidebarOpen, selectActiveRailActionId } from '../../features/ui/uiSelectors'
import { selectLibraries, selectSelectedLibraryId, selectActiveLibraryName, selectActiveLibrary } from '../../features/library/librarySelectors'
import { selectIsSearchActive, selectPendingCreation, selectRenamingPath, selectSearchMatchedPaths, selectTreeNodes, selectLoadingFolderIds } from '../../features/documents/documentsSelectors'
import { LEFT_RAIL_ACTIONS } from '../../constants/notiaMenu'
import { useNotiaAction } from '../../context/notiaActions/useNotiaAction'
import { FileTree } from './FileTree'
import { IconRail } from './IconRail'
import { WorkspaceFooter } from './WorkspaceFooter'
import { applySearchMatchesToTree } from '../../engines/tree/applySearchMatchesToTree'

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
  )
}

export const NotiaSidebar = memo(NotiaSidebarComponent)
NotiaSidebar.displayName = 'NotiaSidebar'