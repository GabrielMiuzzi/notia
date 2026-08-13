import type { LibraryGraphModel } from '../../types/graph/libraryGraph'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'

export interface LinkCacheMermaidResult {
  code: string
  nodeIdMap: Map<string, string>
  pathToSafeId: Map<string, string>
}

function getParentDirectoryPath(filePath: string): string {
  const normalized = normalizeFilesystemPath(filePath)
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return ''
  if (idx === 0) return '/'
  return normalized.slice(0, idx)
}

function getBaseName(pathValue: string): string {
  const normalized = normalizeFilesystemPath(pathValue)
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? pathValue
}

function buildSafeNodeId(counter: number): string {
  // Sanitize for Mermaid: alphanumeric + underscore only; avoid leading digit issues by prefixing
  return `node_${counter}`
}

function escapeMermaidLabel(label: string): string {
  return label
    .replace(/"/g, '&quot;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
}

function buildSubgraphName(name: string): string {
  const escaped = name.replace(/"/g, '\\"')
  return `"${escaped}"`
}

/**
 * Build a Mermaid flowchart representing the library link graph.
 * Nodes are grouped into subgraphs by their containing folder (relative to rootPath).
 *
 * The generated code starts with a small class definition so nodes look good in both
 * light/dark themes when rendered through the Mermaid module.
 */
export function buildLinkCacheMermaidCode(
  graphModel: LibraryGraphModel,
  rootPath: string | null,
): LinkCacheMermaidResult {
  const { nodes, edges } = graphModel

  const pathToSafeId = new Map<string, string>()
  const nodeIdMap = new Map<string, string>()
  const groupedNodeSafeIds = new Map<string, string[]>()

  let counter = 0
  for (const node of nodes) {
    counter += 1
    const safeId = buildSafeNodeId(counter)
    pathToSafeId.set(node.path, safeId)
    nodeIdMap.set(safeId, node.path)

    const folder = resolveFolderGroup(node.path, rootPath)
    const list = groupedNodeSafeIds.get(folder)
    if (list) {
      list.push(safeId)
    } else {
      groupedNodeSafeIds.set(folder, [safeId])
    }
  }

  if (nodes.length === 0) {
    return {
      code: '',
      nodeIdMap,
      pathToSafeId,
    }
  }

  const lines: string[] = []
  lines.push('flowchart TD')

  // Declare all nodes first
  for (const node of nodes) {
    const safeId = pathToSafeId.get(node.path)!
    const label = escapeMermaidLabel(node.label)
    lines.push(`    ${safeId}["${label}"]`)
  }

  // Group nodes into subgraphs by folder
  const sortedGroups = [...groupedNodeSafeIds.keys()].sort((a, b) => a.localeCompare(b))
  for (const groupKey of sortedGroups) {
    const safeIds = groupedNodeSafeIds.get(groupKey)!
    if (safeIds.length === 0) continue
    lines.push(`    subgraph ${buildSubgraphName(groupKey.trim() || '(root)')}`)
    for (const sid of safeIds) {
      lines.push(`        ${sid}`)
    }
    lines.push('    end')
  }

  // Edges (deduplicate undirected)
  const edgeSet = new Set<string>()
  for (const edge of edges) {
    const sourceId = pathToSafeId.get(edge.sourcePath)
    const targetId = pathToSafeId.get(edge.targetPath)
    if (!sourceId || !targetId) continue

    const ordered = [sourceId, targetId].sort((a, b) => a.localeCompare(b))
    const key = `${ordered[0]}<->${ordered[1]}`
    if (edgeSet.has(key)) continue
    edgeSet.add(key)

    lines.push(`    ${sourceId} --> ${targetId}`)
  }

  return {
    code: lines.join('\n'),
    nodeIdMap,
    pathToSafeId,
  }
}

function resolveFolderGroup(filePath: string, rootPath: string | null): string {
  const parentPath = getParentDirectoryPath(filePath)
  if (!rootPath) {
    return getBaseName(parentPath)
  }
  const normRoot = normalizeFilesystemPath(rootPath)
  if (parentPath === normRoot) {
    return ''
  }
  const prefix = `${normRoot}/`
  if (parentPath.startsWith(prefix)) {
    return parentPath.slice(prefix.length)
  }
  return getBaseName(parentPath)
}
