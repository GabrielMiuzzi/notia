import type { NotiaFileNode } from '../../types/notia'

function areObservableNodeFieldsEqual(left: NotiaFileNode, right: NotiaFileNode): boolean {
  return left.id === right.id
    && left.name === right.name
    && left.path === right.path
    && left.type === right.type
    && Boolean(left.expanded) === Boolean(right.expanded)
    && Boolean(left.selected) === Boolean(right.selected)
    && Boolean(left.hasChildren) === Boolean(right.hasChildren)
    && left.createdAt === right.createdAt
    && left.modifiedAt === right.modifiedAt
}

function reconcileNode(previous: NotiaFileNode | undefined, next: NotiaFileNode): NotiaFileNode {
  if (!previous || previous.id !== next.id) {
    return next
  }

  const previousChildren = previous.children ?? []
  const nextChildren = next.children ?? []
  const reconciledChildren = reconcileTreeNodes(previousChildren, nextChildren)
  const childrenEqual = reconciledChildren === previousChildren
    || (reconciledChildren.length === 0 && !previous.children && !next.children)

  if (areObservableNodeFieldsEqual(previous, next) && childrenEqual) {
    return previous
  }

  if (reconciledChildren.length === 0 && !next.children) {
    return { ...next, children: undefined }
  }
  return { ...next, children: reconciledChildren }
}

/**
 * Reuses nodes and child arrays from a previous snapshot when every observable
 * field is unchanged. Only ancestors of changed, inserted, removed or moved
 * nodes receive new references.
 */
export function reconcileTreeNodes(
  previousNodes: NotiaFileNode[],
  nextNodes: NotiaFileNode[],
): NotiaFileNode[] {
  const previousById = new Map(previousNodes.map((node) => [node.id, node]))
  const reconciled = nextNodes.map((node) => reconcileNode(previousById.get(node.id), node))
  if (reconciled.length === previousNodes.length
    && reconciled.every((node, index) => node === previousNodes[index])) {
    return previousNodes
  }
  return reconciled
}
