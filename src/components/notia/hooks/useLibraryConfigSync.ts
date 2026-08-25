import { useEffect, useRef } from 'react'
import {
  normalizeAiSettingsInput,
  saveAiPreferences,
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
}: UseLibraryConfigSyncParams): void {
  const libraryConfigLoadedRef = useRef(false)
  const initialConfigRef = useRef<NotiaLibraryConfig | null>(null)
  const libraryConfigTimeoutRef = useRef<number | null>(null)
  const activeLibraryPathRef = useRef<string | null>(null)
  const fallbackPreferencesRef = useRef({
    aiPreferences,
    explorerRefreshIntervalMs,
    inkMathPreferences,
    telegramPreferences,
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
    }
  }, [aiPreferences, explorerRefreshIntervalMs, inkMathPreferences, telegramPreferences])

  useEffect(() => {
    if (!activeLibrary) {
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
      return
    }

    let isCancelled = false
    libraryConfigLoadedRef.current = false
    initialConfigRef.current = null

    void (async () => {
      console.warn('[NotiaMenu] Loading library config for:', activeLibrary.path)
      const config = await readLibraryConfig(activeLibrary.path, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })

      if (isCancelled) {
        return
      }

      if (config) {
      console.warn('[NotiaMenu] Found existing library config')
        if (config.panelDesplegable?.refreshIntervalMs !== undefined) {
          setExplorerRefreshIntervalMs(config.panelDesplegable.refreshIntervalMs)
        }
        if (config.inkMath) {
          setInkMathPreferences(config.inkMath)
        }
        if (config.ia) {
          setAiPreferences(config.ia)
        }
        setTelegramPreferences(normalizeTelegramPreferences(config.telegram))
        initialConfigRef.current = config
      } else {
        console.warn('[NotiaMenu] No existing config found')
        initialConfigRef.current = {
          version: 1,
          panelDesplegable: {
            refreshIntervalMs: fallbackPreferencesRef.current.explorerRefreshIntervalMs,
          },
          inkMath: fallbackPreferencesRef.current.inkMathPreferences,
          ia: fallbackPreferencesRef.current.aiPreferences,
          telegram: fallbackPreferencesRef.current.telegramPreferences,
        }
      }

      libraryConfigLoadedRef.current = true
      console.warn('[NotiaMenu] Library config loading complete')
    })()

    return () => {
      isCancelled = true
      libraryConfigLoadedRef.current = false
      initialConfigRef.current = null
    }
  }, [activeLibrary?.path, activeLibrary?.androidTreeUri, isLibraryReady])

  useEffect(() => {
    if (!activeLibrary) {
      return
    }

    if (!libraryConfigLoadedRef.current) {
      console.warn('[NotiaMenu] Skipping save - config not loaded yet')
      return
    }

    const config: NotiaLibraryConfig = {
      version: 1,
      panelDesplegable: {
        refreshIntervalMs: explorerRefreshIntervalMs,
      },
      inkMath: inkMathPreferences,
      ia: aiPreferences,
      telegram: telegramPreferences,
    }

    if (initialConfigRef.current) {
      const initialJson = JSON.stringify(initialConfigRef.current)
      const currentJson = JSON.stringify(config)
      if (initialJson === currentJson) {
        console.warn('[NotiaMenu] Skipping save - matches initial config')
        return
      }
    }

    activeLibraryPathRef.current = activeLibrary.path

    if (libraryConfigTimeoutRef.current) {
      window.clearTimeout(libraryConfigTimeoutRef.current)
    }

    libraryConfigTimeoutRef.current = window.setTimeout(() => {
      console.warn('[NotiaMenu] Saving library config')

      void writeLibraryConfig(activeLibraryPathRef.current!, config, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      }).then((result) => {
        console.warn('[NotiaMenu] Save result:', result)
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
  }, [activeLibrary?.path, activeLibrary?.androidTreeUri, aiPreferences, explorerRefreshIntervalMs, inkMathPreferences, telegramPreferences])

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

  useEffect(() => {
    saveAiPreferences(aiPreferences)
  }, [aiPreferences])
}
