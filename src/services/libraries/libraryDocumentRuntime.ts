import { readTextFile, writeTextFile, type AndroidFilesystemOptions } from '../files/filesystemEngine'
import { notiaTimer } from '../runtime/notiaLogger'

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
  const timer = notiaTimer('documentRuntime', 'readLibraryFileContent', { path: filePath })
  try {
    const result = await readTextFile(filePath, options)
    timer.success({ ok: result.ok })
    return result
  } catch (error) {
    timer.error(error)
    console.error('[notia] read_library_file failed', error)
    return { ok: false, content: '', error: 'Could not read file.' }
  }
}

export async function writeLibraryFileContent(
  filePath: string,
  content: string,
  options?: AndroidFilesystemOptions,
): Promise<WriteLibraryFileResult> {
  const timer = notiaTimer('documentRuntime', 'writeLibraryFileContent', { path: filePath })
  try {
    const result = await writeTextFile(filePath, content, options)
    timer.success({ ok: result.ok })
    return result
  } catch (error) {
    timer.error(error)
    console.error('[notia] write_library_file failed', error)
    return { ok: false, error: 'Could not write file.' }
  }
}
