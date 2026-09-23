import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { invalidateMermaidCache } from '../../modules/mermaid/engines/mermaidEngine'
import type { NotiaLibrary } from '../../types/notia'
import type { LibraryState } from './libraryTypes'

// The catalog lives in the backend; `useLibraryCatalogPersistence` hydrates
// this slice on start and stores every change. Reducers stay pure.
const initialState: LibraryState = {
  libraries: [],
  selectedLibraryId: null,
  catalogLoaded: false,
  status: 'idle',
  error: null,
  lastTreeRefreshAt: null,
  indexRevision: 0,
}

const librarySlice = createSlice({
  name: 'library',
  initialState,
  reducers: {
    hydrateLibraryCatalog(state, action: PayloadAction<{ libraries: NotiaLibrary[]; selectedLibraryId: string | null }>) {
      state.libraries = action.payload.libraries
      state.selectedLibraryId = action.payload.selectedLibraryId
      state.catalogLoaded = true
    },
    addLibrary(state, action: PayloadAction<NotiaLibrary>) {
      state.libraries.push(action.payload)
    },
    updateLibraryAndroidTreeUri(state, action: PayloadAction<{ libraryId: string; androidTreeUri: string }>) {
      const library = state.libraries.find((item) => item.id === action.payload.libraryId)
      if (library) {
        library.androidTreeUri = action.payload.androidTreeUri
      }
    },
    removeLibraryById(state, action: PayloadAction<string>) {
      state.libraries = state.libraries.filter((item) => item.id !== action.payload)
    },
    setSelectedLibraryId(state, action: PayloadAction<string | null>) {
      const changed = state.selectedLibraryId !== action.payload
      state.selectedLibraryId = action.payload
      if (changed) {
        invalidateMermaidCache()
      }
    },
    setLibraryStatus(state, action: PayloadAction<LibraryState['status']>) {
      state.status = action.payload
    },
    setLibraryError(state, action: PayloadAction<string | null>) {
      state.error = action.payload
    },
    bumpIndexRevision(state) {
      state.indexRevision += 1
    },
    setLastTreeRefreshAt(state, action: PayloadAction<number>) {
      state.lastTreeRefreshAt = action.payload
    },
  },
})

export const {
  hydrateLibraryCatalog,
  addLibrary,
  updateLibraryAndroidTreeUri,
  removeLibraryById,
  setSelectedLibraryId,
  setLibraryStatus,
  setLibraryError,
  bumpIndexRevision,
  setLastTreeRefreshAt,
} = librarySlice.actions

export default librarySlice.reducer