import { useEffect, useMemo, useState } from 'react'
import { buildLibraryGraphModel, collectMarkdownFilePaths } from '../engines/graph/libraryGraphEngine'
import { readLibraryFileContent } from '../services/libraries/libraryDocumentRuntime'
import type { NotiaFileNode } from '../types/notia'

const MARKDOWN_SIGNATURE_SEPARATOR = '\u0001'
const GRAPH_MARKDOWN_READ_BATCH_SIZE = 6

interface UseLibraryGraphDataParams {
  enabled?: boolean
  libraryPath: string | null
  rootPath: string | null
  treeNodes: NotiaFileNode[]
  revision: number
}

async function loadMarkdownSourcesByPath(markdownPaths: string[]): Promise<Record<string, string>> {
  const nextMarkdownSourcesByPath: Record<string, string> = {}

  for (let index = 0; index < markdownPaths.length; index += GRAPH_MARKDOWN_READ_BATCH_SIZE) {
    const batchPaths = markdownPaths.slice(index, index + GRAPH_MARKDOWN_READ_BATCH_SIZE)
    const batchEntries = await Promise.all(
      batchPaths.map(async (pathValue) => {
        const result = await readLibraryFileContent(pathValue)
        if (!result.ok) {
          return null
        }

        return { path: pathValue, content: result.content }
      }),
    )

    for (const entry of batchEntries) {
      if (!entry) {
        continue
      }

      nextMarkdownSourcesByPath[entry.path] = entry.content
    }
  }

  return nextMarkdownSourcesByPath
}

export function useLibraryGraphData({
  enabled = true,
  libraryPath,
  rootPath,
  treeNodes,
  revision,
}: UseLibraryGraphDataParams) {
  const [markdownSourcesByPath, setMarkdownSourcesByPath] = useState<Record<string, string>>({})
  const [loadedSignature, setLoadedSignature] = useState('')

  const markdownPathSignature = useMemo(() => {
    if (!enabled) {
      return ''
    }

    const markdownPaths = collectMarkdownFilePaths(treeNodes).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' }),
    )
    return markdownPaths.join(MARKDOWN_SIGNATURE_SEPARATOR)
  }, [enabled, treeNodes])

  useEffect(() => {
    if (!enabled) {
      return
    }

    if (!libraryPath || !markdownPathSignature) {
      return
    }

    const requestSignature = `${libraryPath}::${markdownPathSignature}::${revision}`
    let isCurrent = true
    const markdownPaths = markdownPathSignature.split(MARKDOWN_SIGNATURE_SEPARATOR)

    void loadMarkdownSourcesByPath(markdownPaths)
      .then((nextMarkdownSourcesByPath) => {
        if (!isCurrent) {
          return
        }

        setMarkdownSourcesByPath(nextMarkdownSourcesByPath)
      })
      .finally(() => {
        if (!isCurrent) {
          return
        }
        setLoadedSignature(requestSignature)
      })

    return () => {
      isCurrent = false
    }
  }, [enabled, libraryPath, markdownPathSignature, revision])

  const currentSignature =
    enabled && libraryPath && markdownPathSignature
      ? `${libraryPath}::${markdownPathSignature}::${revision}`
      : ''
  const isCurrentSignatureLoaded = Boolean(currentSignature) && loadedSignature === currentSignature

  const effectiveMarkdownSourcesByPath = useMemo(() => {
    if (!enabled || !isCurrentSignatureLoaded) {
      return {}
    }

    return markdownSourcesByPath
  }, [enabled, isCurrentSignatureLoaded, markdownSourcesByPath])

  const graphModel = useMemo(
    () => (enabled ? buildLibraryGraphModel(treeNodes, rootPath, effectiveMarkdownSourcesByPath) : { nodes: [], edges: [] }),
    [effectiveMarkdownSourcesByPath, enabled, rootPath, treeNodes],
  )

  return {
    graphModel,
    isGraphLoading: enabled && Boolean(currentSignature) && !isCurrentSignatureLoaded,
  }
}
