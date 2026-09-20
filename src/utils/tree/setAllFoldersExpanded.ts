import type { NotiaFileNode } from '../../types/notia'

function setAllFoldersExpandedInNode(node: NotiaFileNode, expanded: boolean): NotiaFileNode {
  const nextChildren = node.children?.length
    ? node.children.map((child) => setAllFoldersExpandedInNode(child, expanded))
    : node.children
  const hasChildrenChanged = Boolean(
    node.children && nextChildren && node.children.some((child, index) => child !== nextChildren[index]),
  )

  if (node.type !== 'folder') {
    if (!hasChildrenChanged) {
      return node
    }

    return {
      ...node,
      children: nextChildren,
    }
  }

  const nextExpanded = expanded
  const hasExpandedChanged = Boolean(node.expanded) !== nextExpanded
  if (!hasExpandedChanged && !hasChildrenChanged) {
    return node
  }

  return {
    ...node,
    expanded: nextExpanded,
    children: nextChildren,
  }
}

export function setAllFoldersExpanded(nodes: NotiaFileNode[], expanded: boolean): NotiaFileNode[] {
  let hasChanges = false
  const nextNodes = nodes.map((node) => {
    const nextNode = setAllFoldersExpandedInNode(node, expanded)
    hasChanges = hasChanges || nextNode !== node
    return nextNode
  })
  return hasChanges ? nextNodes : nodes
}
