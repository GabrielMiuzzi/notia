import type { NotiaFileNode, NotiaLibrary } from '../../types/notia'
import { getPathBaseName, readTextFile } from '../files/filesystemEngine'
import { readLibraryTree } from '../libraries/libraryRuntime'

export type ChatFileContextMode = 'direct' | 'index'

export interface ChatLibraryFileOption {
  path: string
  name: string
  relativePath: string
}

export interface ChatInlineFileAttachment {
  path: string
  name: string
  content: string
}

export function buildAttachmentDisplayName(pathValue: string, options: ChatLibraryFileOption[] = []): string {
  const matchingOption = options.find((option) => option.path === pathValue)
  return matchingOption?.name ?? getPathBaseName(pathValue)
}

function buildRelativePath(rootPath: string, absolutePath: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
  if (absolutePath.startsWith(`${normalizedRoot}/`)) {
    return absolutePath.slice(normalizedRoot.length + 1)
  }
  if (absolutePath.startsWith(`${normalizedRoot}\\`)) {
    return absolutePath.slice(normalizedRoot.length + 1)
  }
  return absolutePath
}

function collectFileOptions(
  nodes: NotiaFileNode[],
  libraryPath: string,
  target: ChatLibraryFileOption[],
): void {
  for (const node of nodes) {
    if (node.type === 'file' && node.path) {
      target.push({
        path: node.path,
        name: node.name,
        relativePath: buildRelativePath(libraryPath, node.path),
      })
      continue
    }

    if (node.children && node.children.length > 0) {
      collectFileOptions(node.children, libraryPath, target)
    }
  }
}

export async function loadLibraryFileOptions(library: NotiaLibrary): Promise<ChatLibraryFileOption[]> {
  const tree = await readLibraryTree(library.path, {
    androidDirectoryUri: library.androidTreeUri,
  })
  const collected: ChatLibraryFileOption[] = []
  collectFileOptions(tree, library.path, collected)
  return collected.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'es'))
}

export function filterLibraryFileOptions(
  options: ChatLibraryFileOption[],
  query: string,
): ChatLibraryFileOption[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return options.slice(0, 60)
  }

  return options
    .filter((option) => (
      option.name.toLowerCase().includes(normalizedQuery)
      || option.relativePath.toLowerCase().includes(normalizedQuery)
    ))
    .slice(0, 60)
}

export async function loadInlineFileAttachments(
  selectedPaths: string[],
  options: ChatLibraryFileOption[] = [],
): Promise<ChatInlineFileAttachment[]> {
  const loadedFiles = await Promise.all(selectedPaths.map(async (selectedPath) => {
    const result = await readTextFile(selectedPath)
    if (!result.ok) {
      throw new Error(result.error || `No se pudo leer ${selectedPath}.`)
    }

    return {
      path: selectedPath,
      name: buildAttachmentDisplayName(selectedPath, options),
      content: result.content,
    } satisfies ChatInlineFileAttachment
  }))

  return loadedFiles
}
