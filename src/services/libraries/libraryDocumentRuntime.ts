import { readTextFile, writeTextFile } from '../files/filesystemEngine'

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
  try {
    return await readTextFile(filePath)
  } catch (error) {
    console.error('[notia] read_library_file failed', error)
    return { ok: false, content: '', error: 'Could not read file.' }
  }
}

export async function writeLibraryFileContent(
  filePath: string,
  content: string,
): Promise<WriteLibraryFileResult> {
  try {
    return await writeTextFile(filePath, content)
  } catch (error) {
    console.error('[notia] write_library_file failed', error)
    return { ok: false, error: 'Could not write file.' }
  }
}
