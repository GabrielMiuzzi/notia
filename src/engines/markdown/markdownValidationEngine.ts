export type MarkdownValidationIssueCode =
  | 'unclosed-fence'
  | 'unclosed-frontmatter'
  | 'unbalanced-formula'
  | 'unbalanced-link'
  | 'malformed-link'
  | 'heading-level-jump'
  | 'malformed-table'
  | 'frontmatter-changed'

export interface MarkdownValidationIssue {
  code: MarkdownValidationIssueCode
  message: string
  line: number | null
}

export interface MarkdownValidationResult {
  ok: boolean
  issues: readonly MarkdownValidationIssue[]
}

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, Math.max(0, offset)).split('\n').length
}

function countUnescaped(source: string, token: string): number {
  let count = 0
  let offset = 0
  while (offset < source.length) {
    const index = source.indexOf(token, offset)
    if (index < 0) break
    if (index === 0 || source[index - 1] !== '\\') count += 1
    offset = index + token.length
  }
  return count
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|') && !trimmed.startsWith('```') && !trimmed.startsWith('~~~')
}

function tableColumnCount(line: string): number {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').length
}

function isTableSeparator(line: string): boolean {
  if (!isTableRow(line)) return false
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
}

export function validateMarkdownDocument(source: string): MarkdownValidationResult {
  const issues: MarkdownValidationIssue[] = []
  const frontmatterStart = source.startsWith('---\n')
  if (frontmatterStart && !/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(source)) {
    issues.push({ code: 'unclosed-frontmatter', message: 'El frontmatter no tiene un cierre válido.', line: 1 })
  }

  const lines = source.split(/\r?\n/)
  let fenceMarker: string | null = null
  let previousHeadingLevel: number | null = null
  lines.forEach((line, index) => {
    const trimmed = line.trimStart()
    if (!fenceMarker && /^(?:```|~~~)/.test(trimmed)) {
      fenceMarker = trimmed.slice(0, 3)
    } else if (fenceMarker && trimmed.startsWith(fenceMarker)) {
      fenceMarker = null
    }
    if (line.includes('$$') && countUnescaped(line, '$$') % 2 !== 0) {
      issues.push({ code: 'unbalanced-formula', message: 'El delimitador de fórmula $$ quedó abierto en esta línea.', line: index + 1 })
    }
    if (!fenceMarker) {
      const heading = /^(#{1,6})\s+\S/.exec(trimmed)
      if (heading) {
        const level = heading[1].length
        if (previousHeadingLevel !== null && level > previousHeadingLevel + 1) {
          issues.push({ code: 'heading-level-jump', message: 'La jerarquia de headings salta mas de un nivel.', line: index + 1 })
        }
        previousHeadingLevel = level
      }
      if (/\[[^\]]*\]\([^)]*$/.test(line)) {
        issues.push({ code: 'malformed-link', message: 'Hay un enlace Markdown sin cerrar.', line: index + 1 })
      }
    }
  })
  if (fenceMarker) {
    issues.push({ code: 'unclosed-fence', message: 'El bloque de código Markdown quedó sin cerrar.', line: lines.length })
  }
  if (countUnescaped(source, '[') !== countUnescaped(source, ']')) {
    issues.push({ code: 'unbalanced-link', message: 'Hay corchetes de enlaces Markdown desbalanceados.', line: null })
  }
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isTableRow(lines[index]) || !isTableSeparator(lines[index + 1])) continue
    const expectedColumns = tableColumnCount(lines[index])
    if (expectedColumns < 2) {
      issues.push({ code: 'malformed-table', message: 'La tabla Markdown no tiene suficientes columnas.', line: index + 1 })
      continue
    }
    let rowIndex = index
    while (rowIndex < lines.length && isTableRow(lines[rowIndex])) {
      if (tableColumnCount(lines[rowIndex]) !== expectedColumns) {
        issues.push({ code: 'malformed-table', message: 'Las filas de la tabla Markdown no tienen la misma cantidad de columnas.', line: rowIndex + 1 })
      }
      rowIndex += 1
    }
    index = rowIndex - 1
  }
  return { ok: issues.length === 0, issues }
}

export function validateDocumentEdit(originalSource: string, nextSource: string): MarkdownValidationResult {
  const issues = [...validateMarkdownDocument(nextSource).issues]
  const originalFrontmatter = originalSource.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? ''
  const nextFrontmatter = nextSource.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? ''
  if (originalFrontmatter && originalFrontmatter !== nextFrontmatter) {
    issues.push({ code: 'frontmatter-changed', message: 'La propuesta alteraría el frontmatter existente.', line: lineNumberAt(nextSource, 0) })
  }
  return { ok: issues.length === 0, issues }
}
