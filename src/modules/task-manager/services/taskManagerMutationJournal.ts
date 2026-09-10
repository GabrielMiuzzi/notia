import { readFileContent, writeFileContent } from './vaultRuntime'

export const TASK_MANAGER_MUTATION_JOURNAL_VERSION = 1
const MAX_JOURNAL_ENTRIES = 64

export type TaskManagerMutationJournalStatus = 'pending' | 'committed' | 'rolled-back'

export interface TaskManagerMutationJournalEntry {
  operationId: string
  status: TaskManagerMutationJournalStatus
  scopes: string[]
  /** Logical, bounded paths observed while the operation was running. */
  changedPaths?: string[]
  startedAt: number
  updatedAt: number
}

interface TaskManagerMutationJournalDocument {
  version: typeof TASK_MANAGER_MUTATION_JOURNAL_VERSION
  entries: TaskManagerMutationJournalEntry[]
}

function emptyJournal(): TaskManagerMutationJournalDocument {
  return { version: TASK_MANAGER_MUTATION_JOURNAL_VERSION, entries: [] }
}

function isJournalStatus(value: unknown): value is TaskManagerMutationJournalStatus {
  return value === 'pending' || value === 'committed' || value === 'rolled-back'
}

function normalizeChangedPaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const changedPaths = Array.from(new Set(value.flatMap((path): string[] => {
    if (typeof path !== 'string') return []
    const normalizedPath = path.trim().replaceAll('\\', '/')
    if (
      normalizedPath.length === 0
      || normalizedPath.length > 128
      || normalizedPath.startsWith('/')
      || /^[A-Za-z]:\//.test(normalizedPath)
    ) return []
    return [normalizedPath]
  }))).slice(0, 32)

  return changedPaths
}

export function normalizeTaskManagerMutationJournal(value: unknown): {
  version: typeof TASK_MANAGER_MUTATION_JOURNAL_VERSION
  entries: TaskManagerMutationJournalEntry[]
} {
  if (!value || typeof value !== 'object') return emptyJournal()
  const candidate = value as { version?: unknown; entries?: unknown }
  if (candidate.version !== TASK_MANAGER_MUTATION_JOURNAL_VERSION || !Array.isArray(candidate.entries)) {
    return emptyJournal()
  }

  const entries = candidate.entries.flatMap((entry): TaskManagerMutationJournalEntry[] => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Partial<TaskManagerMutationJournalEntry>
    if (
      typeof item.operationId !== 'string'
      || item.operationId.length === 0
      || item.operationId.length > 128
      || !isJournalStatus(item.status)
      || !Array.isArray(item.scopes)
      || typeof item.startedAt !== 'number'
      || !Number.isSafeInteger(item.startedAt)
      || typeof item.updatedAt !== 'number'
      || !Number.isSafeInteger(item.updatedAt)
    ) return []
    const changedPaths = normalizeChangedPaths(item.changedPaths)
    return [{
      operationId: item.operationId,
      status: item.status,
      scopes: Array.from(new Set(item.scopes.filter((scope): scope is string => (
        typeof scope === 'string' && scope.length > 0 && scope.length <= 128
      )))).slice(0, 8),
      ...(changedPaths ? { changedPaths } : {}),
      startedAt: item.startedAt,
      updatedAt: item.updatedAt,
    }]
  })

  return {
    version: TASK_MANAGER_MUTATION_JOURNAL_VERSION,
    entries: entries.slice(-MAX_JOURNAL_ENTRIES),
  }
}

async function readJournal(journalPath: string): Promise<{
  document: TaskManagerMutationJournalDocument
  revision?: string
}> {
  const result = await readFileContent(journalPath)
  if (!result.ok || !result.content.trim()) return { document: emptyJournal() }
  try {
    return { document: normalizeTaskManagerMutationJournal(JSON.parse(result.content)), revision: result.revision }
  } catch {
    return { document: emptyJournal(), revision: result.revision }
  }
}

async function writeJournal(
  journalPath: string,
  document: TaskManagerMutationJournalDocument,
  expectedRevision?: string,
): Promise<void> {
  const result = await writeFileContent(journalPath, `${JSON.stringify(document)}\n`, expectedRevision)
  if (!result.ok) throw new Error('No se pudo persistir el journal de mutaciones del Task Manager.')
}

export async function beginTaskManagerMutationJournal(
  journalPath: string,
  operationId: string,
  scopes: string[],
): Promise<void> {
  const now = Date.now()
  const current = await readJournal(journalPath)
  const entries = current.document.entries.filter((entry) => entry.operationId !== operationId)
  entries.push({
    operationId,
    status: 'pending',
    scopes: Array.from(new Set(scopes.filter(Boolean))).slice(0, 8),
    startedAt: now,
    updatedAt: now,
  })
  await writeJournal(journalPath, {
    version: TASK_MANAGER_MUTATION_JOURNAL_VERSION,
    entries: entries.slice(-MAX_JOURNAL_ENTRIES),
  }, current.revision)
}

export async function completeTaskManagerMutationJournal(
  journalPath: string,
  operationId: string,
  status: Exclude<TaskManagerMutationJournalStatus, 'pending'>,
): Promise<void> {
  const current = await readJournal(journalPath)
  const entries = current.document.entries.map((entry) => (
    entry.operationId === operationId ? { ...entry, status, updatedAt: Date.now() } : entry
  ))
  if (!current.document.entries.some((entry) => entry.operationId === operationId)) {
    throw new Error('No se encontró la operación en el journal de mutaciones del Task Manager.')
  }
  await writeJournal(journalPath, {
    version: TASK_MANAGER_MUTATION_JOURNAL_VERSION,
    entries,
  }, current.revision)
}

export async function recordTaskManagerMutationJournalChangedPaths(
  journalPath: string,
  operationId: string,
  changedPaths: string[],
): Promise<void> {
  const current = await readJournal(journalPath)
  const entry = current.document.entries.find((candidate) => candidate.operationId === operationId)
  if (!entry) {
    throw new Error('No se encontró la operación en el journal de mutaciones del Task Manager.')
  }

  const normalizedChangedPaths = normalizeChangedPaths(changedPaths) ?? []
  const entries = current.document.entries.map((candidate) => (
    candidate.operationId === operationId
      ? { ...candidate, changedPaths: normalizedChangedPaths, updatedAt: Date.now() }
      : candidate
  ))
  await writeJournal(journalPath, {
    version: TASK_MANAGER_MUTATION_JOURNAL_VERSION,
    entries,
  }, current.revision)
}

export async function listPendingTaskManagerMutations(
  journalPath: string,
): Promise<TaskManagerMutationJournalEntry[]> {
  const current = await readJournal(journalPath)
  return current.document.entries.filter((entry) => entry.status === 'pending')
}
