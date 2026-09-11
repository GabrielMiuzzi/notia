import { useEffect, useRef, useState } from 'react'
import {
  getSessionAiApiKey,
  normalizeAiSettingsInput,
  type AiPreferences,
} from '../../../services/preferences/aiSettingsStorage'
import {
  saveExplorerRefreshIntervalMs,
} from '../../../services/preferences/explorerPanelStorage'
import {
  saveInkMathPreferences,
  type InkMathPreferences,
} from '../../../services/preferences/inkMathSettingsStorage'
import {
  readLibraryConfig,
  writeLibraryConfig,
  type NotiaLibraryConfig,
} from '../../../services/libraries/libraryConfig'
import { useAppSelector } from '../../../store/hooks'
import { selectLibraryStatus } from '../../../features/library/librarySelectors'
import type { NotiaLibrary } from '../../../types/notia'
import { normalizeTelegramPreferences, type TelegramPreferences } from '../../../services/preferences/telegramSettingsStorage'
import { normalizeTaskManagerPublicationPreferences, type TaskManagerPublicationPreferences } from '../../../services/preferences/taskManagerPublicationSettingsStorage'

interface UseLibraryConfigSyncParams {
  activeLibrary: NotiaLibrary | null
  aiPreferences: AiPreferences
  explorerRefreshIntervalMs: number
  inkMathPreferences: InkMathPreferences
  setAiPreferences: (value: AiPreferences) => void
  setExplorerRefreshIntervalMs: (value: number) => void
  setInkMathPreferences: (value: InkMathPreferences) => void
  telegramPreferences: TelegramPreferences
  setTelegramPreferences: (value: TelegramPreferences) => void
  taskManagerPublicationPreferences: TaskManagerPublicationPreferences
  setTaskManagerPublicationPreferences: (value: TaskManagerPublicationPreferences) => void
}

