export type DocumentContradictionKind = 'frontmatter' | 'label'

export interface DocumentContradiction {
  kind: DocumentContradictionKind
  key: string
  leftValue: string
  rightValue: string
  leftLine: number
  rightLine: number
  confidence: 'possible'
}

interface Claim {
  kind: DocumentContradictionKind
  key: string
  value: string
  line: number
}

const LABEL_PATTERN = /^\s*(?:[-*+]\s*)?(?:\*\*)?([^:#\n]{2,80})(?:\*\*)?\s*:\s*(\S[^\n]*)\s*$/
const FRONTMATTER_LINE_PATTERN = /^\s*([A-Za-zÀ-ÿ][\wÀ-ÿ -]{1,60})\s*:\s*(\S[^\n]*)\s*$/
const MAX_CLAIMS = 400

function normalizeClaimPart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_*`]+/g, ' ')
    .trim()
    .toLocaleLowerCase('es')
}

function normalizeClaimValue(value: string): string {
  return normalizeClaimPart(value)
    .replace(/^['"]|['"]$/g, '')
    .replace(/[.,;]+$/, '')
}

function collectClaims(source: string, kind: DocumentContradictionKind, pattern: RegExp): Claim[] {
  const claims: Claim[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let inFrontmatter = false

  for (const [index, line] of lines.entries()) {
    if (/^\s*---\s*$/.test(line)) {
      inFrontmatter = !inFrontmatter
      continue
    }
    if (kind === 'frontmatter' && !inFrontmatter) continue
    if (kind === 'label' && inFrontmatter) continue

    const match = pattern.exec(line)
    if (!match) continue
    const key = normalizeClaimPart(match[1] ?? '')
    const value = normalizeClaimValue(match[2] ?? '')
    if (!key || !value || key.length < 2 || value.length > 300) continue
    claims.push({ kind, key, value, line: index + 1 })
    if (claims.length >= MAX_CLAIMS) break
  }

  return claims
}

function collectUniqueClaims(source: string, kind: DocumentContradictionKind, pattern: RegExp): Claim[] {
  const seen = new Set<string>()
  return collectClaims(source, kind, pattern).filter((claim) => {
    const identity = `${claim.key}:${claim.value}`
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

/**
 * Finds only conservative, explicitly labelled disagreements. A changed
 * paragraph is not enough to call something a contradiction; both documents
 * must expose the same labelled field with different normalized values.
 */
export function detectDocumentContradictions(leftSource: string, rightSource: string): DocumentContradiction[] {
  const leftClaims = [
    ...collectUniqueClaims(leftSource, 'frontmatter', FRONTMATTER_LINE_PATTERN),
    ...collectUniqueClaims(leftSource, 'label', LABEL_PATTERN),
  ]
  const rightClaims = [
    ...collectUniqueClaims(rightSource, 'frontmatter', FRONTMATTER_LINE_PATTERN),
    ...collectUniqueClaims(rightSource, 'label', LABEL_PATTERN),
  ]
  const contradictions: DocumentContradiction[] = []
  const emitted = new Set<string>()

  for (const left of leftClaims) {
    const matches = rightClaims.filter((right) => right.key === left.key && right.value !== left.value)
    for (const right of matches) {
      const identity = `${left.kind}:${left.key}:${left.value}:${right.value}`
      if (emitted.has(identity)) continue
      emitted.add(identity)
      contradictions.push({
        kind: left.kind,
        key: left.key,
        leftValue: left.value,
        rightValue: right.value,
        leftLine: left.line,
        rightLine: right.line,
        confidence: 'possible',
      })
    }
  }

  return contradictions.slice(0, 100)
}
