import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from '../../store/index'
import type { NotiaLibrary } from '../../types/notia'

export const selectLibraries = (state: RootState) => state.library.libraries
export const selectSelectedLibraryId = (state: RootState) => state.library.selectedLibraryId
export const selectLibraryStatus = (state: RootState) => state.library.status
export const selectLibraryError = (state: RootState) => state.library.error
export const selectIndexRevision = (state: RootState) => state.library.indexRevision

export const selectActiveLibrary = createSelector(
  [(state: RootState) => state.library.libraries, (state: RootState) => state.library.selectedLibraryId],
  (libraries, selectedLibraryId): NotiaLibrary | null => {
    return libraries.find((library) => library.id === selectedLibraryId) ?? null
  },
)

export const selectActiveLibraryName = createSelector(
  [(state: RootState) => state.library.libraries, (state: RootState) => state.library.selectedLibraryId],
  (libraries, selectedLibraryId): string => {
    return libraries.find((lib) => lib.id === selectedLibraryId)?.name ?? 'Sin librerias'
  },
)

export const selectActiveLibraryPath = createSelector(
  [selectActiveLibrary],
  (activeLibrary): string | null => activeLibrary?.path ?? null,
)

export const selectActiveLibraryAndroidTreeUri = createSelector(
  [selectActiveLibrary],
  (activeLibrary): string | null => activeLibrary?.androidTreeUri ?? null,
)
