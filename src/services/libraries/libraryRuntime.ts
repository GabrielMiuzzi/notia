import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { NotiaFileNode } from '../../types/notia'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'

interface PickedLibrary {
  name: string
  path: string
  androidTreeUri?: string
}

interface CreateLibraryEntryResult {
  ok: boolean
  error?: string
}

interface SearchLibraryFilesResult {
  paths: string[]
}

interface IsDirectoryPathResult {
  isDirectory: boolean
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

function resolveParentDirectoryPath(pathValue: string): string {
  const normalized = pathValue.replace(/[\\/]+$/, '')
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (separatorIndex <= 0) {
    return normalized
  }
  return normalized.slice(0, separatorIndex)
}

async function resolveLibraryDirectoryFromSelection(selectedPath: string): Promise<string | null> {
  const normalizedPath = normalizeFilesystemPath(selectedPath)

  const selectedMetadata = await invoke<IsDirectoryPathResult>('is_directory_path', {
    payload: { path: normalizedPath },
  }).catch(() => ({ isDirectory: false }))

  if (selectedMetadata.isDirectory) {
    return normalizedPath
  }

  const parentDirectoryPath = resolveParentDirectoryPath(normalizedPath)
  if (!parentDirectoryPath || parentDirectoryPath === normalizedPath) {
    return null
  }

  const parentMetadata = await invoke<IsDirectoryPathResult>('is_directory_path', {
    payload: { path: parentDirectoryPath },
  }).catch(() => ({ isDirectory: false }))

  return parentMetadata.isDirectory ? parentDirectoryPath : null
}

export async function pickLibraryDirectory(): Promise<PickedLibrary | null> {
  if (getRuntimeDevice() === 'Android') {
    try {
      let selected: unknown
      try {
        selected = await invoke<unknown>('pick_android_directory_tree')
      } catch (firstError) {
        selected = await invoke<unknown>('mobile_directory_picker::pick_android_directory_tree').catch(() => {
          throw firstError
        })
      }

      if (typeof selected === 'string') {
        const androidDirectoryPath = normalizeFilesystemPath(selected)
        if (!androidDirectoryPath) {
          return null
        }
        return {
          path: androidDirectoryPath,
          name: buildLibraryNameFromPath(androidDirectoryPath),
        }
      }

      if (!selected || typeof selected !== 'object') {
        return null
      }
      const candidate = selected as { path?: unknown; uri?: unknown }
      if (typeof candidate.path !== 'string' || !candidate.path.trim()) {
        return null
      }
      const androidDirectoryPath = normalizeFilesystemPath(candidate.path)

      return {
        path: androidDirectoryPath,
        name: buildLibraryNameFromPath(androidDirectoryPath),
        androidTreeUri: typeof candidate.uri === 'string' && candidate.uri.trim()
          ? candidate.uri
          : undefined,
      }
    } catch (error) {
      console.error('[notia] pick_android_directory_tree failed', error)
      if (
        error instanceof Error
        && (
          error.message.includes('command pick_android_directory_tree not found')
          || error.message.includes('command mobile_directory_picker::pick_android_directory_tree not found')
        )
      ) {
        throw new Error('El backend Android esta desactualizado. Recompila e instala la app nuevamente.')
      }
      if (error instanceof Error && error.message.trim()) {
        throw new Error(error.message)
      }
      throw new Error(String(error))
    }
  }

  let selected: string | string[] | null = null
  try {
    selected = await open({
      directory: true,
      multiple: false,
      pickerMode: 'document',
      title: 'Seleccionar libreria',
    })
  } catch (error) {
    console.warn('[notia] directory picker failed, trying file-based fallback', error)
    try {
      selected = await open({
        directory: false,
        multiple: false,
        pickerMode: 'document',
        title: 'Seleccionar un archivo dentro de la libreria',
      })
    } catch (fallbackError) {
      console.error('[notia] pickLibraryDirectory failed to open any picker', fallbackError)
      throw new Error('No se pudo abrir el selector de carpetas.')
    }
  }

  if (typeof selected !== 'string' || !selected.trim()) {
    return null
  }

  const normalizedSelectedPath = await resolveLibraryDirectoryFromSelection(selected)
  if (!normalizedSelectedPath) {
    throw new Error('No se pudo resolver una carpeta válida desde la selección.')
  }

  return {
    path: normalizedSelectedPath,
    name: buildLibraryNameFromPath(normalizedSelectedPath),
  }
}

export async function readLibraryTree(
  directoryPath: string,
  options?: { androidDirectoryUri?: string },
): Promise<NotiaFileNode[]> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)

  try {
    if (getRuntimeDevice() === 'Android') {
      const mobileTree = await invoke<unknown>('read_android_library_tree', {
        payload: {
          directoryPath: normalizedDirectoryPath,
          directoryUri: options?.androidDirectoryUri,
        },
      })
      return normalizeTreeNodes(mobileTree)
    }

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
  options?: { androidDirectoryUri?: string },
): Promise<CreateLibraryEntryResult> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)

  try {
    return await invoke<CreateLibraryEntryResult>('create_library_entry', {
      payload: {
        directoryPath: normalizedDirectoryPath,
        directoryUri: options?.androidDirectoryUri,
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
