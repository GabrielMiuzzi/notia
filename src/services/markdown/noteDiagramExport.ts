import { callBackend } from '../transport'

/*
 * Saves a diagram of a note (a Mermaid SVG, an XGraph PNG) next to the note.
 * Rust validates the image, picks a free name and writes it on Windows and
 * Android (SAF).
 */

export interface NoteDiagramExportResult {
  /** Where the image went, as the explorer shows it. */
  path: string
}

/** `data` is the SVG markup, or the PNG in base64. */
export async function exportNoteDiagram(libraryId: string, notePath: string, format: 'svg' | 'png', data: string): Promise<string> {
  const result = await callBackend<NoteDiagramExportResult>('markdown_export_diagram', {
    payload: { libraryId, path: notePath, format, data },
  })
  return result.path
}
