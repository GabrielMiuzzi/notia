import { useEffect } from 'react'
import { loadBackupStatus } from '../../../services/preferences/backupSettingsStorage'

/**
 * Backups run in the backend scheduler. On start this only moves the
 * destination chosen by older versions into the backend, once.
 */
export function useBackupSettingsMigration(): void {
  useEffect(() => {
    void loadBackupStatus().catch(() => undefined)
  }, [])
}
