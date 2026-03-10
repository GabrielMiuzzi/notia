import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'
import { getRuntimeDevice } from '../../../utils/platform/getRuntimeDevice'
import type { MarkdownFileDocument } from '../types/taskManagerTypes'

interface OperationResult {
  ok: boolean
  error?: string
}

interface ReadLibraryFileResult {
  ok: boolean
  content: string
  error?: string
}

interface WriteLibraryFileResult {
  ok: boolean
  error?: string
}

interface IsDirectoryPathResult {
  isDirectory: boolean
}

function notifyLibraryTreeChanged(pathHint: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent('notia:library-tree-changed', {
    detail: { pathHint: normalizeFilesystemPath(pathHint) },
  }))
}

function resolveParentDirectoryPath(pathValue: string): string {
  const normalized = pathValue.replace(/[\\/]+$/, '')
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (separatorIndex <= 0) {
    return normalized
  }
  return normalized.slice(0, separatorIndex)
}

async function resolveVaultDirectoryFromSelection(selectedPath: string): Promise<string | null> {
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

async function pickAndroidDirectoryPath(): Promise<string | null> {
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
      if (!selected.trim()) {
        return null
      }
      return normalizeFilesystemPath(selected)
    }
    if (!selected || typeof selected !== 'object') {
      return null
    }
    const candidate = selected as { path?: unknown }
    if (typeof candidate.path !== 'string' || !candidate.path.trim()) {
      return null
    }
    return normalizeFilesystemPath(candidate.path)
  } catch (error) {
    console.error('[task-manager] pick_android_directory_tree failed', error)
    return null
  }
}

export async function pickVaultDirectory(): Promise<{ path: string; name: string } | null> {
  if (getRuntimeDevice() === 'Android') {
    const androidDirectoryPath = await pickAndroidDirectoryPath()
    if (!androidDirectoryPath) {
      return null
    }

    const name = androidDirectoryPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? androidDirectoryPath
    return { path: androidDirectoryPath, name }
  }

  let selectedPath: string | string[] | null
  try {
    selectedPath = await open({
      directory: true,
      multiple: false,
      pickerMode: 'document',
      title: 'Seleccionar vault',
    })
  } catch (error) {
    console.warn('[task-manager] directory picker failed, trying file-based fallback', error)
    try {
      selectedPath = await open({
        directory: false,
        multiple: false,
        pickerMode: 'document',
        title: 'Seleccionar un archivo dentro del vault',
      })
    } catch (fallbackError) {
      console.error('[task-manager] pickVaultDirectory failed to open any picker', fallbackError)
      return null
    }
  }

  if (typeof selectedPath !== 'string' || !selectedPath.trim()) {
    return null
  }

  const normalizedPath = await resolveVaultDirectoryFromSelection(selectedPath)
  if (!normalizedPath) {
    return null
  }
  const name = normalizedPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? normalizedPath

  return { path: normalizedPath, name }
}

export async function readMarkdownFiles(directoryPath: string): Promise<MarkdownFileDocument[]> {
  if (!directoryPath.trim()) {
    return []
  }

  try {
    const normalizedPath = normalizeFilesystemPath(directoryPath)
    const response = await invoke<MarkdownFileDocument[]>('read_markdown_files', {
      payload: { directoryPath: normalizedPath },
    })

    if (!Array.isArray(response)) {
      return []
    }

    return response.filter((item): item is MarkdownFileDocument => (
      Boolean(item)
      && typeof item.path === 'string'
      && typeof item.content === 'string'
    ))
  } catch (error) {
    console.error('[task-manager] read_markdown_files failed', error)
    return []
  }
}

export async function readFileContent(filePath: string): Promise<ReadLibraryFileResult> {
  const normalizedPath = normalizeFilesystemPath(filePath)

  try {
    return await invoke<ReadLibraryFileResult>('read_library_file', {
      payload: { filePath: normalizedPath },
    })
  } catch (error) {
    console.error('[task-manager] read_library_file failed', error)
    return { ok: false, content: '', error: 'No se pudo leer el archivo.' }
  }
}

