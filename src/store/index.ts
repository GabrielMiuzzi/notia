import { configureStore } from '@reduxjs/toolkit'
import uiReducer from '../features/ui/uiSlice'
import preferencesReducer from '../features/preferences/preferencesSlice'
import libraryReducer from '../features/library/librarySlice'
import documentsReducer from '../features/documents/documentsSlice'
import explorerReducer from '../features/explorer/explorerSlice'
import mermaidViewerReducer from '../features/mermaidViewer/mermaidViewerSlice'

export const store = configureStore({
  reducer: {
    ui: uiReducer,
    preferences: preferencesReducer,
    library: libraryReducer,
    documents: documentsReducer,
    explorer: explorerReducer,
    mermaidViewer: mermaidViewerReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch