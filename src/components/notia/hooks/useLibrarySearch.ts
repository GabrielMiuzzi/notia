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
      // Use flatFileList on Android when available, fall back to treeNodes
      const hasFlatFileList = flatFileList.length > 0
      void searchIndexedLibraryFiles({
        libraryPath: activeLibrary.path,
        treeNodes: hasFlatFileList ? undefined : treeNodes,
        flatFileList: hasFlatFileList ? flatFileList : undefined,
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
  }, [activeLibrary, normalizedSearchQuery, treeNodes, flatFileList, libraryIndexRevision, treeNodesLibraryId, dispatch])
}