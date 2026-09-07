import { getFrontmatterValue, parseFrontmatterDocument, serializeFrontmatterDocument, setFrontmatterValue } from '../markdown/frontmatterEngine'

export type DocumentTagAction = 'add' | 'remove' | 'replace'

function normalizeTag(value: string): string {
  return value.replace(/^#+/, '').trim()
}

function readTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return values
    .filter((item): item is string => typeof item === 'string')
    .map(normalizeTag)
    .filter(Boolean)
}

export function updateDocumentTags(source: string, tags: readonly string[], action: DocumentTagAction): { source: string; changed: boolean; tags: string[] } {
  const document = parseFrontmatterDocument(source)
  const current = readTags(getFrontmatterValue(document.frontmatter, 'tags'))
  const requested = tags.map(normalizeTag).filter(Boolean)
  const unique = (values: readonly string[]) => values.filter((value, index) => values.findIndex((candidate) => candidate.toLocaleLowerCase('es') === value.toLocaleLowerCase('es')) === index)
  const nextTags = action === 'replace'
    ? unique(requested)
    : action === 'add'
      ? unique([...current, ...requested])
      : current.filter((value) => !requested.some((candidate) => candidate.toLocaleLowerCase('es') === value.toLocaleLowerCase('es')))
  const changed = current.length !== nextTags.length || current.some((tag, index) => tag !== nextTags[index])
  if (!changed) return { source, changed: false, tags: current }
  return {
    source: serializeFrontmatterDocument({
      hasFrontmatter: true,
      frontmatter: setFrontmatterValue(document.frontmatter, 'tags', nextTags),
      body: document.body,
    }),
    changed: true,
    tags: nextTags,
  }
}