export function useLibraryConfigSync({
  activeLibrary,
  aiPreferences,
  explorerRefreshIntervalMs,
  inkMathPreferences,
  setAiPreferences,
  setExplorerRefreshIntervalMs,
  setInkMathPreferences,
  telegramPreferences,
  setTelegramPreferences,
  taskManagerPublicationPreferences,
  setTaskManagerPublicationPreferences,
}: UseLibraryConfigSyncParams): boolean {
  const [isLibraryConfigReady, setIsLibraryConfigReady] = useState(false)
  const libraryConfigLoadedRef = useRef(false)
  const initialConfigRef = useRef<NotiaLibraryConfig | null>(null)
  const libraryConfigTimeoutRef = useRef<number | null>(null)
  const activeLibraryPathRef = useRef<string | null>(null)
  const fallbackPreferencesRef = useRef({
    aiPreferences,
    explorerRefreshIntervalMs,
    inkMathPreferences,
    telegramPreferences,
    taskManagerPublicationPreferences,
  })

  // Wait until the tree is fully loaded before reading/writing config.
  // This avoids redundant SAF operations that race with the tree sync.
  const libraryStatus = useAppSelector(selectLibraryStatus)
  const isLibraryReady = libraryStatus === 'ready' || libraryStatus === 'idle'

  useEffect(() => {
    fallbackPreferencesRef.current = {
      aiPreferences,
      explorerRefreshIntervalMs,
      inkMathPreferences,
      telegramPreferences,
      taskManagerPublicationPreferences,
    }
  }, [aiPreferences, explorerRefreshIntervalMs, inkMathPreferences, taskManagerPublicationPreferences, telegramPreferences])

  useEffect(() => {
    if (!activeLibrary) {
      setIsLibraryConfigReady(false)
      if (libraryConfigTimeoutRef.current) {
        window.clearTimeout(libraryConfigTimeoutRef.current)
        libraryConfigTimeoutRef.current = null
      }
      libraryConfigLoadedRef.current = false
      initialConfigRef.current = null
      activeLibraryPathRef.current = null
      return
    }

    // Don't read config until the library tree has finished loading.
    // On Android, reading config triggers SAF operations that compete
    // with the tree load; deferring avoids redundant cache refreshes.
    if (!isLibraryReady) {
      setIsLibraryConfigReady(false)
      return
    }

    let isCancelled = false
    libraryConfigLoadedRef.current = false
    initialConfigRef.current = null

    void (async () => {
      const config = await readLibraryConfig(activeLibrary.path, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })

      if (isCancelled) {
        return
      }

      if (config) {
        if (config.panelDesplegable?.refreshIntervalMs !== undefined) {
          setExplorerRefreshIntervalMs(config.panelDesplegable.refreshIntervalMs)
        }
        if (config.inkMath) {
          setInkMathPreferences(config.inkMath)
        }
        if (config.ia) {
          setAiPreferences({
            ...config.ia,
            apiKey: config.ia.apiKey,
          })
        } else {
          // Each library owns its Ollama credential. Do not leak the key from
          // the previously active library when this one has none.
          setAiPreferences({
            ...fallbackPreferencesRef.current.aiPreferences,
            apiKey: '',
          })
        }
        setTelegramPreferences(normalizeTelegramPreferences(config.telegram))
        setTaskManagerPublicationPreferences(normalizeTaskManagerPublicationPreferences({
          ...fallbackPreferencesRef.current.taskManagerPublicationPreferences,
          accessUsers: config.taskManagerPublication?.accessUsers ?? [],
        }))
        initialConfigRef.current = config
      } else {
        // A library without a config file also starts without a credential.
        // This prevents a previous library's key from being written here.
        setAiPreferences({
          ...fallbackPreferencesRef.current.aiPreferences,
          apiKey: '',
        })
        initialConfigRef.current = {
          version: 1,
          panelDesplegable: {
            refreshIntervalMs: fallbackPreferencesRef.current.explorerRefreshIntervalMs,
          },
          inkMath: fallbackPreferencesRef.current.inkMathPreferences,
          ia: {
            ...fallbackPreferencesRef.current.aiPreferences,
            apiKey: '',
          },
          telegram: fallbackPreferencesRef.current.telegramPreferences,
          taskManagerPublication: { accessUsers: [] },
        }
      }

      libraryConfigLoadedRef.current = true
      setIsLibraryConfigReady(true)
    })()

    return () => {
      isCancelled = true
      setIsLibraryConfigReady(false)
      libraryConfigLoadedRef.current = false
      initialConfigRef.current = null
    }
  }, [activeLibrary, isLibraryReady, setAiPreferences, setExplorerRefreshIntervalMs, setInkMathPreferences, setTaskManagerPublicationPreferences, setTelegramPreferences])

  useEffect(() => {
    if (!activeLibrary) {
      return
    }

    if (!libraryConfigLoadedRef.current) {
      return
    }

    const config: NotiaLibraryConfig = {
      version: 1,
      panelDesplegable: {
        refreshIntervalMs: explorerRefreshIntervalMs,
      },
      inkMath: inkMathPreferences,
      ia: {
        ...aiPreferences,
        apiKey: getSessionAiApiKey(),
      },
      telegram: telegramPreferences,
      taskManagerPublication: {
        accessUsers: taskManagerPublicationPreferences.accessUsers,
      },
    }

    if (initialConfigRef.current) {
      const initialJson = JSON.stringify(initialConfigRef.current)
      const currentJson = JSON.stringify(config)
      if (initialJson === currentJson) {
        return
      }
    }

    activeLibraryPathRef.current = activeLibrary.path

    if (libraryConfigTimeoutRef.current) {
      window.clearTimeout(libraryConfigTimeoutRef.current)
    }

    libraryConfigTimeoutRef.current = window.setTimeout(() => {
      void writeLibraryConfig(activeLibraryPathRef.current!, config, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      }).then((result) => {
        if (result.ok) {
          initialConfigRef.current = config
        }
      })
    }, 500)

    return () => {
      if (libraryConfigTimeoutRef.current) {
        window.clearTimeout(libraryConfigTimeoutRef.current)
        libraryConfigTimeoutRef.current = null
      }
    }
  }, [activeLibrary, aiPreferences, explorerRefreshIntervalMs, inkMathPreferences, taskManagerPublicationPreferences, telegramPreferences])

  useEffect(() => {
    saveExplorerRefreshIntervalMs(explorerRefreshIntervalMs)
  }, [explorerRefreshIntervalMs])

  useEffect(() => {
    saveInkMathPreferences(inkMathPreferences)
  }, [inkMathPreferences])

  useEffect(() => {
    const normalizedPreferences = normalizeAiSettingsInput(aiPreferences)
    if (
      normalizedPreferences.ollamaUrl === aiPreferences.ollamaUrl
      && normalizedPreferences.apiKey === aiPreferences.apiKey
      && normalizedPreferences.selectedModel === aiPreferences.selectedModel
    ) {
      return
    }

    setAiPreferences(normalizedPreferences)
  }, [aiPreferences, setAiPreferences])

  return isLibraryConfigReady
}
