import { useEffect, useRef } from 'react'
import { useAppSelector } from '../../../store/hooks'
import { selectIndexRevision } from '../../../features/library/librarySelectors'
import { selectFlatFileList, selectTreeNodes } from '../../../features/documents/documentsSelectors'
import { selectActiveLibrary } from '../../../features/library/librarySelectors'
import { scheduleLibraryLinkCacheRebuild } from '../../../services/libraries/libraryLinkCacheSchedule'
import { readLibraryLinkCache } from '../../../services/libraries/libraryLinkCacheRuntime'

/**
 * Automatically schedules a linkCache.md rebuild whenever the library
 * tree structure or index revision changes. The scheduler debounces
 * rebuilds so rapid changes (e.g. multiple saves) are collapsed.
 */
export function useLibraryLinkCacheAutoRebuild(): void {
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const treeNodes = useAppSelector(selectTreeNodes)
  const flatFileList = useAppSelector(selectFlatFileList)
  const revision = useAppSelector(selectIndexRevision)
  const latestTreeNodesRef = useRef(treeNodes)
  const latestFlatFileListRef = useRef(flatFileList)

  useEffect(() => {
    latestTreeNodesRef.current = treeNodes
    latestFlatFileListRef.current = flatFileList
  }, [treeNodes, flatFileList])

  useEffect(() => {
    if (!activeLibrary?.path) {
      return
    }

    scheduleLibraryLinkCacheRebuild({
      libraryPath: activeLibrary.path,
      treeNodes: latestTreeNodesRef.current,
      flatFileList: latestFlatFileListRef.current.length > 0 ? latestFlatFileListRef.current : undefined,
      androidDirectoryUri: activeLibrary.androidTreeUri,
    })
  }, [
    activeLibrary?.path,
    activeLibrary?.androidTreeUri,
    revision,
  ])

  // --- Ensure linkCache exists when a library becomes active ---
  useEffect(() => {
    if (!activeLibrary?.path) {
      return
    }

    const libraryPath = activeLibrary.path
    const androidDirectoryUri = activeLibrary.androidTreeUri

    let cancelled = false

    const ensureCacheExists = async () => {
      // Wait a short delay so the initial tree load settles first
      await new Promise((resolve) => setTimeout(resolve, 800))
      if (cancelled) return

      try {
        const existingCache = await readLibraryLinkCache(libraryPath, { androidDirectoryUri })
        if (existingCache) return

        // Cache does not exist — schedule an urgent rebuild
        scheduleLibraryLinkCacheRebuild({
          libraryPath,
          treeNodes: latestTreeNodesRef.current,
          flatFileList: latestFlatFileListRef.current.length > 0 ? latestFlatFileListRef.current : undefined,
          androidDirectoryUri,
        })
      } catch {
        // Silently ignore read errors; the next periodic rebuild will try again
      }
    }

    void ensureCacheExists()

    return () => {
      cancelled = true
    }
  }, [
    activeLibrary?.path,
    activeLibrary?.androidTreeUri,
  ])
}
