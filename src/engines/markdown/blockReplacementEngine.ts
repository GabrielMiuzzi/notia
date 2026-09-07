import type { MarkdownSelectionContext } from '../../types/views/markdownSelection'

interface MarkdownBlockRange {
  index: number
  start: number
  end: number
}

export type MarkdownBlockReplacementResult =
  | { ok: true; source: string; replacedBlockCount: number }
  | { ok: false; error: 'selection-required' | 'selection-does-not-match-document' | 'selection-block-not-found' }

export type MarkdownReferenceEditError =
  | 'target-required'
  | 'target-not-found'
  | 'target-ambiguous'
  | 'invalid-occurrence'
  | 'content-required'
  | 'destination-required'
  | 'destination-not-found'
  | 'destination-ambiguous'
  | 'same-block'

export type MarkdownReferenceEditResult =
  | { ok: true; source: string; affectedBlockCount: number; matchedText?: string }
  | { ok: false; error: MarkdownReferenceEditError }

interface MarkdownLine {
  start: number
  contentEnd: number
  end: number
  text: string
}

function readLines(source: string): MarkdownLine[] {
  const lines: MarkdownLine[] = []
  let start = 0

  while (start < source.length) {
    const lineBreakIndex = source.indexOf('\n', start)
    const end = lineBreakIndex < 0 ? source.length : lineBreakIndex + 1
    const rawLine = source.slice(start, end)
    const text = rawLine.replace(/\r?\n$/, '')
    lines.push({
      start,
      contentEnd: start + text.length,
      end,
      text,
    })
    start = end
  }

  return lines
}

function isBlankLine(text: string): boolean {
  return text.trim().length === 0
}

