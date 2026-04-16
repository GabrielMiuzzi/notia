import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { loadLibraries, saveLibraries, loadActiveLibraryId, saveActiveLibraryId } from '../../services/libraries/libraryStorage'
import type { NotiaLibrary } from '../../types/notia'
import type { LibraryState } from './libraryTypes'

function findInitialActiveLibrary(libraries: NotiaLibrary[]): string | null {
  if (libraries.length === 0) {
    return null
  }

  const savedId = loadActiveLibraryId()
  if (savedId && libraries.some((library) => library.id === savedId)) {
    return savedId
  }

  return libraries[0].id
}

const initialLibraries = loadLibraries()

const initialState: LibraryState = {
  libraries: initialLibraries,
  selectedLibraryId: findInitialActiveLibrary(initialLibraries),
  status: 'idle',
  error: null,
  lastTreeRefreshAt: null,
  indexRevision: 0,
}

const librarySlice = createSlice({
  name: 'library',
  initialState,
  reducers: {
    setLibraries(state, action: PayloadAction<NotiaLibrary[]>) {
      state.libraries = action.payload
      saveLibraries(action.payload)
    },
    addLibrary(state, action: PayloadAction<NotiaLibrary>) {
      state.libraries.push(action.payload)
      saveLibraries(state.libraries)
    },
    updateLibraryAndroidTreeUri(state, action: PayloadAction<{ libraryId: string; androidTreeUri: string }>) {
      const library = state.libraries.find((item) => item.id === action.payload.libraryId)
      if (library) {
        library.androidTreeUri = action.payload.androidTreeUri
        saveLibraries(state.libraries)
      }
    },
    removeLibraryById(state, action: PayloadAction<string>) {
      state.libraries = state.libraries.filter((item) => item.id !== action.payload)
      saveLibraries(state.libraries)
    },
    setSelectedLibraryId(state, action: PayloadAction<string | null>) {
      state.selectedLibraryId = action.payload
      saveActiveLibraryId(action.payload)
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
  setLibraries,
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