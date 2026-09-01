const BACKUP_SETTINGS_STORAGE_KEY = 'notia:backup-settings:v1'

export interface BackupPreferences {
  directoryPath: string
}

export const DEFAULT_BACKUP_PREFERENCES: BackupPreferences = { directoryPath: '' }

export function loadBackupPreferences(): BackupPreferences {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BACKUP_SETTINGS_STORAGE_KEY) ?? 'null')
    if (parsed && typeof parsed === 'object' && typeof (parsed as { directoryPath?: unknown }).directoryPath === 'string') {
      return { directoryPath: (parsed as { directoryPath: string }).directoryPath.trim() }
    }
  } catch { /* Use defaults when storage is malformed. */ }
  return DEFAULT_BACKUP_PREFERENCES
}

export function saveBackupPreferences(preferences: BackupPreferences): void {
  localStorage.setItem(BACKUP_SETTINGS_STORAGE_KEY, JSON.stringify(preferences))
}
