import type { RootState } from '../../store/index'

export const selectExpandedFolderPaths = (state: RootState) => state.explorer.expandedFolderPaths
export const selectSelectedNodePath = (state: RootState) => state.explorer.selectedNodePath
export const selectIsExplorerVisible = (state: RootState) => state.explorer.isVisible