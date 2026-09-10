import type { Board, Group, TaskManagerSettings } from '../types/taskManagerTypes'
import { normalizeTaskManagerSettings } from '../utils/settings'
import {
  createFileContent,
  readFileContent,
  writeFileContent,
} from './vaultRuntime'
import { resolveTaskManagerSharedMetadataPath } from './taskManagerService'

const SHARED_METADATA_VERSION = 1
const MAX_SHARED_BOARDS = 64
const MAX_SHARED_GROUPS = 512

export interface TaskManagerSharedMetadata {
  version: typeof SHARED_METADATA_VERSION
  boards: Board[]
  groups: Group[]
}

const pendingWrites = new Map<string, Promise<void>>()

/**
 * Keeps the user's legacy board configuration while adding boards discovered
 * in the workspace during the first metadata migration.
 */
export function mergeTaskManagerBoards(
  configuredBoards: Board[],
  discoveredBoards: Board[],
): Board[] {
  const discoveredByName = new Map(discoveredBoards.map((board) => [board.name, board]))
  const mergedBoards = configuredBoards.map((configuredBoard) => {
    discoveredByName.delete(configuredBoard.name)
    return configuredBoard
  })

  return [...mergedBoards, ...discoveredByName.values()]
}

export async function readTaskManagerSharedMetadata(
  vaultPath: string,
): Promise<TaskManagerSharedMetadata | null> {
  const metadataPath = await resolveTaskManagerSharedMetadataPath(vaultPath)
  const result = await readFileContent(metadataPath)
  if (!result.ok || !result.content.trim()) {
    return null
  }

  try {
    return parseTaskManagerSharedMetadata(JSON.parse(result.content))
  } catch {
    return null
  }
}

export function parseTaskManagerSharedMetadata(value: unknown): TaskManagerSharedMetadata | null {
  if (!isRecord(value) || value.version !== SHARED_METADATA_VERSION) {
    return null
  }

  return normalizeSharedMetadata(value)
}

export function writeTaskManagerSharedMetadata(
  vaultPath: string,
  settings: Pick<TaskManagerSettings, 'boards' | 'groups'>,
): Promise<void> {
  const queueKey = vaultPath.trim().toLowerCase()
  const previousWrite = pendingWrites.get(queueKey) ?? Promise.resolve()
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(() => writeSharedMetadataFile(vaultPath, settings))
  pendingWrites.set(queueKey, nextWrite)
  return nextWrite.finally(() => {
    if (pendingWrites.get(queueKey) === nextWrite) {
      pendingWrites.delete(queueKey)
    }
  })
}

function normalizeSharedMetadata(value: Record<string, unknown>): TaskManagerSharedMetadata {
  const normalized = normalizeTaskManagerSettings({
    boards: value.boards,
    groups: value.groups,
  })
  return {
    version: SHARED_METADATA_VERSION,
    boards: normalized.boards.slice(0, MAX_SHARED_BOARDS),
    groups: normalized.groups.slice(0, MAX_SHARED_GROUPS),
  }
}

async function writeSharedMetadataFile(
  vaultPath: string,
  settings: Pick<TaskManagerSettings, 'boards' | 'groups'>,
): Promise<void> {
  const metadataPath = await resolveTaskManagerSharedMetadataPath(vaultPath)
  const metadata = normalizeSharedMetadata({
    version: SHARED_METADATA_VERSION,
    boards: settings.boards,
    groups: settings.groups,
  })
  const content = `${JSON.stringify(metadata, null, 2)}\n`
  const current = await readFileContent(metadataPath)
  if (current.ok && current.content === content) {
    return
  }

  const result = current.ok
    ? await writeFileContent(metadataPath, content, current.revision)
    : await createFileContent(metadataPath, content)
  if (!result.ok) {
    throw new Error(result.error || 'No se pudo guardar la metadata compartida del Task Manager.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}
