import { useEffect, useMemo, useState } from 'react'
import { buildLibraryGraphModel, collectMarkdownFilePaths } from '../engines/graph/libraryGraphEngine'
import { readLibraryFileContent } from '../services/libraries/libraryDocumentRuntime'
import type { NotiaFileNode } from '../types/notia'

const MARKDOWN_SIGNATURE_SEPARATOR = '\u0001'

interface UseLibraryGraphDataParams {
  libraryPath: string | null
  rootPath: string | null
  treeNodes: NotiaFileNode[]
  revision: number
}

export function useLibraryGraphData({ libraryPath, rootPath, treeNodes, revision }: UseLibraryGraphDataParams) {
  const [markdownSourcesByPath, setMarkdownSourcesByPath] = useState<Record<string, string>>({})
  const [loadedSignature, setLoadedSignature] = useState('')

  const markdownPathSignature = useMemo(() => {
    const markdownPaths = collectMarkdownFilePaths(treeNodes).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' }),
    )
    return markdownPaths.join(MARKDOWN_SIGNATURE_SEPARATOR)
  }, [treeNodes])

  useEffect(() => {
    if (!libraryPath || !markdownPathSignature) {
      return
    }

    const requestSignature = `${libraryPath}::${markdownPathSignature}::${revision}`
    let isCurrent = true
    const markdownPaths = markdownPathSignature.split(MARKDOWN_SIGNATURE_SEPARATOR)

    void Promise.all(
      markdownPaths.map(async (pathValue) => {
        const result = await readLibraryFileContent(pathValue)
        if (!result.ok) {
          return null
        }

        return { path: pathValue, content: result.content }
      }),
    )
      .then((entries) => {
        if (!isCurrent) {
          return
        }

        const nextMarkdownSourcesByPath: Record<string, string> = {}
        for (const entry of entries) {
          if (!entry) {
            continue
          }

          nextMarkdownSourcesByPath[entry.path] = entry.content
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
  }, [libraryPath, markdownPathSignature, revision])

  const currentSignature =
    libraryPath && markdownPathSignature ? `${libraryPath}::${markdownPathSignature}::${revision}` : ''
  const isCurrentSignatureLoaded = Boolean(currentSignature) && loadedSignature === currentSignature

  const effectiveMarkdownSourcesByPath = useMemo(() => {
    if (!isCurrentSignatureLoaded) {
      return {}
    }

    return markdownSourcesByPath
  }, [isCurrentSignatureLoaded, markdownSourcesByPath])

  const graphModel = useMemo(
    () => buildLibraryGraphModel(treeNodes, rootPath, effectiveMarkdownSourcesByPath),
    [effectiveMarkdownSourcesByPath, rootPath, treeNodes],
  )

  return {
    graphModel,
    isGraphLoading: Boolean(currentSignature) && !isCurrentSignatureLoaded,
  }
}
