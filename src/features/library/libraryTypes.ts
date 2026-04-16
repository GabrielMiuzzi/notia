import type { NotiaLibrary } from '../../types/notia'

export interface LibraryState {
  libraries: NotiaLibrary[]
  selectedLibraryId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  lastTreeRefreshAt: number | null
  indexRevision: number
}