export async function writeFileContent(filePath: string, content: string): Promise<WriteLibraryFileResult> {
  const normalizedPath = normalizeFilesystemPath(filePath)

  try {
    const result = await invoke<WriteLibraryFileResult>('write_library_file', {
      payload: { filePath: normalizedPath, content },
    })
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedPath)
    }
    return result
  } catch (error) {
    console.error('[task-manager] write_library_file failed', error)
    return { ok: false, error: 'No se pudo escribir el archivo.' }
  }
}

export async function createFolder(parentDirectoryPath: string, name: string): Promise<OperationResult> {
  try {
    const result = await invoke<OperationResult>('create_library_entry', {
      payload: {
        directoryPath: normalizeFilesystemPath(parentDirectoryPath),
        name,
        kind: 'folder',
      },
    })
    if (result.ok) {
      notifyLibraryTreeChanged(`${parentDirectoryPath}/${name}`)
    }
    return result
  } catch (error) {
    console.error('[task-manager] create_library_entry(folder) failed', error)
    return { ok: false, error: 'No se pudo crear la carpeta.' }
  }
}

export async function createMarkdownFile(parentDirectoryPath: string, fileName: string): Promise<OperationResult> {
  try {
    const result = await invoke<OperationResult>('create_library_entry', {
      payload: {
        directoryPath: normalizeFilesystemPath(parentDirectoryPath),
        name: fileName,
        kind: 'note',
      },
    })
    if (result.ok) {
      notifyLibraryTreeChanged(`${parentDirectoryPath}/${fileName}`)
    }
    return result
  } catch (error) {
    console.error('[task-manager] create_library_entry(note) failed', error)
    return { ok: false, error: 'No se pudo crear el archivo.' }
  }
}

export async function deleteEntry(targetPath: string): Promise<OperationResult> {
  try {
    const normalizedPath = normalizeFilesystemPath(targetPath)
    const result = await invoke<OperationResult>('library_entry_operation', {
      payload: {
        action: 'delete',
        targetPath: normalizedPath,
      },
    })
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedPath)
    }
    return result
  } catch (error) {
    console.error('[task-manager] library_entry_operation(delete) failed', error)
    return { ok: false, error: 'No se pudo eliminar la entrada.' }
  }
}

export async function renameEntry(targetPath: string, newName: string): Promise<OperationResult> {
  try {
    const normalizedPath = normalizeFilesystemPath(targetPath)
    const result = await invoke<OperationResult>('library_entry_operation', {
      payload: {
        action: 'rename',
        targetPath: normalizedPath,
        newName,
      },
    })
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedPath)
    }
    return result
  } catch (error) {
    console.error('[task-manager] library_entry_operation(rename) failed', error)
    return { ok: false, error: 'No se pudo renombrar la entrada.' }
  }
}

export async function moveEntry(sourcePath: string, targetDirectoryPath: string): Promise<OperationResult> {
  try {
    const normalizedSourcePath = normalizeFilesystemPath(sourcePath)
    const normalizedTargetDirectoryPath = normalizeFilesystemPath(targetDirectoryPath)
    const result = await invoke<OperationResult>('library_entry_operation', {
      payload: {
        action: 'paste',
        sourcePath: normalizedSourcePath,
        targetDirectoryPath: normalizedTargetDirectoryPath,
        mode: 'move',
      },
    })
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedSourcePath)
      notifyLibraryTreeChanged(normalizedTargetDirectoryPath)
    }
    return result
  } catch (error) {
    console.error('[task-manager] library_entry_operation(move) failed', error)
    return { ok: false, error: 'No se pudo mover la entrada.' }
  }
}

export async function ensureFolderPath(rootPath: string, relativePath: string): Promise<void> {
  const segments = relativePath.split('/').filter(Boolean)
  let currentPath = normalizeFilesystemPath(rootPath)

  for (const segment of segments) {
    const result = await createFolder(currentPath, segment)
    if (!result.ok && !isAlreadyExistsError(result.error)) {
      throw new Error(result.error || `No se pudo crear la carpeta ${segment}`)
    }

    currentPath = `${currentPath}/${segment}`
  }
}

function isAlreadyExistsError(error: string | undefined): boolean {
  if (!error) {
    return false
  }

  return error.toLowerCase().includes('already exists')
}
