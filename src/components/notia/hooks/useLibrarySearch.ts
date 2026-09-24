import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { setSearchMatchedPaths, setIsSearchLoading } from '../../../features/documents/documentsSlice'
import { selectNormalizedSearchQuery } from '../../../features/documents/documentsSelectors'
import { selectIndexRevision, selectActiveLibrary } from '../../../features/library/librarySelectors'
import { searchIndexedLibraryFiles } from '../../../services/libraries/librarySearchGraphIndex'
import type { NotiaFileNode, NotiaFlatFileEntry } from '../../../types/notia'

interface UseLibrarySearchParams {
  treeNodes: NotiaFileNode[]
  treeNodesLibraryId: string | null
  flatFileList: NotiaFlatFileEntry[]
}

export function useLibrarySearch({ treeNodes, treeNodesLibraryId, flatFileList }: UseLibrarySearchParams) {
  const dispatch = useAppDispatch()
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const normalizedSearchQuery = useAppSelector(selectNormalizedSearchQuery)
  const libraryIndexRevision = useAppSelector(selectIndexRevision)

  useEffect(() => {
    if (!activeLibrary || normalizedSearchQuery.length === 0) {
      dispatch(setSearchMatchedPaths([]))
      dispatch(setIsSearchLoading(false))
      return
    }

    if (treeNodesLibraryId !== activeLibrary.id) {
      dispatch(setSearchMatchedPaths([]))
      dispatch(setIsSearchLoading(false))
      return
    }

    let isCurrent = true
    dispatch(setIsSearchLoading(true))

    const timeoutId = window.setTimeout(() => {
      void searchIndexedLibraryFiles({
        libraryId: activeLibrary.id,
        query: normalizedSearchQuery,
        revision: libraryIndexRevision,
      })
        .then((paths: string[]) => {
          if (!isCurrent) {
            return
          }
          dispatch(setSearchMatchedPaths(paths))
        })
        .finally(() => {
          if (!isCurrent) {
            return
          }
          dispatch(setIsSearchLoading(false))
        })
    }, 220)

    return () => {
      isCurrent = false
      window.clearTimeout(timeoutId)
    }
  }, [activeLibrary, normalizedSearchQuery, treeNodes, flatFileList, libraryIndexRevision, treeNodesLibraryId, dispatch])
}
