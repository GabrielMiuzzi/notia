// @ts-nocheck
import { invoke } from '@tauri-apps/api/core'
import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'

interface OperationResult {
  ok: boolean
  error?: string
}

interface PathExistsResult {
  exists: boolean
}

function normalizePath(path: string): string {
  return normalizeFilesystemPath(path)
}

export async function createInkdocFile(path: string, content: string): Promise<void> {
  const result = await invoke<OperationResult>('create_library_file', {
    payload: {
      filePath: normalizePath(path),
      content,
    },
  })

  if (!result.ok) {
    throw new Error(result.error ?? 'Could not create file.')
  }
}

export async function createInkdocFolder(path: string): Promise<void> {
  const result = await invoke<OperationResult>('create_library_directory', {
    payload: {
      directoryPath: normalizePath(path),
    },
  })

  if (!result.ok) {
    throw new Error(result.error ?? 'Could not create folder.')
  }
}

export async function pathExists(path: string): Promise<boolean> {
  const result = await invoke<PathExistsResult>('path_exists', {
    payload: {
      path: normalizePath(path),
    },
  })

  return Boolean(result.exists)
}

export async function writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
  const result = await invoke<OperationResult>('write_binary_file', {
    payload: {
      filePath: normalizePath(path),
      data: Array.from(data),
    },
  })

  if (!result.ok) {
    throw new Error(result.error ?? 'Could not write file.')
  }
}
