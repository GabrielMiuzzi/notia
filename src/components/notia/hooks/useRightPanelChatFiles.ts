import { useMemo } from 'react'
import type { NotiaFileNode } from '../../../types/notia'
import { collectFilesFromTree } from '../../../utils/tree/collectFilesFromTree'
import { toStoredLibraryPath } from '../../../services/libraries/libraryPathMapping'

// --- Pure helper functions ---

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '')
}

function stripFileExtension(value: string): string {
  const lastDotIndex = value.lastIndexOf('.')
  if (lastDotIndex <= 0) { return value }
  return value.slice(0, lastDotIndex)
}

function collectNestedChatHistoryFiles(nodes: NotiaFileNode[], remainingSegments: string[]): string[] {
  if (remainingSegments.length === 0) {
    return collectFilesFromTree(nodes)
  }
  const [nextSegment, ...restSegments] = remainingSegments
  const matchingFolder = nodes.find((node) => (
    node.type === 'folder' && node.name.trim().toLowerCase() === nextSegment
  ))
  if (!matchingFolder?.children) { return [] }
  return collectNestedChatHistoryFiles(matchingFolder.children, restSegments)
}

// --- Hook ---

interface UseRightPanelChatFilesParams {
  activeLibraryPath: string | undefined
  activeWorkspaceView: string
  isRightChatPanelOpen: boolean
  treeNodes: NotiaFileNode[]
}

export function useRightPanelChatFiles({
  activeLibraryPath,
  activeWorkspaceView,
  isRightChatPanelOpen,
  treeNodes,
}: UseRightPanelChatFilesParams) {
  return useMemo(() => {
    const shouldPrepareChatHistory = activeWorkspaceView === 'chat' || isRightChatPanelOpen
    if (!activeLibraryPath || !shouldPrepareChatHistory) { return [] }
    return collectNestedChatHistoryFiles(treeNodes, ['chat', 'chats'])
      .map((filePath) => ({
        runtimePath: normalizePath(filePath),
        storedPath: normalizePath(toStoredLibraryPath(activeLibraryPath, filePath)),
      }))
      .filter(({ storedPath }) => (
        storedPath.toLowerCase().startsWith('chat/chats/')
        && storedPath.toLowerCase().endsWith('.md')
      ))
      .sort((left, right) => right.storedPath.localeCompare(left.storedPath, 'es'))
      .map((filePath) => {
        const relativeChatPath = filePath.storedPath.slice('chat/chats/'.length)
        return {
          id: filePath.storedPath,
          filePath: filePath.runtimePath,
          title: stripFileExtension(relativeChatPath),
        }
      })
  }, [activeLibraryPath, activeWorkspaceView, isRightChatPanelOpen, treeNodes])
}