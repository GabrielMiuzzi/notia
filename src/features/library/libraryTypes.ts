import type { NotiaLibrary } from '../../types/notia'

export interface LibraryState {
  libraries: NotiaLibrary[]
  selectedLibraryId: string | null
  /** The backend catalog was loaded; until then the list is empty. */
  catalogLoaded: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  lastTreeRefreshAt: number | null
  indexRevision: number
}