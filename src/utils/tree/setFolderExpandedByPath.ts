import type { NotiaFileNode } from '../../types/notia'

function setExpandedInNode(node: NotiaFileNode, folderPath: string, expanded: boolean): NotiaFileNode {
  let nextNode = node
  if (node.type === 'folder' && node.path === folderPath) {
    if (Boolean(node.expanded) !== expanded) {
      nextNode = { ...node, expanded }
    }
  }

  if (!node.children?.length) {
    return nextNode
  }

  const nextChildren = node.children.map((child) => setExpandedInNode(child, folderPath, expanded))
  const hasChildrenChanged = node.children.some((child, index) => child !== nextChildren[index])
  if (!hasChildrenChanged) {
    return nextNode
  }

  return { ...nextNode, children: nextChildren }
}

export function setFolderExpandedByPath(
  nodes: NotiaFileNode[],
  folderPath: string,
  expanded: boolean,
): NotiaFileNode[] {
  const nextNodes = nodes.map((node) => setExpandedInNode(node, folderPath, expanded))
  return nodes.some((node, index) => node !== nextNodes[index]) ? nextNodes : nodes
}
