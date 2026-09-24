import { callBackend } from '../../services/transport'

export type MarkdownExportFormat = 'google-docs' | 'pdf'

export interface MarkdownExportContext {
  /** Library of the exported note. */
  libraryId?: string | null
  /** Path of the note as the explorer shows it; the export is written next to it. */
  sourceDocumentPath?: string | null
}

/**
 * Exports a Markdown note. The backend reads the saved note, renders it
 * (formulas included) and writes the PDF or DOCX next to it on Windows and
 * Android (SAF).
 */
export async function exportMarkdownDocument(
  format: MarkdownExportFormat,
  context: MarkdownExportContext,
): Promise<boolean> {
  if (!context.libraryId || !context.sourceDocumentPath) {
    throw new Error('No se pudo resolver la biblioteca activa para exportar el documento.')
  }
  const result = await callBackend<{ ok: boolean; error?: string }>('backend_export_markdown_document', {
    payload: {
      libraryId: context.libraryId,
      sourceLogicalPath: context.sourceDocumentPath,
      format: format === 'pdf' ? 'pdf' : 'docx',
    },
  })
  if (!result.ok) {
    throw new Error(result.error || 'No se pudo exportar el documento.')
  }
  return true
}
