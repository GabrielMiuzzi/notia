import type { FilesystemTreeNode } from '../../services/files/filesystemEngine'
import { extractLinkPath } from '../../engines/markdown/pageLinkSyncEngine'

interface PageLinkBlock {
  nodes: FilesystemTreeNode[]
  sortKey: number
}

function resolveNodeCreatedAt(node: FilesystemTreeNode): number {
  return node.createdAt ?? node.modifiedAt ?? Number.MAX_SAFE_INTEGER
}

function resolveNodePath(node: FilesystemTreeNode): string | undefined {
  return node.path
}

function stripMdExtension(name: string): string {
  return name.toLowerCase().replace(/\.md$/, '')
}

function isValidLink(
  targetPath: string | undefined,
  nodesByPath: Map<string, FilesystemTreeNode>,
): boolean {
  if (!targetPath || targetPath.trim() === '' || targetPath === 'N/A') {
    return false
  }
  const extracted = extractLinkPath(targetPath)
  if (!extracted) {
    return false
  }
  // The map may contain absolute paths. Try the raw path first, then the extracted basename.
  if (nodesByPath.has(targetPath)) {
    return true
  }
  const extractedNorm = stripMdExtension(extracted)
  for (const [key] of nodesByPath) {
    const basename = key.replace(/\\/g, '/').split('/').pop() ?? key
    if (stripMdExtension(basename) === extractedNorm) {
      return true
    }
  }
  return false
}

function findNodeByLink(
  targetPath: string | undefined,
  nodesByPath: Map<string, FilesystemTreeNode>,
): FilesystemTreeNode | undefined {
  if (!targetPath || targetPath.trim() === '' || targetPath === 'N/A') {
    return undefined
  }
  const extracted = extractLinkPath(targetPath)
  if (!extracted) {
    return undefined
  }
  // Try exact match first
  const exact = nodesByPath.get(targetPath)
  if (exact) {
    return exact
  }
  // Try basename match (with and without .md extension)
  const extractedNorm = stripMdExtension(extracted)
  for (const [key, node] of nodesByPath) {
    const basename = key.replace(/\\/g, '/').split('/').pop() ?? key
    if (stripMdExtension(basename) === extractedNorm) {
      return node
    }
  }
  return undefined
}

function buildPageLinkBlocks(nodes: FilesystemTreeNode[]): {
  blocks: PageLinkBlock[]
  looseNodes: FilesystemTreeNode[]
} {
  const nodesByPath = new Map<string, FilesystemTreeNode>()
  for (const node of nodes) {
    const path = resolveNodePath(node)
    if (path) {
      nodesByPath.set(path, node)
    }
  }

  const visited = new Set<string>()
  const blocks: PageLinkBlock[] = []
  const looseNodes: FilesystemTreeNode[] = []

  for (const node of nodes) {
    const path = resolveNodePath(node)
    if (!path || visited.has(path)) {
      continue
    }

    const hasValidNext = isValidLink(node.nextPage, nodesByPath)
    const hasValidPrevious = isValidLink(node.previousPage, nodesByPath)

    if (!hasValidNext && !hasValidPrevious) {
      looseNodes.push(node)
      visited.add(path)
      continue
    }

    const chain: FilesystemTreeNode[] = []
    let currentNode: FilesystemTreeNode | undefined = node

    // Walk backwards to find head of chain
    while (currentNode) {
      const currentPath = resolveNodePath(currentNode)
      if (!currentPath || visited.has(currentPath)) {
        break
      }
      chain.unshift(currentNode)
      visited.add(currentPath)
      const prevLink = extractLinkPath(currentNode.previousPage ?? '')
      if (!prevLink || !isValidLink(prevLink, nodesByPath)) {
        break
      }
      currentNode = findNodeByLink(prevLink, nodesByPath)
    }

    // Walk forwards from original node
    let forwardPath = extractLinkPath(node.nextPage ?? '')
    while (forwardPath) {
      const resolved = findNodeByLink(forwardPath, nodesByPath)
      if (!resolved) {
        break
      }
      const resolvedPath = resolved.path
      if (!resolvedPath || visited.has(resolvedPath)) {
        break
      }
      chain.push(resolved)
      visited.add(resolvedPath)
      forwardPath = extractLinkPath(resolved.nextPage ?? '')
      if (!forwardPath || !isValidLink(forwardPath, nodesByPath)) {
        break
      }
    }

    const headCreatedAt = resolveNodeCreatedAt(chain[0] ?? node)
    blocks.push({ nodes: chain, sortKey: headCreatedAt })
  }

  // Any remaining unvisited nodes go to loose
  for (const node of nodes) {
    const nodePath = resolveNodePath(node)
    if (nodePath && !visited.has(nodePath)) {
      looseNodes.push(node)
      visited.add(nodePath)
    }
  }

  return { blocks, looseNodes }
}

export function sortFilesystemTreeNodesWithPageLinks(
  nodes: FilesystemTreeNode[],
): FilesystemTreeNode[] {
  if (nodes.length === 0) {
    return []
  }

  const folders: FilesystemTreeNode[] = []
  const files: FilesystemTreeNode[] = []

  for (const node of nodes) {
    if (node.type === 'folder') {
      folders.push(node)
    } else {
      files.push(node)
    }
  }

  const sortedFolders = folders.map((folder) => {
    if (folder.children && folder.children.length > 0) {
      return {
        ...folder,
        children: sortFilesystemTreeNodesWithPageLinks(folder.children),
      }
    }
    return folder
  })

  const { blocks, looseNodes } = buildPageLinkBlocks(files)

  const sortedBlocks = blocks.sort((left, right) => {
    if (left.sortKey !== right.sortKey) {
      return left.sortKey - right.sortKey
    }
    const leftName = left.nodes[0]?.name ?? ''
    const rightName = right.nodes[0]?.name ?? ''
    return leftName.localeCompare(rightName, undefined, { sensitivity: 'base' })
  })

  const sortedLoose = looseNodes.sort((left, right) => {
    const leftDate = resolveNodeCreatedAt(left)
    const rightDate = resolveNodeCreatedAt(right)
    if (leftDate !== rightDate) {
      return leftDate - rightDate
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })

  const flattenedFiles: FilesystemTreeNode[] = []
  for (const block of sortedBlocks) {
    flattenedFiles.push(...block.nodes)
  }
  flattenedFiles.push(...sortedLoose)

  return [...sortedFolders, ...flattenedFiles]
}