function markdownBlockKind(text: string): 'heading' | 'fence' | 'rule' | 'quote' | 'list' | 'paragraph' {
  const trimmed = text.trimStart()
  if (/^#{1,6}(?:\s|$)/.test(trimmed)) return 'heading'
  if (/^(?:```|~~~)/.test(trimmed)) return 'fence'
  if (/^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$/.test(trimmed)) return 'rule'
  if (/^>/.test(trimmed)) return 'quote'
  if (/^(?:[-+*]|\d+[.)])\s+/.test(trimmed)) return 'list'
  return 'paragraph'
}

function isFenceClosingLine(text: string, fenceMarker: string): boolean {
  const trimmed = text.trim()
  return trimmed.length >= fenceMarker.length
    && trimmed.split('').every((character) => character === fenceMarker[0])
}

function collectMarkdownBlockRanges(source: string): MarkdownBlockRange[] {
  const lines = readLines(source)
  const ranges: MarkdownBlockRange[] = []
  let blockStart: MarkdownLine | null = null
  let blockEnd: MarkdownLine | null = null
  let blockKind: ReturnType<typeof markdownBlockKind> | null = null
  let fenceMarker: string | null = null

  const flush = () => {
    if (!blockStart || !blockEnd) return
    ranges.push({
      index: ranges.length,
      start: blockStart.start,
      end: blockEnd.contentEnd,
    })
    blockStart = null
    blockEnd = null
    blockKind = null
    fenceMarker = null
  }

  for (const line of lines) {
    if (isBlankLine(line.text)) {
      if (!fenceMarker) flush()
      continue
    }

    const lineKind = markdownBlockKind(line.text)
    if (!blockStart) {
      blockStart = line
      blockEnd = line
      blockKind = lineKind
      if (lineKind === 'fence') {
        fenceMarker = line.text.trimStart().slice(0, 3)
      }
      continue
    }

    if (fenceMarker) {
      blockEnd = line
      if (isFenceClosingLine(line.text, fenceMarker)) {
        flush()
      }
      continue
    }

    const startsNewBlock = lineKind === 'heading'
      || lineKind === 'fence'
      || lineKind === 'rule'
      || (lineKind === 'quote' && blockKind !== 'quote')
      || (lineKind === 'list' && blockKind !== 'list')
      || (lineKind === 'paragraph' && (blockKind === 'heading' || blockKind === 'rule' || blockKind === 'quote' || blockKind === 'list'))

    if (startsNewBlock) {
      flush()
      blockStart = line
      blockEnd = line
      blockKind = lineKind
      if (lineKind === 'fence') {
        fenceMarker = line.text.trimStart().slice(0, 3)
      }
      continue
    }

    blockEnd = line
  }

  flush()
  return ranges
}

function findBodyStart(source: string): number {
  if (!/^---\r?\n/.test(source)) return 0

  const firstLineEnd = source.indexOf('\n') + 1
  const closingMarker = /^(?:---)[ \t]*(?:\r?\n|$)/gm
  closingMarker.lastIndex = firstLineEnd
  const closingMatch = closingMarker.exec(source)
  return closingMatch ? closingMatch.index + closingMatch[0].length : 0
}

export function replaceSelectedMarkdownBlocks(
  source: string,
  selection: MarkdownSelectionContext,
  replacement: string,
): MarkdownBlockReplacementResult {
  if (selection.blocks.length === 0) {
    return { ok: false, error: 'selection-required' }
  }

  if (selection.documentPath.length === 0) {
    return { ok: false, error: 'selection-does-not-match-document' }
  }

  const bodyStart = findBodyStart(source)
  const body = source.slice(bodyStart)
  const ranges = collectMarkdownBlockRanges(body)
  const selectedIndexes = [...new Set(selection.blocks.map((block) => block.index))].sort((left, right) => left - right)
  const firstIndex = selectedIndexes[0]
  const lastIndex = selectedIndexes[selectedIndexes.length - 1]

  if (firstIndex === undefined || lastIndex === undefined) {
    return { ok: false, error: 'selection-required' }
  }

  if (selectedIndexes.some((index, offset) => index !== firstIndex + offset)) {
    return { ok: false, error: 'selection-block-not-found' }
  }

  const firstRange = ranges[firstIndex]
  const lastRange = ranges[lastIndex]
  if (!firstRange || !lastRange) {
    return { ok: false, error: 'selection-block-not-found' }
  }

  const normalizedReplacement = replacement.trim()
  const nextBody = `${body.slice(0, firstRange.start)}${normalizedReplacement}${body.slice(lastRange.end)}`
  return {
    ok: true,
    source: `${source.slice(0, bodyStart)}${nextBody}`,
    replacedBlockCount: selectedIndexes.length,
  }
}

function normalizeReferenceText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[`*_~]/g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es')
}

function referenceVariants(value: string): string[] {
  const normalized = normalizeReferenceText(value)
  const withoutDescriptor = normalized.replace(
    /^(?:(?:el|la|los|las|un|una)\s+)?(?:punto|apartado|inciso|ejercicio|item)\s+/,
    '',
  )
  return [...new Set([normalized, withoutDescriptor].filter(Boolean))]
}

interface MarkdownLabelReference {
  label: string
  exerciseNumber?: number
}

function parseMarkdownLabelReference(value: string): MarkdownLabelReference | null {
  const normalized = normalizeReferenceText(value)
  const labelMatch = normalized.match(/\b(?:inciso|apartado|punto|item)\s+([a-z]|\d+)\b/i)
  if (!labelMatch?.[1]) return null

  const exerciseMatch = normalized.match(/\b(?:ejercicio|problema)\s+(\d+)\b/i)
  const exerciseNumber = exerciseMatch?.[1] ? Number(exerciseMatch[1]) : undefined
  return {
    label: labelMatch[1].toLocaleLowerCase('es'),
    ...(exerciseNumber !== undefined && Number.isInteger(exerciseNumber) ? { exerciseNumber } : {}),
  }
}

function readMarkdownBlockLabel(text: string): string | null {
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  const labelMatch = firstLine.match(/^(?:\(?\s*)([a-z]|\d+)\s*(?:\)(?:\s*[-.:])?|(?:\.(?:\s*-)?|:|-))(?:\s|$)/i)
  return labelMatch?.[1]?.toLocaleLowerCase('es') ?? null
}

function readExerciseNumberBefore(body: string, blockStart: number): number | null {
  let exerciseNumber: number | null = null
  for (const line of readLines(body)) {
    if (line.start > blockStart) break
    const trimmed = line.text.trim()
    const numberedHeadingMatch = trimmed.match(/^(?:#{1,6}\s*)?(\d+)\s*(?:\)(?:\s*[-.:])?|(?:\.(?:\s*-)?|:|-))(?:\s|$)/)
    const namedHeadingMatch = trimmed.match(/^(?:#{1,6}\s*)?(?:ejercicio|problema)\s+(\d+)\b/i)
    const number = numberedHeadingMatch?.[1] ?? namedHeadingMatch?.[1]
    if (number) {
      exerciseNumber = Number(number)
    }
  }
  return exerciseNumber
}

function resolveReferencedBlock(
  body: string,
  targetText: string,
  occurrence?: number,
): { ok: true; range: MarkdownBlockRange; text: string } | { ok: false; error: MarkdownReferenceEditError } {
  const normalizedTargets = referenceVariants(targetText)
  if (normalizedTargets.length === 0) return { ok: false, error: 'target-required' }
  if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1)) {
    return { ok: false, error: 'invalid-occurrence' }
  }

  const blocks = collectMarkdownBlockRanges(body)
    .map((range) => ({ range, text: body.slice(range.start, range.end).trim() }))
  const candidates = blocks
    .filter(({ text }) => normalizedTargets.some((target) => normalizeReferenceText(text).includes(target)))
  const exactCandidates = candidates.filter(({ text }) => normalizedTargets.some((target) => normalizeReferenceText(text) === target))
  let matchingCandidates = exactCandidates.length > 0 ? exactCandidates : candidates

  if (matchingCandidates.length === 0) {
    const labelReference = parseMarkdownLabelReference(targetText)
    if (labelReference) {
      matchingCandidates = blocks
        .filter(({ text }) => readMarkdownBlockLabel(text) === labelReference.label)
        .filter(({ range }) => labelReference.exerciseNumber === undefined
          || readExerciseNumberBefore(body, range.start) === labelReference.exerciseNumber)
    }
  }

  if (matchingCandidates.length === 0) return { ok: false, error: 'target-not-found' }
  if (occurrence !== undefined) {
    const candidate = matchingCandidates[occurrence - 1]
    return candidate
      ? { ok: true, ...candidate }
      : { ok: false, error: 'target-not-found' }
  }
  if (matchingCandidates.length > 1) return { ok: false, error: 'target-ambiguous' }
  const [candidate] = matchingCandidates
  return candidate
    ? { ok: true, ...candidate }
    : { ok: false, error: 'target-not-found' }
}

function normalizeEditContent(content: string): string {
  return content.trim()
}

export function replaceMarkdownBlockByReference(
  source: string,
  targetText: string,
  replacement: string,
  occurrence?: number,
): MarkdownReferenceEditResult {
  const normalizedReplacement = normalizeEditContent(replacement)
  if (!normalizedReplacement) return { ok: false, error: 'content-required' }

  const bodyStart = findBodyStart(source)
  const body = source.slice(bodyStart)
  const target = resolveReferencedBlock(body, targetText, occurrence)
  if (!target.ok) return target

  return {
    ok: true,
    source: `${source.slice(0, bodyStart)}${body.slice(0, target.range.start)}${normalizedReplacement}${body.slice(target.range.end)}`,
    affectedBlockCount: 1,
    matchedText: target.text,
  }
}

export function insertMarkdownBlockByReference(
  source: string,
  targetText: string | null,
  content: string,
  position: 'before' | 'after' = 'after',
  occurrence?: number,
): MarkdownReferenceEditResult {
  const normalizedContent = normalizeEditContent(content)
  if (!normalizedContent) return { ok: false, error: 'content-required' }

  const bodyStart = findBodyStart(source)
  const body = source.slice(bodyStart)
  const normalizedTarget = targetText?.trim() ?? ''
  if (!normalizedTarget) {
    const separator = body.length === 0 ? '' : body.endsWith('\n') ? '\n' : '\n\n'
    return {
      ok: true,
      source: `${source.slice(0, bodyStart)}${body}${separator}${normalizedContent}`,
      affectedBlockCount: 1,
    }
  }

  const target = resolveReferencedBlock(body, normalizedTarget, occurrence)
  if (!target.ok) return target
  const insertion = position === 'before'
    ? `${body.slice(0, target.range.start)}${normalizedContent}\n\n${body.slice(target.range.start)}`
    : `${body.slice(0, target.range.end)}\n\n${normalizedContent}${body.slice(target.range.end)}`

  return {
    ok: true,
    source: `${source.slice(0, bodyStart)}${insertion}`,
    affectedBlockCount: 1,
    matchedText: target.text,
  }
}

/** Moves one unambiguous Markdown block before or after another block.
 *
 * The operation is calculated from the original buffer and returns a new
 * buffer. It does not write or choose a target when either reference is
 * ambiguous; the caller can then ask the user for an occurrence.
 */
export function moveMarkdownBlockByReference(
  source: string,
  sourceText: string,
  destinationText: string,
  position: 'before' | 'after' = 'after',
  sourceOccurrence?: number,
  destinationOccurrence?: number,
): MarkdownReferenceEditResult {
  const bodyStart = findBodyStart(source)
  const body = source.slice(bodyStart)
  const normalizedSource = sourceText.trim()
  const normalizedDestination = destinationText.trim()
  if (!normalizedSource) return { ok: false, error: 'target-required' }
  if (!normalizedDestination) return { ok: false, error: 'destination-required' }

  const sourceResult = resolveReferencedBlock(body, normalizedSource, sourceOccurrence)
  if (!sourceResult.ok) return sourceResult
  const destinationResult = resolveReferencedBlock(body, normalizedDestination, destinationOccurrence)
  if (!destinationResult.ok) {
    return destinationResult.error === 'target-not-found'
      ? { ok: false, error: 'destination-not-found' }
      : destinationResult.error === 'target-ambiguous'
        ? { ok: false, error: 'destination-ambiguous' }
        : destinationResult
  }
  if (sourceResult.range.start === destinationResult.range.start) {
    return { ok: false, error: 'same-block' }
  }

  const sourceBlock = body.slice(sourceResult.range.start, sourceResult.range.end)
  const sourceBefore = body.slice(0, sourceResult.range.start).replace(/\n+$/g, '')
  const sourceAfter = body.slice(sourceResult.range.end).replace(/^\n+/g, '')
  const withoutSource = sourceBefore && sourceAfter
    ? `${sourceBefore}\n\n${sourceAfter}`
    : sourceBefore || sourceAfter
  const destinationAfterRemoval = resolveReferencedBlock(withoutSource, normalizedDestination, destinationOccurrence)
  if (!destinationAfterRemoval.ok) {
    return destinationAfterRemoval.error === 'target-not-found'
      ? { ok: false, error: 'destination-not-found' }
      : destinationAfterRemoval.error === 'target-ambiguous'
        ? { ok: false, error: 'destination-ambiguous' }
        : destinationAfterRemoval
  }
  const insertionOffset = position === 'before' ? destinationAfterRemoval.range.start : destinationAfterRemoval.range.end
  const left = withoutSource.slice(0, insertionOffset).replace(/\n+$/g, '')
  const right = withoutSource.slice(insertionOffset).replace(/^\n+/g, '')
  const moved = left && right
    ? `${left}\n\n${sourceBlock}\n\n${right}`
    : left
      ? `${left}\n\n${sourceBlock}`
      : right
        ? `${sourceBlock}\n\n${right}`
        : sourceBlock

  return {
    ok: true,
    source: `${source.slice(0, bodyStart)}${moved}`,
    affectedBlockCount: 1,
    matchedText: sourceResult.text,
  }
}
