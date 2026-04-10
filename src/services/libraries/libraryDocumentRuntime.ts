import { readTextFile, writeTextFile, type AndroidFilesystemOptions } from '../files/filesystemEngine'

interface ReadLibraryFileResult {
  ok: boolean
  content: string
  error?: string
}

interface WriteLibraryFileResult {
  ok: boolean
  error?: string
}

export async function readLibraryFileContent(
  filePath: string,
  options?: AndroidFilesystemOptions,
): Promise<ReadLibraryFileResult> {
  try {
    return await readTextFile(filePath, options)
  } catch (error) {
    console.error('[notia] read_library_file failed', error)
    return { ok: false, content: '', error: 'Could not read file.' }
  }
}

export async function writeLibraryFileContent(
  filePath: string,
  content: string,
  options?: AndroidFilesystemOptions,
): Promise<WriteLibraryFileResult> {
  try {
    return await writeTextFile(filePath, content, options)
  } catch (error) {
    console.error('[notia] write_library_file failed', error)
    return { ok: false, error: 'Could not write file.' }
  }
}
