import { useEffect, useRef } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { createWindowsLibraryBackup } from '../../../services/files/filesystemEngine'
import { getRuntimeDevice } from '../../../utils/platform/getRuntimeDevice'

const BACKUP_INTERVAL_MS = 60 * 60 * 1000

function normalizeBackupSchedulePath(pathValue: string): string {
  return pathValue.trim().replace(/[\\/]+$/, '').toLowerCase()
}

function createBackupScheduleKey(libraryPath: string, backupDirectory: string): string {
  return `${normalizeBackupSchedulePath(libraryPath)}\u0000${normalizeBackupSchedulePath(backupDirectory)}`
}

export function useWindowsBackups(activeLibrary: NotiaLibrary | null, backupDirectory: string): void {
  const runningRef = useRef(false)
  const lastAttemptAtRef = useRef(new Map<string, number>())
  useEffect(() => {
    if (getRuntimeDevice() !== 'Windows' || !activeLibrary?.path || !backupDirectory.trim()) return
    const scheduleKey = createBackupScheduleKey(activeLibrary.path, backupDirectory)
    const run = async () => {
      if (runningRef.current) return
      const now = Date.now()
      const lastAttemptAt = lastAttemptAtRef.current.get(scheduleKey)
      if (lastAttemptAt !== undefined && now - lastAttemptAt < BACKUP_INTERVAL_MS) return
      lastAttemptAtRef.current.set(scheduleKey, now)
      runningRef.current = true
      try {
        await createWindowsLibraryBackup(activeLibrary.path, backupDirectory)
      } finally {
        runningRef.current = false
      }
    }
    void run()
    const interval = window.setInterval(() => { void run() }, BACKUP_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [activeLibrary?.path, backupDirectory])
}
