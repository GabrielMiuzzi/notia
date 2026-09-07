import { detectDocumentContradictions, type DocumentContradiction } from './documentContradictionEngine'

export type DocumentComparisonLineKind = 'unchanged' | 'added' | 'removed'

export interface DocumentComparisonLine {
  kind: DocumentComparisonLineKind
  text: string
  leftLine: number | null
  rightLine: number | null
}

export interface DocumentComparisonResult {
  leftLineCount: number
  rightLineCount: number
  unchangedLineCount: number
  addedLineCount: number
  removedLineCount: number
  truncated: boolean
  lines: readonly DocumentComparisonLine[]
  contradictions: readonly DocumentContradiction[]
}

const MAX_COMPARISON_LINES = 1200
const MAX_RETURNED_LINES = 240

function splitLines(source: string): string[] {
  return source.replace(/\r\n/g, '\n').split('\n')
}

/**
 * Produces a bounded line-level comparison. It deliberately returns source
 * line numbers with each change so the agent can cite evidence without
 * receiving two complete documents in its context.
 */
export function compareDocumentLines(leftSource: string, rightSource: string): DocumentComparisonResult {
  const left = splitLines(leftSource)
  const right = splitLines(rightSource)
  const leftWindow = left.slice(0, MAX_COMPARISON_LINES)
  const rightWindow = right.slice(0, MAX_COMPARISON_LINES)
  const truncated = left.length > leftWindow.length || right.length > rightWindow.length
  const columns = rightWindow.length + 1
  const rows = Array.from({ length: leftWindow.length + 1 }, () => new Uint16Array(columns))

  for (let leftIndex = leftWindow.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightWindow.length - 1; rightIndex >= 0; rightIndex -= 1) {
      rows[leftIndex][rightIndex] = leftWindow[leftIndex] === rightWindow[rightIndex]
        ? rows[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(rows[leftIndex + 1][rightIndex], rows[leftIndex][rightIndex + 1])
    }
  }

  const lines: DocumentComparisonLine[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < leftWindow.length || rightIndex < rightWindow.length) {
    if (leftIndex < leftWindow.length && rightIndex < rightWindow.length && leftWindow[leftIndex] === rightWindow[rightIndex]) {
      lines.push({ kind: 'unchanged', text: leftWindow[leftIndex], leftLine: leftIndex + 1, rightLine: rightIndex + 1 })
      leftIndex += 1
      rightIndex += 1
      continue
    }
    if (leftIndex < leftWindow.length && (rightIndex >= rightWindow.length || rows[leftIndex + 1][rightIndex] >= rows[leftIndex][rightIndex + 1])) {
      lines.push({ kind: 'removed', text: leftWindow[leftIndex], leftLine: leftIndex + 1, rightLine: null })
      leftIndex += 1
      continue
    }
    if (rightIndex < rightWindow.length) {
      lines.push({ kind: 'added', text: rightWindow[rightIndex], leftLine: null, rightLine: rightIndex + 1 })
      rightIndex += 1
    }
  }

  const returnedLines = lines.slice(0, MAX_RETURNED_LINES)
  return {
    leftLineCount: left.length,
    rightLineCount: right.length,
    unchangedLineCount: lines.filter((line) => line.kind === 'unchanged').length,
    addedLineCount: lines.filter((line) => line.kind === 'added').length,
    removedLineCount: lines.filter((line) => line.kind === 'removed').length,
    truncated: truncated || lines.length > returnedLines.length,
    lines: returnedLines,
    contradictions: detectDocumentContradictions(leftSource, rightSource),
  }
}
