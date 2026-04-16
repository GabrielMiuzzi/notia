import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { ExplorerState } from './explorerTypes'

const initialState: ExplorerState = {
  expandedFolderPaths: [],
  selectedNodePath: null,
  isVisible: true,
}

const explorerSlice = createSlice({
  name: 'explorer',
  initialState,
  reducers: {
    setExpandedFolderPaths(state, action: PayloadAction<string[]>) {
      state.expandedFolderPaths = action.payload
    },
    toggleExpandedFolderPath(state, action: PayloadAction<string>) {
      const index = state.expandedFolderPaths.indexOf(action.payload)
      if (index >= 0) {
        state.expandedFolderPaths.splice(index, 1)
      } else {
        state.expandedFolderPaths.push(action.payload)
      }
    },
    setSelectedNodePath(state, action: PayloadAction<string | null>) {
      state.selectedNodePath = action.payload
    },
    setExplorerVisible(state, action: PayloadAction<boolean>) {
      state.isVisible = action.payload
    },
    resetExplorer(state) {
      state.expandedFolderPaths = []
      state.selectedNodePath = null
    },
  },
})

export const {
  setExpandedFolderPaths,
  toggleExpandedFolderPath,
  setSelectedNodePath,
  setExplorerVisible,
  resetExplorer,
} = explorerSlice.actions

export default explorerSlice.reducer