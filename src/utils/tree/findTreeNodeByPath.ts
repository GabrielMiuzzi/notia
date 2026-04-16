import type { NotiaFileNode } from '../../types/notia'

export function findTreeNodeByPath(nodes: NotiaFileNode[], path: string): NotiaFileNode | null {
  for (const node of nodes) {
    if (node.path === path) { return node }
    if (node.children && node.children.length > 0) {
      const nestedNode = findTreeNodeByPath(node.children, path)
      if (nestedNode) { return nestedNode }
    }
  }
  return null
}