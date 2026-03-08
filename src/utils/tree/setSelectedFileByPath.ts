import type { NotiaFileNode } from '../../types/notia'

function setSelectedInNode(node: NotiaFileNode, selectedFilePath: string | null): NotiaFileNode {
  const isSelected =
    node.type === 'file' && selectedFilePath !== null ? node.path === selectedFilePath : false

  const nextChildren = node.children?.map((child) => setSelectedInNode(child, selectedFilePath))
  const hasChildrenChanges = Boolean(
    node.children && nextChildren && node.children.some((child, index) => child !== nextChildren[index]),
  )

  if (node.selected === isSelected && !hasChildrenChanges) {
    return node
  }

  return {
    ...node,
    selected: isSelected,
    children: nextChildren,
  }
}

export function setSelectedFileByPath(
  nodes: NotiaFileNode[],
  selectedFilePath: string | null,
): NotiaFileNode[] {
  return nodes.map((node) => setSelectedInNode(node, selectedFilePath))
}
