import { callBackend } from '../transport'

/*
 * The card a link between notes shows on hover. Rust reads the linked note
 * and gives its folders, title, the start of its text, when it was edited
 * and how many links it has.
 */

export interface NoteLinkPreview {
  title: string
  /** «Personal / filosofia»; empty at the library root. */
  folder: string
  excerpt: string
  /** «Editada hace 3 días»; absent when the library does not say. */
  edited?: string
  links: number
}

export function loadNoteLinkPreview(libraryId: string, path: string): Promise<NoteLinkPreview> {
  return callBackend<NoteLinkPreview>('markdown_note_preview', { payload: { libraryId, path } })
}
