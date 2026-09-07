function normalizeLinkTarget(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '').trim().toLocaleLowerCase('es')
}

function documentLinkName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\.md$/i, '')
  return normalized.split('/').pop() ?? normalized
}

export type DocumentWikilinkAction = 'add' | 'remove'

/** Adds/removes one exact wikilink without rewriting unrelated Markdown. */
export function updateDocumentWikilink(
  source: string,
  targetPath: string,
  action: DocumentWikilinkAction,
  alias?: string,
): { source: string; changed: boolean; linksChanged: number } {
  const target = normalizeLinkTarget(targetPath)
  if (!target) return { source, changed: false, linksChanged: 0 }
  const targetName = documentLinkName(targetPath)
  const targetAliases = [...new Set([target, normalizeLinkTarget(targetName)])]
  const targetPattern = targetAliases
    .map((alias) => alias.split('/').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(?:/|\\\\)'))
    .join('|')
  const exactLink = new RegExp(`\\[\\[${targetPattern}(?:\\|[^\\]]+)?\\]\\]`, 'giu')
  const matches = source.match(exactLink) ?? []
  if (action === 'remove') {
    if (matches.length === 0) return { source, changed: false, linksChanged: 0 }
    const updated = source.replace(exactLink, '').replace(/\n{3,}/g, '\n\n')
    return { source: updated, changed: updated !== source, linksChanged: matches.length }
  }
  if (matches.length > 0) return { source, changed: false, linksChanged: 0 }
  const link = `[[${targetName}${alias?.trim() ? `|${alias.trim().slice(0, 120)}` : ''}]]`
  const separator = source.trimEnd() ? '\n\n' : ''
  return { source: `${source.trimEnd()}${separator}${link}\n`, changed: true, linksChanged: 1 }
}
