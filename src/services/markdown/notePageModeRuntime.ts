import { callBackend } from '../transport'
import { getFrontmatterValue, parseFrontmatterDocument } from '../../engines/markdown/frontmatterEngine'

/*
 * Page mode is a property of each note (`pageMode: true`), so every note
 * opens as it was left and the normal editor is the default. Rust writes and
 * removes the property (`markdown_set_page_mode`) and decides the PDF export
 * from the saved note (`note_page_mode`).
 */

export const NOTE_PAGE_MODE_PROPERTY = 'pageMode'

/** The note with page mode turned on or off, as Rust writes it. */
export async function setNotePageMode(source: string, enabled: boolean): Promise<string> {
  const result = await callBackend<{ source: string; pageMode: boolean }>('markdown_set_page_mode', {
    payload: { source, enabled },
  })
  return result.source
}

/**
 * Whether the open note is drawn on pages. Only drawing depends on it; it
 * reads the property the way Rust's `note_page_mode` does.
 */
export function readNotePageMode(source: string): boolean {
  const value = getFrontmatterValue(parseFrontmatterDocument(source).frontmatter, NOTE_PAGE_MODE_PROPERTY)
  return String(value).toLowerCase() === 'true'
}
