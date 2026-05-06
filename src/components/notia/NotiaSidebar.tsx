import { memo, useDeferredValue, useMemo } from 'react'
import { Bot } from 'lucide-react'
import { shallowEqual } from 'react-redux'
import { useAppSelector } from '../../store/hooks'
import { selectIsSidebarOpen, selectActiveRailActionId } from '../../features/ui/uiSelectors'
import { selectLibraries, selectSelectedLibraryId, selectActiveLibraryName, selectActiveLibrary } from '../../features/library/librarySelectors'
import { selectIsSearchActive, selectPendingCreation, selectRenamingPath, selectSearchMatchedPaths, selectTreeNodes, selectLoadingFolderIds } from '../../features/documents/documentsSelectors'
import { LEFT_RAIL_ACTIONS } from '../../constants/notiaMenu'
import { useNotiaActions } from '../../context/notiaActions/NotiaActionsContext'
import { FileTree } from './FileTree'
import { IconRail } from './IconRail'
import { WorkspaceFooter } from './WorkspaceFooter'
import { applySearchMatchesToTree } from '../../engines/tree/applySearchMatchesToTree'

function NotiaSidebarComponent() {
  const actions = useNotiaActions()

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
          onActionClick={actions.railActionClick}
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
              onToggleFolder={actions.toggleFolder}
              onOpenFile={actions.openFileFromView}
              pendingCreation={pendingCreation}
              onSubmitPendingCreation={(name) => { void actions.submitPendingCreation(name) }}
              onCancelPendingCreation={actions.cancelPendingCreation}
              renamingPath={renamingPath}
              onSubmitRename={(path, name) => { void actions.renameSubmit(path, name) }}
              onCancelRename={actions.cancelRename}
              onNodeContextMenu={actions.nodeContextMenu}
              onEmptyContextMenu={actions.emptyContextMenu}
              onMoveNode={actions.moveNode}
              loadingFolderIds={loadingFolderIdSet}
            />
            <div data-notia-prevent-menu-close>
              <WorkspaceFooter
                name={libraryName}
                icon={Bot}
                libraries={libraries}
                activeLibraryId={activeLibraryId}
                onSelectLibrary={actions.selectLibrary}
                onOpenLibraryManager={actions.openLibraryManager}
                onOpenSettings={actions.openSettings}
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