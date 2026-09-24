import { callBackend } from '../transport'
import { notiaTimer } from '../runtime/notiaLogger'

/**
 * Library document client. Documents are addressed by library and by the
 * path the explorer shows (or their path inside the library); the backend
 * resolves the location and checks revisions on write.
 */

export interface ReadLibraryFileResult {
  ok: boolean
  content: string
  revision?: string
  error?: string
  /** Path of the document inside the library. */
  logicalPath?: string
  /** Context of the Task Manager board the note lives in. */
  lockedContext?: string
}

export interface WriteLibraryFileResult {
  ok: boolean
  error?: string
  /** Revision of the content the backend wrote. */
  revision?: string
  conflict?: {
    kind: 'revision'
    expectedRevision: string
    currentRevision?: string | null
  }
}

export interface WriteLibraryDocumentOptions {
  /** Only overwrite the version the editor loaded or saved. */
  expectedRevision?: string
  /** Create the document when missing (ignored with a revision). */
  createIfMissing?: boolean
}

/**
 * Reads a document. `markdownDefaults` asks the backend to add the default
 * note frontmatter when missing (the editor opening a note).
 */
export async function readLibraryDocument(
  libraryId: string,
  path: string,
  options: { markdownDefaults?: boolean } = {},
): Promise<ReadLibraryFileResult> {
  const timer = notiaTimer('documentRuntime', 'readLibraryDocument')
  try {
    const result = await callBackend<ReadLibraryFileResult>('library_read_document', {
      payload: { libraryId, path, ...(options.markdownDefaults ? { markdownDefaults: true } : {}) },
    })
    timer.success({ ok: result.ok })
    return result
  } catch (error) {
    timer.error(error)
    return { ok: false, content: '', error: 'No se pudo leer el archivo.' }
  }
}

export async function writeLibraryDocument(
  libraryId: string,
  path: string,
  content: string,
  options: WriteLibraryDocumentOptions = {},
): Promise<WriteLibraryFileResult> {
  const timer = notiaTimer('documentRuntime', 'writeLibraryDocument')
  try {
    const result = await callBackend<WriteLibraryFileResult>('library_write_document', {
      payload: {
        libraryId,
        path,
        content,
        ...(options.expectedRevision !== undefined ? { expectedRevision: options.expectedRevision } : {}),
        ...(options.createIfMissing ? { createIfMissing: true } : {}),
      },
    })
    timer.success({ ok: result.ok })
    return result
  } catch (error) {
    timer.error(error)
    return { ok: false, error: 'No se pudo guardar el archivo.' }
  }
}
