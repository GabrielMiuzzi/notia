import { invoke } from '@tauri-apps/api/core'
import {
  readTextFile,
  writeTextFile,
  type AndroidFilesystemOptions,
  type FilesystemOperationResult,
  type FilesystemReadTextResult,
} from '../files/filesystemEngine'
import { notiaTimer } from '../runtime/notiaLogger'
import { buildRelativeLibraryPath } from './libraryPathMapping'
import type { NotiaLibrary } from '../../types/notia'

export type ReadLibraryFileResult = FilesystemReadTextResult

export type WriteLibraryFileResult = FilesystemOperationResult

export interface LibraryDocumentOptions extends AndroidFilesystemOptions {
  libraryId?: string
  logicalPath?: string
  /** Backend creates the document when missing (ignored with a revision). */
  createIfMissing?: boolean
}

interface BackendDocumentIdentity {
  libraryId: string
  logicalPath: string
}

function getBackendDocumentIdentity(options?: LibraryDocumentOptions): BackendDocumentIdentity | null {
  if (
    !options
    || typeof options.libraryId !== 'string'
    || !options.libraryId.trim()
    || typeof options.logicalPath !== 'string'
    || !options.logicalPath.trim()
  ) {
    return null
  }

  return {
    libraryId: options.libraryId,
    logicalPath: options.logicalPath,
  }
}

export function resolveLibraryDocumentLogicalPath(libraryPath: string, targetPath: string): string | undefined {
  const relativePath = buildRelativeLibraryPath(libraryPath, targetPath)
  if (relativePath !== null && relativePath.trim()) {
    return relativePath.replace(/\\/g, '/')
  }

  const candidate = targetPath.trim().replace(/\\/g, '/')
  if (
    !candidate
    || candidate.startsWith('/')
    || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(candidate)
    || /^[A-Za-z]:\//.test(candidate)
  ) {
    return undefined
  }

  return candidate
}

export function getLibraryMarkdownDocumentOptions(
  library: NotiaLibrary,
  targetPath: string,
): LibraryDocumentOptions | undefined {
  if (typeof library.id !== 'string' || !library.id.trim()) return undefined

  const logicalPath = resolveLibraryDocumentLogicalPath(library.path, targetPath)
  if (!logicalPath) return undefined

  const segments = logicalPath.split('/')
  const fileName = segments[segments.length - 1] ?? ''
  const safe = segments.length > 0
    && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes('\\') && !segment.includes(':'))
    && /\.md$/i.test(fileName)
  if (!safe) return undefined

  return {
    androidDirectoryUri: library.androidTreeUri,
    libraryId: library.id,
    logicalPath,
  }
}

export async function readLibraryFileContent(
  filePath: string,
  options?: LibraryDocumentOptions,
): Promise<ReadLibraryFileResult> {
  return readLibraryDocument(filePath, options, false)
}

/**
 * Reads a Markdown note. With a library identity the backend also adds the
 * default frontmatter when missing and persists it against the revision it
 * just read; the WebView never decides or writes those defaults.
 */
export async function readMarkdownWithDefaults(
  filePath: string,
  options?: LibraryDocumentOptions,
): Promise<ReadLibraryFileResult> {
  return readLibraryDocument(filePath, options, true)
}

async function readLibraryDocument(
  filePath: string,
  options: LibraryDocumentOptions | undefined,
  ensureMarkdownDefaults: boolean,
): Promise<ReadLibraryFileResult> {
  const timer = notiaTimer('documentRuntime', ensureMarkdownDefaults ? 'readMarkdownWithDefaults' : 'readLibraryFileContent')
  try {
    const identity = getBackendDocumentIdentity(options)
    const result = identity
      ? await invoke<ReadLibraryFileResult>('backend_read_library_document', {
        payload: {
          libraryId: identity.libraryId,
          logicalPath: identity.logicalPath,
          ...(ensureMarkdownDefaults ? { ensureMarkdownDefaults: true } : {}),
        },
      })
      : await readTextFile(filePath, options)
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
  options?: LibraryDocumentOptions,
): Promise<WriteLibraryFileResult> {
  const timer = notiaTimer('documentRuntime', 'writeLibraryFileContent')
  try {
    const identity = getBackendDocumentIdentity(options)
    const result = identity
      ? await invoke<WriteLibraryFileResult>('backend_write_library_document', {
        payload: {
          libraryId: identity.libraryId,
          logicalPath: identity.logicalPath,
          content,
          ...(options?.expectedRevision !== undefined ? { expectedRevision: options.expectedRevision } : {}),
          ...(options?.createIfMissing ? { createIfMissing: true } : {}),
        },
      })
      : await writeTextFile(filePath, content, options)
    timer.success({ ok: result.ok })
    return result
  } catch (error) {
    timer.error(error)
    console.error('[notia] write_library_file failed', error)
    return { ok: false, error: 'Could not write file.' }
  }
}
