import type { NotiaFileNode } from '../../types/notia'

export function collectFilesFromTree(nodes: NotiaFileNode[]): string[] {
  const paths: string[] = []

  const visit = (currentNodes: NotiaFileNode[]) => {
    for (const node of currentNodes) {
      if (node.type === 'file' && node.path) {
        paths.push(node.path)
      }

      if (node.children && node.children.length > 0) {
        visit(node.children)
      }
    }
  }

  visit(nodes)
  return paths
}