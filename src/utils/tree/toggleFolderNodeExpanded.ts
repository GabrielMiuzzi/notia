import type { NotiaFileNode } from '../../types/notia'

function toggleFolderInNode(node: NotiaFileNode, folderId: string): NotiaFileNode {
  let nextNode = node
  if (node.type === 'folder' && node.id === folderId) {
    nextNode = { ...node, expanded: !node.expanded }
  }

  if (!node.children?.length) {
    return nextNode
  }

  const nextChildren = node.children.map((child) => toggleFolderInNode(child, folderId))
  const hasChildrenChanged = node.children.some((child, index) => child !== nextChildren[index])
  if (!hasChildrenChanged) {
    return nextNode
  }

  return { ...nextNode, children: nextChildren }
}

export function toggleFolderNodeExpanded(nodes: NotiaFileNode[], folderId: string): NotiaFileNode[] {
  const nextNodes = nodes.map((node) => toggleFolderInNode(node, folderId))
  return nodes.some((node, index) => node !== nextNodes[index]) ? nextNodes : nodes
}
