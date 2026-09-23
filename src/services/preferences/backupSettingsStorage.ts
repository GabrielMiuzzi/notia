import { invoke } from '@tauri-apps/api/core'

/** Key used by older versions to keep the destination in WebView storage. */
const LEGACY_BACKUP_SETTINGS_STORAGE_KEY = 'notia:backup-settings:v1'

export interface BackupStatus {
  supported: boolean
  directoryPath: string | null
  initialized: boolean
  lastBackupAt: number | null
  lastError: string | null
}

function readLegacyDirectory(): string | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_BACKUP_SETTINGS_STORAGE_KEY) ?? 'null')
    const directory = parsed && typeof parsed === 'object'
      ? (parsed as { directoryPath?: unknown }).directoryPath
      : null
    return typeof directory === 'string' && directory.trim() ? directory.trim() : null
  } catch {
    return null
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return fallback
}

/**
 * Backup status kept by the backend. The first time, the destination chosen
 * in older versions is migrated from WebView storage and then removed.
 */
export async function loadBackupStatus(): Promise<BackupStatus> {
  const status = await invoke<BackupStatus>('backend_backup_status')
  if (status.initialized || !status.supported) {
    return status
  }
  const migrated = await invoke<BackupStatus>('backend_migrate_backup_directory', {
    directoryPath: readLegacyDirectory(),
  })
  try {
    localStorage.removeItem(LEGACY_BACKUP_SETTINGS_STORAGE_KEY)
  } catch {
    // Storage may be unavailable; the backend setting is authoritative.
  }
  return migrated
}

/** Opens the native folder picker in the backend. */
export async function pickBackupDirectory(): Promise<BackupStatus> {
  try {
    return await invoke<BackupStatus>('backend_pick_backup_directory')
  } catch (error) {
    throw new Error(errorMessage(error, 'No se pudo elegir la carpeta.'))
  }
}

export async function disableBackups(): Promise<BackupStatus> {
  try {
    return await invoke<BackupStatus>('backend_disable_backups')
  } catch (error) {
    throw new Error(errorMessage(error, 'No se pudieron desactivar los backups.'))
  }
}
