import type { NotiaFileNode } from '../../types/notia'

function toggleFolderInNode(node: NotiaFileNode, folderId: string): NotiaFileNode {
  if (node.type === 'folder' && node.id === folderId) {
    return { ...node, expanded: !node.expanded }
  }

  if (!node.children?.length) {
    return node
  }

  return {
    ...node,
    children: node.children.map((child) => toggleFolderInNode(child, folderId)),
  }
}

export function toggleFolderNodeExpanded(nodes: NotiaFileNode[], folderId: string): NotiaFileNode[] {
  return nodes.map((node) => toggleFolderInNode(node, folderId))
}
