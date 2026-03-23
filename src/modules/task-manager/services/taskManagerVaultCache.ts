import type { TaskManagerSnapshot } from './taskManagerService'
import type { Board, Group, TaskManagerVaultRef } from '../types/taskManagerTypes'

export interface TaskManagerVaultViewState {
  boards: Board[]
  groups: Group[]
  activeTab: string
}

export interface TaskManagerVaultCacheEntry {
  snapshot: TaskManagerSnapshot
  viewState: TaskManagerVaultViewState
}

const vaultCache = new Map<string, TaskManagerVaultCacheEntry>()

export function resolveTaskManagerVaultCacheKey(vault: TaskManagerVaultRef | null): string | null {
  if (!vault?.path.trim()) {
    return null
  }

  return `${vault.path}::${vault.androidTreeUri ?? ''}`
}

export function readTaskManagerVaultCache(vault: TaskManagerVaultRef | null): TaskManagerVaultCacheEntry | null {
  const cacheKey = resolveTaskManagerVaultCacheKey(vault)
  if (!cacheKey) {
    return null
  }

  return vaultCache.get(cacheKey) ?? null
}

export function writeTaskManagerVaultCache(vault: TaskManagerVaultRef | null, entry: TaskManagerVaultCacheEntry): void {
  const cacheKey = resolveTaskManagerVaultCacheKey(vault)
  if (!cacheKey) {
    return
  }

  vaultCache.set(cacheKey, entry)
}
