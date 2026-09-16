import type { LibraryContext } from '../../services/contexts/libraryContexts'
import type { LibraryGraphNode } from '../../types/graph/libraryGraph'

export type GraphContextLegendEntry = [tag: string, color: string]

export function buildGraphContextLegend(
  contexts: readonly LibraryContext[],
  nodes: readonly Pick<LibraryGraphNode, 'contextTag' | 'contextColor'>[],
): GraphContextLegendEntry[] {
  const entries = new Map<string, GraphContextLegendEntry>()

  for (const context of contexts) {
    entries.set(context.tag.toLowerCase(), [context.tag, context.color])
  }

  for (const node of nodes) {
    if (!node.contextTag || !node.contextColor) {
      continue
    }

    const key = node.contextTag.toLowerCase()
    if (!entries.has(key)) {
      entries.set(key, [node.contextTag, node.contextColor])
    }
  }

  return Array.from(entries.values())
}
