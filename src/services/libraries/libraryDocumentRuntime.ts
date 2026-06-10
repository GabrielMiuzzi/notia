import { readTextFile, writeTextFile, type AndroidFilesystemOptions } from '../files/filesystemEngine'
import { notiaTimer } from '../runtime/notiaLogger'
import { ensureMarkdownDefaults } from '../../engines/markdown/frontmatterEngine'

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

export async function readMarkdownWithDefaults(
  filePath: string,
  options?: AndroidFilesystemOptions,
): Promise<ReadLibraryFileResult> {
  const timer = notiaTimer('documentRuntime', 'readMarkdownWithDefaults', { path: filePath })
  try {
    const result = await readTextFile(filePath, options)
    if (!result.ok || !result.content) {
      timer.success({ ok: result.ok, mutated: false })
      return result
    }

    const { source: nextSource, mutated } = ensureMarkdownDefaults(result.content, {
      createdAt: Date.now(),
    })

    if (mutated) {
      const writeResult = await writeTextFile(filePath, nextSource, options)
      if (!writeResult.ok) {
        timer.error(new Error(writeResult.error ?? 'Failed to write defaults'))
        console.error('[notia] readMarkdownWithDefaults write failed:', writeResult.error)
      } else {
        timer.success({ ok: true, mutated: true })
      }
    } else {
      timer.success({ ok: true, mutated: false })
    }

    return { ok: true, content: nextSource }
  } catch (error) {
    timer.error(error)
    console.error('[notia] readMarkdownWithDefaults failed', error)
    return { ok: false, content: '', error: 'Could not read file with defaults.' }
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
