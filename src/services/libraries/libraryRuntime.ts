import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { NotiaFileNode } from '../../types/notia'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'

interface PickedLibrary {
  name: string
  path: string
}

interface CreateLibraryEntryResult {
  ok: boolean
  error?: string
}

interface SearchLibraryFilesResult {
  paths: string[]
}

type LibraryEntryOperationPayload = NotiaLibraryEntryOperationPayload

function normalizeTreeNodes(value: unknown): NotiaFileNode[] {
  if (!Array.isArray(value)) {
    return []
  }

  const nodes: NotiaFileNode[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const candidate = item as NotiaFileNode
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.name !== 'string' ||
      (candidate.type !== 'folder' && candidate.type !== 'file')
    ) {
      continue
    }

    nodes.push({
      id: candidate.id,
      name: candidate.name,
      path: typeof candidate.path === 'string' ? candidate.path : undefined,
      type: candidate.type,
      expanded: candidate.type === 'folder' ? Boolean(candidate.expanded) : undefined,
      children:
        candidate.type === 'folder' ? normalizeTreeNodes(candidate.children ?? []) : undefined,
    })
  }

  return nodes
}

function buildLibraryNameFromPath(directoryPath: string): string {
  const normalizedPath = directoryPath.replace(/[\\/]+$/, '')
  if (!normalizedPath) {
    return directoryPath
  }

  const segments = normalizedPath.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? directoryPath
}

export async function pickLibraryDirectory(): Promise<PickedLibrary | null> {
  let selected: string | string[] | null
  try {
    selected = await open({
      directory: true,
      multiple: false,
      title: 'Seleccionar libreria',
    })
  } catch {
    return null
  }

  if (typeof selected !== 'string' || !selected.trim()) {
    return null
  }

  const normalizedSelectedPath = normalizeFilesystemPath(selected)

  return {
    path: normalizedSelectedPath,
    name: buildLibraryNameFromPath(normalizedSelectedPath),
  }
}

export async function readLibraryTree(directoryPath: string): Promise<NotiaFileNode[]> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)

  try {
    const rawTree = await invoke<unknown>('read_library_tree', {
      payload: { directoryPath: normalizedDirectoryPath },
    })
    const normalizedNodes = normalizeTreeNodes(rawTree)
    if (normalizedNodes.length === 0) {
      console.warn('[notia] read_library_tree returned an empty tree', {
        directoryPath: normalizedDirectoryPath,
      })
    }
    return normalizedNodes
  } catch (error) {
    console.error('[notia] read_library_tree failed', error)
    return []
  }
}

export async function createLibraryEntry(
  directoryPath: string,
  name: string,
  kind: 'folder' | 'note' | 'inkdoc',
): Promise<CreateLibraryEntryResult> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)

  try {
    return await invoke<CreateLibraryEntryResult>('create_library_entry', {
      payload: {
        directoryPath: normalizedDirectoryPath,
        name,
        kind,
      },
    })
  } catch (error) {
    console.error('[notia] create_library_entry failed', error)
    return { ok: false, error: 'Could not create entry.' }
  }
}

export async function performLibraryEntryOperation(
  payload: LibraryEntryOperationPayload,
): Promise<CreateLibraryEntryResult> {
  const normalizedPayload: LibraryEntryOperationPayload = {
    ...payload,
    targetPath: payload.targetPath ? normalizeFilesystemPath(payload.targetPath) : payload.targetPath,
    sourcePath: payload.sourcePath ? normalizeFilesystemPath(payload.sourcePath) : payload.sourcePath,
    targetDirectoryPath: payload.targetDirectoryPath
      ? normalizeFilesystemPath(payload.targetDirectoryPath)
      : payload.targetDirectoryPath,
  }

  try {
    return await invoke<CreateLibraryEntryResult>('library_entry_operation', {
      payload: normalizedPayload,
    })
  } catch (error) {
    console.error('[notia] library_entry_operation failed', error)
    return { ok: false, error: 'Could not perform operation.' }
  }
}

export async function searchLibraryFiles(directoryPath: string, query: string): Promise<string[]> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return []
  }

  try {
    const result = await invoke<SearchLibraryFilesResult>('search_library_files', {
      payload: {
        directoryPath: normalizedDirectoryPath,
        query: normalizedQuery,
      },
    })
    if (!result || !Array.isArray(result.paths)) {
      return []
    }

    return result.paths.map((path) => normalizeFilesystemPath(path))
  } catch (error) {
    console.error('[notia] search_library_files failed', error)
    return []
  }
}
