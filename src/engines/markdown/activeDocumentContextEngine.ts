import type { MarkdownSelectionContext } from '../../types/views/markdownSelection'

const MAX_OUTLINE_ENTRIES = 200
const MAX_RANGE_LINES = 120
const MAX_RANGE_CHARS = 12_000
const DEFAULT_CURSOR_CONTEXT_LINES = 12

export interface MarkdownOutlineEntry {
  id: string
  level: number
  text: string
  line: number
  endLine: number
}

export interface MarkdownDocumentOutline {
  totalLines: number
  totalCharacters: number
  headings: readonly MarkdownOutlineEntry[]
  truncated: boolean
}

export type ActiveDocumentRangeTarget = 'heading' | 'block' | 'lines' | 'near-cursor'

export interface ActiveDocumentRangeRequest {
  target: ActiveDocumentRangeTarget
  reference?: string
  fromLine?: number
  toLine?: number
  contextLines?: number
  occurrence?: number
}

export interface MarkdownDocumentRange {
  target: ActiveDocumentRangeTarget
  startLine: number
  endLine: number
  text: string
  truncated: boolean
  matchedReference?: string
}

export interface ActiveDocumentRangeCandidate {
  label: string
  startLine: number
  endLine: number
}

export type ActiveDocumentRangeResult =
  | { ok: true; range: MarkdownDocumentRange; candidates?: readonly MarkdownOutlineEntry[] }
  | { ok: false; error: 'target-required' | 'target-not-found' | 'target-ambiguous' | 'invalid-range' | 'selection-not-found'; candidates?: readonly ActiveDocumentRangeCandidate[] }

interface MarkdownLine {
  number: number
  start: number
  end: number
  text: string
}

interface MarkdownBlock {
  startLine: number
  endLine: number
  text: string
}

function readLines(source: string): MarkdownLine[] {
  if (source.length === 0) return [{ number: 1, start: 0, end: 0, text: '' }]

  const lines: MarkdownLine[] = []
  let start = 0
  let number = 1
  while (start < source.length) {
    const breakIndex = source.indexOf('\n', start)
    const end = breakIndex < 0 ? source.length : breakIndex + 1
    lines.push({
      number,
      start,
      end,
      text: source.slice(start, end).replace(/\r?\n$/, ''),
    })
    start = end
    number += 1
  }
  if (source.endsWith('\n')) {
    lines.push({ number, start: source.length, end: source.length, text: '' })
  }
  return lines
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\x60*_~]/g, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es')
}

function parseHeading(text: string): { level: number; title: string } | null {
  const match = text.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/)
  if (!match?.[1] || !match[2]) return null
  const title = match[2].trim()
  return title ? { level: match[1].length, title } : null
}

function isBlank(text: string): boolean {
  return text.trim().length === 0
}

