export interface DocumentLinkChange {
  path: string
  original: string
  updated: string
  replacements: number
}

export interface DocumentRenamePreview {
  oldPath: string
  newPath: string
  changes: readonly DocumentLinkChange[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function linkTargetName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\.md$/i, '')
  return normalized.split('/').pop() ?? normalized
}

/** Rewrites only exact Markdown/wiki link targets; prose and code are preserved. */
export function replaceDocumentLinks(source: string, oldPath: string, newPath: string): { source: string; replacements: number } {
  const oldNormalized = oldPath.replace(/\\/g, '/').replace(/\.md$/i, '')
  const newNormalized = newPath.replace(/\\/g, '/').replace(/\.md$/i, '')
  const oldName = linkTargetName(oldPath)
  const newName = linkTargetName(newPath)
  const targets = new Set([oldNormalized, oldName])
  const targetPattern = Array.from(targets).map(escapeRegExp).join('|')
  let replacements = 0
  let updated = source.replace(new RegExp(`(\\[\\[)(?:${targetPattern})(\\|[^\\]]+)?(\\]\\])`, 'g'), (_match, open: string, alias: string | undefined, close: string) => {
    replacements += 1
    return `${open}${newName}${alias ?? ''}${close}`
  })
  updated = updated.replace(new RegExp(`\\[([^\\]]+)\\]\\((${targetPattern})(\\.md)?([)#?])`, 'g'), (_match, label: string, _target: string, extension: string | undefined, suffix: string) => {
    replacements += 1
    return `[${label}](${newNormalized}${extension ?? ''}${suffix}`
  })
  return { source: updated, replacements }
}

export function buildDocumentRenamePreview(
  documents: readonly { path: string; content: string }[],
  oldPath: string,
  newPath: string,
): DocumentRenamePreview {
  const changes = documents
    .map((document) => {
      const result = replaceDocumentLinks(document.content, oldPath, newPath)
      return { path: document.path, original: document.content, updated: result.source, replacements: result.replacements }
    })
    .filter((change) => change.replacements > 0)
  return { oldPath, newPath, changes }
}
