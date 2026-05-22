import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface MermaidViewerState {
  theme: string
  gridEnabled: boolean
  roughEnabled: boolean
  panZoomEnabled: boolean
  zoom: number
  panX: number
  panY: number
}

const STORAGE_KEY = 'notia:mermaid-viewer-preferences:v1'

function loadState(): MermaidViewerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MermaidViewerState>
      return {
        theme: parsed.theme ?? 'dark',
        gridEnabled: parsed.gridEnabled ?? true,
        roughEnabled: parsed.roughEnabled ?? false,
        panZoomEnabled: parsed.panZoomEnabled ?? true,
        zoom: parsed.zoom ?? 1,
        panX: parsed.panX ?? 0,
        panY: parsed.panY ?? 0,
      }
    }
  } catch {
    // ignore
  }
  return {
    theme: 'dark',
    gridEnabled: true,
    roughEnabled: false,
    panZoomEnabled: true,
    zoom: 1,
    panX: 0,
    panY: 0,
  }
}

function saveState(state: MermaidViewerState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

const initialState: MermaidViewerState = loadState()

const mermaidViewerSlice = createSlice({
  name: 'mermaidViewer',
  initialState,
  reducers: {
    setMermaidTheme: (state, action: PayloadAction<string>) => {
      state.theme = action.payload
      saveState(state)
    },
    toggleMermaidGrid: (state) => {
      state.gridEnabled = !state.gridEnabled
      saveState(state)
    },
    toggleMermaidRough: (state) => {
      state.roughEnabled = !state.roughEnabled
      saveState(state)
    },
    toggleMermaidPanZoom: (state) => {
      state.panZoomEnabled = !state.panZoomEnabled
      saveState(state)
    },
    setMermaidZoom: (state, action: PayloadAction<number>) => {
      state.zoom = action.payload
      saveState(state)
    },
    setMermaidPan: (state, action: PayloadAction<{ x: number; y: number }>) => {
      state.panX = action.payload.x
      state.panY = action.payload.y
      saveState(state)
    },
    resetMermaidView: (state) => {
      state.zoom = 1
      state.panX = 0
      state.panY = 0
      saveState(state)
    },
  },
})

export const {
  setMermaidTheme,
  toggleMermaidGrid,
  toggleMermaidRough,
  toggleMermaidPanZoom,
  setMermaidZoom,
  setMermaidPan,
  resetMermaidView,
} = mermaidViewerSlice.actions

export default mermaidViewerSlice.reducer