function isFence(text: string): boolean {
  return /^\s*(?:```|~~~)/.test(text)
}

function buildBlocks(lines: readonly MarkdownLine[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let startLine: number | null = null
  let endLine: number | null = null
  let fenceMarker: string | null = null

  const flush = () => {
    if (startLine === null || endLine === null) return
    const text = lines
      .slice(startLine - 1, endLine)
      .map((line) => line.text)
      .join('\n')
      .trim()
    if (text) blocks.push({ startLine, endLine, text })
    startLine = null
    endLine = null
    fenceMarker = null
  }

  for (const line of lines) {
    if (isBlank(line.text)) {
      if (!fenceMarker) flush()
      continue
    }

    if (startLine === null) {
      startLine = line.number
      endLine = line.number
      fenceMarker = isFence(line.text) ? line.text.trimStart().slice(0, 3) : null
      continue
    }

    if (fenceMarker) {
      endLine = line.number
      if (line.text.trim().startsWith(fenceMarker)) flush()
      continue
    }

    const headingStartsBlock = Boolean(parseHeading(line.text))
    const previousLine = lines[line.number - 2]
    const previousWasHeading = previousLine ? Boolean(parseHeading(previousLine.text)) : false
    if (headingStartsBlock || previousWasHeading) {
      flush()
      startLine = line.number
      endLine = line.number
      fenceMarker = isFence(line.text) ? line.text.trimStart().slice(0, 3) : null
      continue
    }
    endLine = line.number
  }
  flush()
  return blocks
}

function buildOutline(lines: readonly MarkdownLine[]): MarkdownOutlineEntry[] {
  const rawHeadings = lines.flatMap((line) => {
    const heading = parseHeading(line.text)
    return heading ? [{ line, ...heading }] : []
  })

  return rawHeadings.map((heading, index) => {
    const nextSection = rawHeadings.slice(index + 1).find((candidate) => candidate.level <= heading.level)
    return {
      id: `heading-${index + 1}`,
      level: heading.level,
      text: heading.title,
      line: heading.line.number,
      endLine: (nextSection?.line.number ?? lines.length + 1) - 1,
    }
  })
}

export function getMarkdownDocumentOutline(source: string): MarkdownDocumentOutline {
  const lines = readLines(source)
  const headings = buildOutline(lines)
  return {
    totalLines: lines.length,
    totalCharacters: source.length,
    headings: headings.slice(0, MAX_OUTLINE_ENTRIES),
    truncated: headings.length > MAX_OUTLINE_ENTRIES,
  }
}

function clampLine(value: number, totalLines: number): number | null {
  if (!Number.isInteger(value) || value < 1 || value > totalLines) return null
  return value
}

function rangeText(lines: readonly MarkdownLine[], startLine: number, endLine: number): string {
  return lines
    .slice(startLine - 1, endLine)
    .map((line) => line.text)
    .join('\n')
    .trim()
}

function truncateRange(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_RANGE_CHARS) return { text, truncated: false }
  return { text: `${text.slice(0, MAX_RANGE_CHARS)}\n[rango truncado]`, truncated: true }
}

function findReferenceCandidates(
  outline: readonly MarkdownOutlineEntry[],
  reference: string,
): MarkdownOutlineEntry[] {
  const normalizedReference = normalizeSearchText(reference)
  return outline.filter((heading) => {
    const normalizedTitle = normalizeSearchText(heading.text)
    return normalizedTitle === normalizedReference || normalizedTitle.includes(normalizedReference)
  })
}

function findSelectionLine(lines: readonly MarkdownLine[], selection: MarkdownSelectionContext): number | null {
  const selectedText = selection.selectedText.trim()
  const blockText = selection.blocks[0]?.text.trim() ?? ''
  const anchor = selectedText || blockText
  if (anchor) {
    const normalizedAnchor = normalizeSearchText(anchor)
    const match = lines.find((line) => normalizeSearchText(line.text).includes(normalizedAnchor))
    if (match) return match.number
  }
  return clampLine(Math.max(1, Math.round(selection.from)), lines.length)
}

export function readMarkdownDocumentRange(
  source: string,
  request: ActiveDocumentRangeRequest,
  selection?: MarkdownSelectionContext | null,
): ActiveDocumentRangeResult {
  const lines = readLines(source)
  const outline = buildOutline(lines)
  let startLine: number | null = null
  let endLine: number | null = null
  let matchedReference: string | undefined

  if (request.target === 'lines') {
    startLine = clampLine(request.fromLine ?? 0, lines.length)
    endLine = clampLine(request.toLine ?? request.fromLine ?? 0, lines.length)
    if (startLine === null || endLine === null || endLine < startLine) {
      return { ok: false, error: 'invalid-range' }
    }
  } else if (request.target === 'near-cursor') {
    const cursorLine = selection ? findSelectionLine(lines, selection) : null
    if (cursorLine === null) return { ok: false, error: 'selection-not-found' }
    const contextLines = Number.isInteger(request.contextLines) && request.contextLines !== undefined
      ? Math.max(0, Math.min(request.contextLines, MAX_RANGE_LINES))
      : DEFAULT_CURSOR_CONTEXT_LINES
    startLine = Math.max(1, cursorLine - contextLines)
    endLine = Math.min(lines.length, cursorLine + contextLines)
  } else if (request.target === 'heading') {
    const reference = request.reference?.trim() ?? ''
    if (!reference) return { ok: false, error: 'target-required' }
    const candidates = findReferenceCandidates(outline, reference)
    if (candidates.length === 0) return { ok: false, error: 'target-not-found' }
    const occurrence = request.occurrence ?? 1
    if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > candidates.length) {
      return {
        ok: false,
        error: candidates.length > 1 ? 'target-ambiguous' : 'target-not-found',
        ...(candidates.length > 1 ? {
          candidates: candidates.map((candidate) => ({
            label: candidate.text,
            startLine: candidate.line,
            endLine: candidate.endLine,
          })),
        } : {}),
      }
    }
    if (request.occurrence === undefined && candidates.length > 1) {
      return {
        ok: false,
        error: 'target-ambiguous',
        candidates: candidates.map((candidate) => ({
          label: candidate.text,
          startLine: candidate.line,
          endLine: candidate.endLine,
        })),
      }
    }
    const heading = candidates[occurrence - 1]
    if (!heading) return { ok: false, error: 'target-not-found' }
    startLine = heading.line
    endLine = heading.endLine
    matchedReference = heading.text
  } else {
    const reference = request.reference?.trim() ?? ''
    if (!reference) return { ok: false, error: 'target-required' }
    const blocks = buildBlocks(lines)
    const normalizedReference = normalizeSearchText(reference)
    const candidates = blocks.filter((block) => normalizeSearchText(block.text).includes(normalizedReference))
    if (candidates.length === 0) return { ok: false, error: 'target-not-found' }
    const occurrence = request.occurrence ?? 1
    if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > candidates.length) {
      return {
        ok: false,
        error: candidates.length > 1 ? 'target-ambiguous' : 'target-not-found',
        ...(candidates.length > 1 ? {
          candidates: candidates.map((candidate) => ({
            label: candidate.text.slice(0, 160),
            startLine: candidate.startLine,
            endLine: candidate.endLine,
          })),
        } : {}),
      }
    }
    if (request.occurrence === undefined && candidates.length > 1) {
      return {
        ok: false,
        error: 'target-ambiguous',
        candidates: candidates.map((candidate) => ({
          label: candidate.text.slice(0, 160),
          startLine: candidate.startLine,
          endLine: candidate.endLine,
        })),
      }
    }
    const block = candidates[occurrence - 1]
    if (!block) return { ok: false, error: 'target-not-found' }
    startLine = block.startLine
    endLine = block.endLine
    matchedReference = reference
  }

  if (startLine === null || endLine === null || endLine < startLine) {
    return { ok: false, error: 'invalid-range' }
  }
  const requestedEndLine = endLine
  if (endLine - startLine + 1 > MAX_RANGE_LINES) {
    endLine = startLine + MAX_RANGE_LINES - 1
  }
  const boundedEndLine = Math.min(endLine, lines.length)
  const result = truncateRange(rangeText(lines, startLine, boundedEndLine))
  return {
    ok: true,
    range: {
      target: request.target,
      startLine,
      endLine: boundedEndLine,
      text: result.text,
      truncated: result.truncated || boundedEndLine < requestedEndLine,
      ...(matchedReference ? { matchedReference } : {}),
    },
  }
}
