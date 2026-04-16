import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { setSearchMatchedPaths, setIsSearchLoading } from '../../../features/documents/documentsSlice'
import { selectNormalizedSearchQuery } from '../../../features/documents/documentsSelectors'
import { selectIndexRevision, selectActiveLibrary } from '../../../features/library/librarySelectors'
import { searchIndexedLibraryFiles } from '../../../services/libraries/librarySearchGraphIndex'
import type { NotiaFileNode } from '../../../types/notia'

interface UseLibrarySearchParams {
  treeNodes: NotiaFileNode[]
  treeNodesLibraryId: string | null
}

export function useLibrarySearch({ treeNodes, treeNodesLibraryId }: UseLibrarySearchParams) {
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
        libraryPath: activeLibrary.path,
        treeNodes,
        query: normalizedSearchQuery,
        androidDirectoryUri: activeLibrary.androidTreeUri,
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
  }, [activeLibrary, normalizedSearchQuery, treeNodes, libraryIndexRevision, treeNodesLibraryId, dispatch])
}