import { backendSupports, callBackend } from '../transport'
import type { MarkdownWikiLinkTarget } from '../../types/views/markdownWikiLink'

/*
 * Wikilinks of a library. The backend lists the notes a link can point to
 * (and the name each one is linked by) and ranks the suggestions for what
 * the person types; the editor resolves the links it draws against them.
 * A published Task Manager page has no library to link to: no targets.
 */

export function readLinkTargets(libraryId: string): Promise<MarkdownWikiLinkTarget[]> {
  if (!backendSupports('library_link_targets')) return Promise.resolve([])
  return callBackend<MarkdownWikiLinkTarget[]>('library_link_targets', { payload: { libraryId } })
}

export function suggestLinkTargets(libraryId: string, query: string, limit?: number): Promise<MarkdownWikiLinkTarget[]> {
  if (!backendSupports('library_link_suggestions')) return Promise.resolve([])
  return callBackend<MarkdownWikiLinkTarget[]>('library_link_suggestions', { payload: { libraryId, query, limit } })
}
