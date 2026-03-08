import type { NotiaFileNode } from '../../types/notia'

function setExpandedInNode(node: NotiaFileNode, folderPath: string, expanded: boolean): NotiaFileNode {
  if (node.type === 'folder' && node.path === folderPath) {
    return { ...node, expanded }
  }

  if (!node.children?.length) {
    return node
  }

  return {
    ...node,
    children: node.children.map((child) => setExpandedInNode(child, folderPath, expanded)),
  }
}

export function setFolderExpandedByPath(
  nodes: NotiaFileNode[],
  folderPath: string,
  expanded: boolean,
): NotiaFileNode[] {
  return nodes.map((node) => setExpandedInNode(node, folderPath, expanded))
}
