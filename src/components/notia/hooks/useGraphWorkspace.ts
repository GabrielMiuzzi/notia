import { useEffect, useMemo, useState } from 'react'
import { useAppSelector } from '../../../store/hooks'
import { selectIndexRevision } from '../../../features/library/librarySelectors'
import { useLibraryGraphData } from '../../../hooks/useLibraryGraphData'
import type { NotiaLibrary } from '../../../types/notia'

interface UseGraphWorkspaceParams {
  activeLibrary: NotiaLibrary | null
  activeWorkspaceView: 'graph' | 'chat' | 'task-manager' | 'coldpass' | 'meeting' | 'finance' | 'calendar' | 'multichat' | 'documents'
}

export function useGraphWorkspace({
  activeLibrary,
  activeWorkspaceView,
}: UseGraphWorkspaceParams) {
  const graphRevision = useAppSelector(selectIndexRevision)
  const [graphChatSelectedPaths, setGraphChatSelectedPaths] = useState<string[]>([])

  const isGraphViewActive = activeWorkspaceView === 'graph'
  const { graphModel, searchGraph, isGraphLoading } = useLibraryGraphData({
    enabled: isGraphViewActive,
    libraryId: activeLibrary?.id,
    libraryPath: activeLibrary?.path ?? null,
    revision: graphRevision,
  })

  const graphChatAvailablePaths = useMemo(
    () => graphModel.nodes.map((node) => node.path),
    [graphModel.nodes],
  )

  const graphChatEffectivePaths = useMemo(
    () => (graphChatSelectedPaths.length > 0 ? graphChatSelectedPaths : graphChatAvailablePaths),
    [graphChatAvailablePaths, graphChatSelectedPaths],
  )

  const graphChatContextSummary = useMemo(() => {
    if (activeWorkspaceView !== 'graph') {
      return null
    }

    if (graphChatSelectedPaths.length === 0) {
      return graphChatAvailablePaths.length > 0
        ? `Graph View: biblioteca completa (${graphChatAvailablePaths.length} archivos, RAG)`
        : null
    }

    return `Graph View: ${graphChatSelectedPaths.length} archivo${graphChatSelectedPaths.length === 1 ? '' : 's'} seleccionado${graphChatSelectedPaths.length === 1 ? '' : 's'}`
  }, [activeWorkspaceView, graphChatAvailablePaths.length, graphChatSelectedPaths.length])

  useEffect(() => {
    const availablePathSet = new Set(graphChatAvailablePaths)
    setGraphChatSelectedPaths((current) => {
      const next = current.filter((path) => availablePathSet.has(path))
      return next.length === current.length ? current : next
    })
  }, [graphChatAvailablePaths])

  return {
    graphChatContextSummary,
    graphChatEffectivePaths,
    graphChatSelectedPaths,
    graphModel,
    searchGraph,
    isGraphLoading,
    isGraphViewActive,
    setGraphChatSelectedPaths,
  }
}
