import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  normalizeAiSettingsInput,
  saveAiPreferences,
  type AiPreferences,
} from '../../../services/preferences/aiSettingsStorage'
import {
  saveExplorerRefreshIntervalMs,
} from '../../../services/preferences/explorerPanelStorage'
import {
  saveInkdocPreferences,
  type InkdocPreferences,
} from '../../../services/preferences/inkdocSettingsStorage'
import {
  readLibraryConfig,
  writeLibraryConfig,
  type NotiaLibraryConfig,
} from '../../../services/libraries/libraryConfig'
import type { NotiaLibrary } from '../../../types/notia'

interface UseLibraryConfigSyncParams {
  activeLibrary: NotiaLibrary | null
  aiPreferences: AiPreferences
  explorerRefreshIntervalMs: number
  inkdocPreferences: InkdocPreferences
  setAiPreferences: Dispatch<SetStateAction<AiPreferences>>
  setExplorerRefreshIntervalMs: Dispatch<SetStateAction<number>>
  setInkdocPreferences: Dispatch<SetStateAction<InkdocPreferences>>
}

export function useLibraryConfigSync({
  activeLibrary,
  aiPreferences,
  explorerRefreshIntervalMs,
  inkdocPreferences,
  setAiPreferences,
  setExplorerRefreshIntervalMs,
  setInkdocPreferences,
}: UseLibraryConfigSyncParams): void {
  const libraryConfigLoadedRef = useRef(false)
  const initialConfigRef = useRef<NotiaLibraryConfig | null>(null)
  const libraryConfigTimeoutRef = useRef<number | null>(null)
  const activeLibraryPathRef = useRef<string | null>(null)
  const fallbackPreferencesRef = useRef({
    aiPreferences,
    explorerRefreshIntervalMs,
    inkdocPreferences,
  })

  useEffect(() => {
    fallbackPreferencesRef.current = {
      aiPreferences,
      explorerRefreshIntervalMs,
      inkdocPreferences,
    }
  }, [aiPreferences, explorerRefreshIntervalMs, inkdocPreferences])

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

    let isCancelled = false
    libraryConfigLoadedRef.current = false
    initialConfigRef.current = null

    void (async () => {
      console.log('[NotiaMenu] Loading library config for:', activeLibrary.path)
      const config = await readLibraryConfig(activeLibrary.path, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })

      if (isCancelled) {
        return
      }

      if (config) {
        console.log('[NotiaMenu] Found existing config:', config)
        if (config.panelDesplegable?.refreshIntervalMs !== undefined) {
          setExplorerRefreshIntervalMs(config.panelDesplegable.refreshIntervalMs)
        }
        if (config.inkdocs) {
          setInkdocPreferences(config.inkdocs)
        }
        if (config.ia) {
          setAiPreferences(config.ia)
        }
        initialConfigRef.current = config
      } else {
        console.log('[NotiaMenu] No existing config found')
        initialConfigRef.current = {
          version: 1,
          panelDesplegable: {
            refreshIntervalMs: fallbackPreferencesRef.current.explorerRefreshIntervalMs,
          },
          inkdocs: fallbackPreferencesRef.current.inkdocPreferences,
          ia: fallbackPreferencesRef.current.aiPreferences,
        }
      }

      libraryConfigLoadedRef.current = true
      console.log('[NotiaMenu] Library config loading complete')
    })()

    return () => {
      isCancelled = true
      libraryConfigLoadedRef.current = false
      initialConfigRef.current = null
    }
  }, [activeLibrary?.path, activeLibrary?.androidTreeUri])

  useEffect(() => {
    if (!activeLibrary) {
      return
    }

    if (!libraryConfigLoadedRef.current) {
      console.log('[NotiaMenu] Skipping save - config not loaded yet')
      return
    }

    const config: NotiaLibraryConfig = {
      version: 1,
      panelDesplegable: {
        refreshIntervalMs: explorerRefreshIntervalMs,
      },
      inkdocs: inkdocPreferences,
      ia: aiPreferences,
    }

    if (initialConfigRef.current) {
      const initialJson = JSON.stringify(initialConfigRef.current)
      const currentJson = JSON.stringify(config)
      if (initialJson === currentJson) {
        console.log('[NotiaMenu] Skipping save - matches initial config')
        return
      }
    }

    activeLibraryPathRef.current = activeLibrary.path

    if (libraryConfigTimeoutRef.current) {
      window.clearTimeout(libraryConfigTimeoutRef.current)
    }

    libraryConfigTimeoutRef.current = window.setTimeout(() => {
      console.log('[NotiaMenu] Saving library config:', config)

      void writeLibraryConfig(activeLibraryPathRef.current!, config, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      }).then((result) => {
        console.log('[NotiaMenu] Save result:', result)
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
  }, [activeLibrary?.path, activeLibrary?.androidTreeUri, aiPreferences, explorerRefreshIntervalMs, inkdocPreferences])

  useEffect(() => {
    saveExplorerRefreshIntervalMs(explorerRefreshIntervalMs)
  }, [explorerRefreshIntervalMs])

  useEffect(() => {
    saveInkdocPreferences(inkdocPreferences)
  }, [inkdocPreferences])

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
