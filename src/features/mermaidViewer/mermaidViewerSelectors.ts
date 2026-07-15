import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from '../../store/index'

export const selectMermaidTheme = (state: RootState) => state.mermaidViewer.theme
export const selectMermaidGridEnabled = (state: RootState) => state.mermaidViewer.gridEnabled
export const selectMermaidRoughEnabled = (state: RootState) => state.mermaidViewer.roughEnabled
export const selectMermaidPanZoomEnabled = (state: RootState) => state.mermaidViewer.panZoomEnabled
export const selectMermaidZoom = (state: RootState) => state.mermaidViewer.zoom
export const selectMermaidPan = createSelector(
  [(state: RootState) => state.mermaidViewer.panX, (state: RootState) => state.mermaidViewer.panY],
  (panX, panY) => ({ x: panX, y: panY }),
)

export const selectMermaidViewerState = createSelector(
  [
    (state: RootState) => state.mermaidViewer.theme,
    (state: RootState) => state.mermaidViewer.gridEnabled,
    (state: RootState) => state.mermaidViewer.roughEnabled,
    (state: RootState) => state.mermaidViewer.panZoomEnabled,
    (state: RootState) => state.mermaidViewer.zoom,
    (state: RootState) => state.mermaidViewer.panX,
    (state: RootState) => state.mermaidViewer.panY,
  ],
  (theme, gridEnabled, roughEnabled, panZoomEnabled, zoom, panX, panY) => ({
    theme,
    gridEnabled,
    roughEnabled,
    panZoomEnabled,
    zoom,
    panX,
    panY,
  }),
)
