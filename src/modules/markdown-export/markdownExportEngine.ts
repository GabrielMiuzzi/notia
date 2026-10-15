import { backendSupports, callBackend } from '../../services/transport'
import { drawDiagramPictures, type DiagramPicture, type DiagramSource } from './diagramPictures'

export type MarkdownExportFormat = 'google-docs' | 'pdf'

export interface MarkdownExportContext {
  /** Library of the exported note. */
  libraryId?: string | null
  /** Path of the note as the explorer shows it; the export is written next to it. */
  sourceDocumentPath?: string | null
}

/** The note's diagrams drawn for its PDF: Rust lists them, the WebView draws them. */
async function diagramPictures(libraryId: string, sourceLogicalPath: string): Promise<DiagramPicture[]> {
  if (!backendSupports('backend_export_diagram_sources')) return []
  const { diagrams } = await callBackend<{ diagrams: DiagramSource[] }>('backend_export_diagram_sources', {
    payload: { libraryId, sourceLogicalPath },
  })
  return drawDiagramPictures(diagrams)
}

/**
 * Exports a Markdown note. In a PDF, Mermaid and XGraph diagrams are
 * pictures of how the note shows them. The backend reads the saved note, renders it
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
  const diagrams = format === 'pdf' ? await diagramPictures(context.libraryId, context.sourceDocumentPath) : []
  const result = await callBackend<{ ok: boolean; error?: string }>('backend_export_markdown_document', {
    payload: {
      libraryId: context.libraryId,
      sourceLogicalPath: context.sourceDocumentPath,
      format: format === 'pdf' ? 'pdf' : 'docx',
      diagrams,
    },
  })
  if (!result.ok) {
    throw new Error(result.error || 'No se pudo exportar el documento.')
  }
  return true
}
