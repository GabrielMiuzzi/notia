import { invoke } from '@tauri-apps/api/core'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'

interface ReadLibraryFileResult {
  ok: boolean
  content: string
  error?: string
}

interface WriteLibraryFileResult {
  ok: boolean
  error?: string
}

export async function readLibraryFileContent(filePath: string): Promise<ReadLibraryFileResult> {
  const normalizedFilePath = normalizeFilesystemPath(filePath)

  try {
    return await invoke<ReadLibraryFileResult>('read_library_file', {
      payload: { filePath: normalizedFilePath },
    })
  } catch (error) {
    console.error('[notia] read_library_file failed', error)
    return { ok: false, content: '', error: 'Could not read file.' }
  }
}

export async function writeLibraryFileContent(
  filePath: string,
  content: string,
): Promise<WriteLibraryFileResult> {
  const normalizedFilePath = normalizeFilesystemPath(filePath)

  try {
    return await invoke<WriteLibraryFileResult>('write_library_file', {
      payload: { filePath: normalizedFilePath, content },
    })
  } catch (error) {
    console.error('[notia] write_library_file failed', error)
    return { ok: false, error: 'Could not write file.' }
  }
}
