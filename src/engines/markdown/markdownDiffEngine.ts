import type {
  MutationPreview,
  MutationPreviewAction,
  MutationPreviewDocument,
  MutationPreviewHunk,
} from '../../types/ai/agentContracts'
import type { AgentPlanRisk } from '../../types/ai/agentContracts'

export interface MarkdownMutationPreviewInput {
  operationId: string
  documentPath: string
  originalSource: string
  nextSource: string
  expectedRevision: number
  currentRevision: number
  summary: string
  assumptions?: readonly string[]
  risks?: readonly string[]
  risk?: AgentPlanRisk
  allowedActions?: readonly MutationPreviewAction[]
}

interface LineChange {
  oldStartLine: number
  oldEndLine: number
  oldText: string
  newText: string
}

function stableAnchor(operationId: string, change: LineChange, index: number): string {
  let hash = 2166136261
  for (const character of `${operationId}\u0000${index}\u0000${change.oldText}\u0000${change.newText}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `hunk-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function splitLines(source: string): string[] {
  if (source.length === 0) return []
  return source.split(/\r?\n/)
}

function findLineChanges(originalSource: string, nextSource: string): LineChange[] {
  if (originalSource === nextSource) return []

  const originalLines = splitLines(originalSource)
  const nextLines = splitLines(nextSource)
  if (originalLines.length * nextLines.length > 1_000_000) {
    return [{
      oldStartLine: 1,
      oldEndLine: Math.max(1, originalLines.length),
      oldText: originalSource,
      newText: nextSource,
    }]
  }

  const table = Array.from({ length: originalLines.length + 1 }, () => new Array<number>(nextLines.length + 1).fill(0))
  for (let originalIndex = originalLines.length - 1; originalIndex >= 0; originalIndex -= 1) {
    for (let nextIndex = nextLines.length - 1; nextIndex >= 0; nextIndex -= 1) {
      table[originalIndex]![nextIndex] = originalLines[originalIndex] === nextLines[nextIndex]
        ? (table[originalIndex + 1]?.[nextIndex + 1] ?? 0) + 1
        : Math.max(table[originalIndex + 1]?.[nextIndex] ?? 0, table[originalIndex]?.[nextIndex + 1] ?? 0)
    }
  }

  const changes: LineChange[] = []
  let originalIndex = 0
  let nextIndex = 0
  let oldBuffer: string[] = []
  let newBuffer: string[] = []
  let oldStartLine = 1
  const flush = () => {
    if (oldBuffer.length === 0 && newBuffer.length === 0) return
    changes.push({
      oldStartLine,
      oldEndLine: Math.max(oldStartLine, oldStartLine + oldBuffer.length - 1),
      oldText: oldBuffer.join('\n'),
      newText: newBuffer.join('\n'),
    })
    oldBuffer = []
    newBuffer = []
  }

  while (originalIndex < originalLines.length || nextIndex < nextLines.length) {
    if (originalIndex < originalLines.length && nextIndex < nextLines.length
      && originalLines[originalIndex] === nextLines[nextIndex]) {
      flush()
      originalIndex += 1
      nextIndex += 1
      oldStartLine = originalIndex + 1
      continue
    }
    if (nextIndex < nextLines.length
      && (originalIndex >= originalLines.length
        || (table[originalIndex]?.[nextIndex + 1] ?? 0) >= (table[originalIndex + 1]?.[nextIndex] ?? 0))) {
      if (oldBuffer.length === 0 && newBuffer.length === 0) oldStartLine = originalIndex + 1
      newBuffer.push(nextLines[nextIndex] ?? '')
      nextIndex += 1
    } else {
      if (oldBuffer.length === 0 && newBuffer.length === 0) oldStartLine = originalIndex + 1
      oldBuffer.push(originalLines[originalIndex] ?? '')
      originalIndex += 1
    }
  }
  flush()
  return changes
}

/**
 * Builds a bounded, reviewable preview for a document mutation. The first
 * Changes are grouped into bounded contiguous hunks. Applying the proposal
 * remains atomic because the revision is checked before writing the buffer.
 */
export function createMarkdownMutationPreview(input: MarkdownMutationPreviewInput): MutationPreview | null {
  const changes = findLineChanges(input.originalSource, input.nextSource)
  if (changes.length === 0) return null

  const hunks: MutationPreviewHunk[] = changes.map((change, index) => ({
    id: `${input.operationId}:hunk-${index + 1}`,
    anchor: stableAnchor(input.operationId, change, index),
    documentPath: input.documentPath,
    startLine: change.oldStartLine,
    endLine: change.oldEndLine,
    oldText: change.oldText,
    newText: change.newText,
    status: 'pending',
  }))
  const document: MutationPreviewDocument = {
    path: input.documentPath,
    expectedRevision: input.expectedRevision,
    currentRevision: input.currentRevision,
  }

  return {
    operationId: input.operationId,
    documents: [document],
    hunks,
    summary: input.summary,
    assumptions: input.assumptions ?? [],
    risks: input.risks ?? [],
    risk: input.risk ?? 'medium',
    allowedActions: input.allowedActions ?? ['apply-all', 'reject', 'edit', 'cancel'],
  }
}

export function summarizeMarkdownPreview(preview: MutationPreview): string {
  const [document] = preview.documents
  const changedLines = preview.hunks.reduce((total, hunk) => {
    const oldLines = hunk.oldText === '' ? 0 : hunk.oldText.split('\n').length
    const newLines = hunk.newText === '' ? 0 : hunk.newText.split('\n').length
    return total + Math.max(oldLines, newLines)
  }, 0)
  const location = document ? `líneas ${preview.hunks[0]?.startLine ?? 1}-${preview.hunks[0]?.endLine ?? 1}` : 'documento activo'
  return `${preview.summary} (${preview.hunks.length} hunk(s), ${changedLines} línea(s), ${location}).`
}

/**
 * Applies only the selected hunks against the exact source used to create a
 * preview. The caller must verify the preview anchors before invoking this
 * helper; line numbers are therefore intentionally treated as an opaque
 * snapshot coordinate, not as a merge strategy.
 */
export function applyMarkdownMutationHunks(
  originalSource: string,
  preview: MutationPreview,
  selectedHunkIds?: readonly string[],
): { ok: true; source: string; preview: MutationPreview } | { ok: false; error: 'hunk-not-found' | 'overlapping-hunks' } {
  const selectedIds = selectedHunkIds && selectedHunkIds.length > 0
    ? new Set(selectedHunkIds)
    : new Set(preview.hunks.map((hunk) => hunk.id))
  const selected = preview.hunks.filter((hunk) => selectedIds.has(hunk.id))
  if (selected.length !== selectedIds.size) return { ok: false, error: 'hunk-not-found' }

  const sorted = [...selected].sort((left, right) => left.startLine - right.startLine)
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1] as MutationPreviewHunk
    const current = sorted[index] as MutationPreviewHunk
    if (previous.oldText !== '' && current.oldText !== '' && current.startLine <= previous.endLine) {
      return { ok: false, error: 'overlapping-hunks' }
    }
  }

  const lines = splitLines(originalSource)
  for (const hunk of [...sorted].reverse()) {
    const startIndex = Math.max(0, hunk.startLine - 1)
    const oldLineCount = hunk.oldText === '' ? 0 : hunk.oldText.split('\n').length
    const replacementLines = hunk.newText === '' ? [] : hunk.newText.split('\n')
    lines.splice(startIndex, oldLineCount, ...replacementLines)
  }
  const source = lines.join('\n')
  const selectedPreview: MutationPreview = {
    ...preview,
    hunks: preview.hunks.map((hunk) => ({
      ...hunk,
      status: selectedIds.has(hunk.id) ? 'accepted' : 'rejected',
    })),
    allowedActions: ['apply-selected', 'reject', 'edit', 'cancel'],
  }
  return { ok: true, source, preview: selectedPreview }
}

export function renderMarkdownPreviewForConfirmation(preview: MutationPreview, maxChars = 8_000): string {
  const sections = preview.hunks.map((hunk, index) => [
    `Hunk ${index + 1} · líneas ${hunk.startLine}-${hunk.endLine}`,
    hunk.oldText ? `- ${hunk.oldText.replace(/\n/g, '\n- ')}` : '- (vacío)',
    hunk.newText ? `+ ${hunk.newText.replace(/\n/g, '\n+ ')}` : '+ (vacío)',
  ].join('\n'))
  const rendered = `${summarizeMarkdownPreview(preview)}\n\n${sections.join('\n\n')}`
  return rendered.length > maxChars ? `${rendered.slice(0, maxChars)}\n…` : rendered
}
