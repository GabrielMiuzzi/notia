import { invoke } from '@tauri-apps/api/core'

export interface SearchIndexedLibraryFilesParams {
  libraryPath: string
  libraryId: string
  query: string
  /** Index revision; a new value makes the backend re-read the sources. */
  revision: number
}

/**
 * Explorer search over names, paths and Markdown contents. The backend keeps
 * the index (the same one Graph View uses) and returns logical paths, which
 * are mapped to the visible library path for the tree.
 */
export async function searchIndexedLibraryFiles({
  libraryPath,
  libraryId,
  query,
  revision,
}: SearchIndexedLibraryFilesParams): Promise<string[]> {
  if (!query.trim()) {
    return []
  }
  try {
    const logicalPaths = await invoke<string[]>('backend_library_search', {
      payload: { libraryId, revision, query },
    })
    const root = libraryPath.replace(/[\\/]+$/, '')
    return logicalPaths.map((logicalPath) => `${root}/${logicalPath}`)
  } catch (error) {
    console.warn('[notia] library search failed', error)
    return []
  }
}
