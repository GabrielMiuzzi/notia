import { useEffect, useRef } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { createWindowsLibraryBackup } from '../../../services/files/filesystemEngine'
import { getRuntimeDevice } from '../../../utils/platform/getRuntimeDevice'

const BACKUP_INTERVAL_MS = 60 * 60 * 1000

export function useWindowsBackups(activeLibrary: NotiaLibrary | null, backupDirectory: string): void {
  const runningRef = useRef(false)
  useEffect(() => {
    if (getRuntimeDevice() !== 'Windows' || !activeLibrary?.path || !backupDirectory.trim()) return
    const run = async () => {
      if (runningRef.current) return
      runningRef.current = true
      try { await createWindowsLibraryBackup(activeLibrary.path, backupDirectory) }
      finally { runningRef.current = false }
    }
    void run()
    const interval = window.setInterval(() => { void run() }, BACKUP_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [activeLibrary?.path, backupDirectory])
}
