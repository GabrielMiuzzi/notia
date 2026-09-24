import { callBackend } from '../transport'

export interface SearchIndexedLibraryFilesParams {
  libraryId: string
  query: string
  /** Index revision; a new value makes the backend re-read the sources. */
  revision: number
}

/**
 * Explorer search over names, paths and Markdown contents. The backend keeps
 * the index (the same one Graph View uses) and returns the paths the
 * explorer shows.
 */
export async function searchIndexedLibraryFiles({
  libraryId,
  query,
  revision,
}: SearchIndexedLibraryFilesParams): Promise<string[]> {
  if (!query.trim()) {
    return []
  }
  try {
    return await callBackend<string[]>('backend_library_search', {
      payload: { libraryId, revision, query },
    })
  } catch (error) {
    console.warn('[notia] library search failed', error)
    return []
  }
}
