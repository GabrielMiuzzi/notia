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
  /** Context the note keeps: the one of its Task Manager board or folder. */
  lockedContext?: string
  /** What sets `lockedContext`. */
  lockedContextSource?: LockedContextSource
  /** Why the document opens read-only (a file only the AI writes, `#System`); the backend refuses its writes. */
  readOnly?: string
}

export type LockedContextSource = 'board' | 'folder'

export interface WriteLibraryFileResult {
  ok: boolean
  error?: string
  /** Revision of the content the backend wrote. */
  revision?: string
  /** What the backend wrote when it is not the text sent: the editor's
   * changes merged with the ones the file got meanwhile. */
  content?: string
  /** Places where both changed the same lines; both versions stayed. */
  mergeConflicts?: number
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
  /** The text the editor last read or saved: if the file changed since,
   * the backend merges both changes instead of refusing the save. */
  baseContent?: string
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
        ...(options.baseContent !== undefined ? { baseContent: options.baseContent } : {}),
      },
    })
    timer.success({ ok: result.ok })
    return result
  } catch (error) {
    timer.error(error)
    return { ok: false, error: 'No se pudo guardar el archivo.' }
  }
}
