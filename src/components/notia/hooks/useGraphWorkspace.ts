import { useEffect, useMemo, useState } from 'react'
import { useAppSelector } from '../../../store/hooks'
import { selectIndexRevision } from '../../../features/library/librarySelectors'
import { selectFlatFileList } from '../../../features/documents/documentsSelectors'
import { useLibraryGraphData } from '../../../hooks/useLibraryGraphData'
import type { NotiaFileNode, NotiaLibrary } from '../../../types/notia'

interface UseGraphWorkspaceParams {
  activeLibrary: NotiaLibrary | null
  activeWorkspaceView: 'graph' | 'chat' | 'task-manager' | 'coldpass' | 'documents'
  treeNodes: NotiaFileNode[]
}

export function useGraphWorkspace({
  activeLibrary,
  activeWorkspaceView,
  treeNodes,
}: UseGraphWorkspaceParams) {
  const graphRevision = useAppSelector(selectIndexRevision)
  const flatFileList = useAppSelector(selectFlatFileList)
  const [graphChatSelectedPaths, setGraphChatSelectedPaths] = useState<string[]>([])

  const isGraphViewActive = activeWorkspaceView === 'graph'
  const { graphModel, graphSourcesByPath, isGraphLoading } = useLibraryGraphData({
    enabled: isGraphViewActive,
    libraryPath: activeLibrary?.path ?? null,
    libraryAndroidTreeUri: activeLibrary?.androidTreeUri,
    rootPath: activeLibrary?.path ?? null,
    treeNodes,
    flatFileList,
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
        ? `Graph View: toda la libreria del grafo (${graphChatAvailablePaths.length} archivos)`
        : 'Graph View: no hay archivos disponibles en el grafo'
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
    graphSourcesByPath,
    isGraphLoading,
    isGraphViewActive,
    setGraphChatSelectedPaths,
  }
}
