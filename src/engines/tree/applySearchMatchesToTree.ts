import type { NotiaFileNode } from '../../types/notia'

interface DecoratedSearchNode {
  node: NotiaFileNode
  hasMatch: boolean
}

function decorateNodeForSearch(
  node: NotiaFileNode,
  matchedFilePaths: ReadonlySet<string>,
): DecoratedSearchNode {
  if (node.type === 'file') {
    const hasMatch = Boolean(node.path && matchedFilePaths.has(node.path))
    return {
      node,
      hasMatch,
    }
  }

  const nextChildren = node.children?.map((child) => decorateNodeForSearch(child, matchedFilePaths))
  const childrenNodes = nextChildren?.map((child) => child.node)
  const hasMatchInChildren = Boolean(nextChildren?.some((child) => child.hasMatch))
  const nextExpanded = hasMatchInChildren ? true : node.expanded

  const childrenChanged = Boolean(
    node.children && childrenNodes && node.children.some((child, index) => child !== childrenNodes[index]),
  )
  const expandedChanged = node.expanded !== nextExpanded

  if (!childrenChanged && !expandedChanged) {
    return {
      node,
      hasMatch: hasMatchInChildren,
    }
  }

  return {
    node: {
      ...node,
      expanded: nextExpanded,
      children: childrenNodes,
    },
    hasMatch: hasMatchInChildren,
  }
}

export function applySearchMatchesToTree(
  nodes: NotiaFileNode[],
  matchedFilePaths: ReadonlySet<string>,
  isSearchActive: boolean,
): NotiaFileNode[] {
  if (!isSearchActive || matchedFilePaths.size === 0) {
    return nodes
  }

  return nodes.map((node) => decorateNodeForSearch(node, matchedFilePaths).node)
}
