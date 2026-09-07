export type AiOperationHistoryStatus = 'applied' | 'undone'

export interface AiOperationHistoryEntry {
  operationId: string
  documentPath: string
  summary: string
  status: AiOperationHistoryStatus
  appliedAt: number
  undoneAt: number | null
}

const STORAGE_KEY = 'notia:ai-operation-history:v1'
const MAX_ENTRIES = 100

function isEntry(value: unknown): value is AiOperationHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AiOperationHistoryEntry>
  return typeof candidate.operationId === 'string'
    && typeof candidate.documentPath === 'string'
    && typeof candidate.summary === 'string'
    && (candidate.status === 'applied' || candidate.status === 'undone')
    && typeof candidate.appliedAt === 'number'
    && (candidate.undoneAt === null || typeof candidate.undoneAt === 'number')
}

function readEntries(): AiOperationHistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const entries = raw ? JSON.parse(raw) as unknown : []
    return Array.isArray(entries) ? entries.filter(isEntry).slice(0, MAX_ENTRIES) : []
  } catch {
    return []
  }
}

function writeEntries(entries: readonly AiOperationHistoryEntry[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // The in-memory operation journal remains authoritative when storage is unavailable.
  }
}

export function recordAiOperationHistory(entry: AiOperationHistoryEntry): void {
  const next = [entry, ...readEntries().filter((candidate) => candidate.operationId !== entry.operationId)]
  writeEntries(next)
}

export function markAiOperationHistoryUndone(operationId: string, undoneAt: number): void {
  const next = readEntries().map((entry) => entry.operationId === operationId
    ? { ...entry, status: 'undone' as const, undoneAt }
    : entry)
  writeEntries(next)
}

export function listAiOperationHistory(): AiOperationHistoryEntry[] {
  return readEntries()
}

export function clearAiOperationHistoryForTests(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
}
