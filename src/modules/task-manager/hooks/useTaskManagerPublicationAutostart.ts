import { useEffect, useRef } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import type { TaskManagerPublicationPreferences } from '../../../services/preferences/taskManagerPublicationSettingsStorage'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import { getRuntimeDevice } from '../../../utils/platform/getRuntimeDevice'
import { loadTaskManagerSettings } from '../services/taskManagerStorage'
import { loadTaskManagerSnapshot } from '../services/taskManagerService'
import { buildTaskManagerPublicationPayload, publishTaskManagerBoards } from '../services/taskManagerPublicationRuntime'

interface UseTaskManagerPublicationAutostartInput {
  activeLibrary: NotiaLibrary | null
  preferences: TaskManagerPublicationPreferences
  theme: 'dark' | 'light'
  aiPreferences: AiPreferences
}

function hasPublishedBoard(availableBoardNames: string[], configuredBoardNames: string[]): boolean {
  const configured = new Set(configuredBoardNames.map((name) => name.trim().toLowerCase()))
  return availableBoardNames.some((name) => configured.has(name.trim().toLowerCase()))
}

export function useTaskManagerPublicationAutostart({
  activeLibrary,
  preferences,
  theme,
  aiPreferences,
}: UseTaskManagerPublicationAutostartInput): void {
  const hasEvaluatedStartup = useRef(false)

  useEffect(() => {
    if (hasEvaluatedStartup.current || !activeLibrary?.path) return
    hasEvaluatedStartup.current = true
    const passwordHash = preferences.passwordHash

    if (
      getRuntimeDevice() !== 'Windows'
      || !passwordHash
      || preferences.publishedBoardNames.length === 0
    ) {
      return
    }

    const settings = loadTaskManagerSettings()
    if (!hasPublishedBoard(settings.boards.map((board) => board.name), preferences.publishedBoardNames)) return

    void loadTaskManagerSnapshot(activeLibrary.path)
      .then((snapshot) => publishTaskManagerBoards(buildTaskManagerPublicationPayload(
        settings.boards,
        settings.groups,
        snapshot.tasks,
        preferences.publishedBoardNames,
        activeLibrary.path,
        theme,
        passwordHash,
        aiPreferences,
        preferences.approvedDevices,
        preferences.port,
      )))
      .catch((error: unknown) => {
        console.error('No se pudo restaurar la publicación de Task Manager.', error)
      })
  }, [activeLibrary?.path, aiPreferences, preferences.approvedDevices, preferences.passwordHash, preferences.port, preferences.publishedBoardNames, theme])
}
