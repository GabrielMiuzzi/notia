import type { NotiaFileNode } from '../../types/notia'

function setAllFoldersExpandedInNode(node: NotiaFileNode, expanded: boolean): NotiaFileNode {
  const nextChildren = node.children?.length
    ? node.children.map((child) => setAllFoldersExpandedInNode(child, expanded))
    : node.children

  if (node.type !== 'folder') {
    if (nextChildren === node.children) {
      return node
    }

    return {
      ...node,
      children: nextChildren,
    }
  }

  const nextExpanded = expanded
  const hasExpandedChanged = Boolean(node.expanded) !== nextExpanded
  const hasChildrenChanged = nextChildren !== node.children
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
  return nodes.map((node) => setAllFoldersExpandedInNode(node, expanded))
}
