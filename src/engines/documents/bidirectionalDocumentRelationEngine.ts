import {
  getFrontmatterValue,
  parseFrontmatterDocument,
  serializeFrontmatterDocument,
  setFrontmatterValue,
  type FrontmatterValue,
} from '../markdown/frontmatterEngine'

export type DocumentRelationAction = 'add' | 'remove'

export interface BidirectionalDocumentRelationResult {
  ticketSource: string
  documentSource: string
  changed: boolean
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').toLocaleLowerCase('es')
}

function relationPath(value: string): string {
  const trimmed = value.trim()
  const wikiLink = trimmed.match(/^\[\[(.*?)\]\]$/)?.[1] ?? trimmed
  return normalizePath((wikiLink.split('|').pop() ?? wikiLink).split('#')[0] ?? '')
}

function readRelationValues(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return typeof value === 'string' && value.trim() ? [value] : []
}

function updateRelation(
  source: string,
  key: string,
  targetPath: string,
  action: DocumentRelationAction,
): { source: string; changed: boolean } {
  const document = parseFrontmatterDocument(source)
  const current = readRelationValues(getFrontmatterValue(document.frontmatter, key))
  const target = normalizePath(targetPath)
  const matching = current.filter((value) => relationPath(value) === target)
  const next = action === 'add'
    ? [...current, `[[${targetPath.replace(/\\/g, '/').replace(/^\/+/, '')}]]`]
    : current.filter((value) => relationPath(value) !== target)
  const unique = next.filter((value, index, values) => values.findIndex((candidate) => relationPath(candidate) === relationPath(value)) === index)
  const changed = action === 'add' ? matching.length === 0 : matching.length > 0
  if (!changed) return { source, changed: false }
  return {
    source: serializeFrontmatterDocument({
      hasFrontmatter: true,
      frontmatter: setFrontmatterValue(document.frontmatter, key, unique),
      body: document.body,
    }),
    changed: true,
  }
}

export function updateBidirectionalDocumentRelation(input: {
  ticketSource: string
  documentSource: string
  ticketPath: string
  documentPath: string
  action: DocumentRelationAction
}): BidirectionalDocumentRelationResult {
  const ticket = updateRelation(input.ticketSource, 'relatedDocuments', input.documentPath, input.action)
  const document = updateRelation(input.documentSource, 'relatedTasks', input.ticketPath, input.action)
  return {
    ticketSource: ticket.source,
    documentSource: document.source,
    changed: ticket.changed || document.changed,
  }
}
