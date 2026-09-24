import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  getSessionAiApiKey,
  subscribeSessionAiApiKey,
  type AiPreferences,
} from '../../../services/preferences/aiSettingsStorage'
import { saveExplorerRefreshIntervalMs } from '../../../services/preferences/explorerPanelStorage'
import { saveInkMathPreferences, type InkMathPreferences } from '../../../services/preferences/inkMathSettingsStorage'
import { readLibraryConfig, writeLibraryConfig, type NotiaLibraryConfig } from '../../../services/libraries/libraryConfig'
import { useAppSelector } from '../../../store/hooks'
import { selectLibraryStatus } from '../../../features/library/librarySelectors'
import type { NotiaLibrary } from '../../../types/notia'
import type { TelegramPreferences } from '../../../services/preferences/telegramSettingsStorage'
import { DEFAULT_LIBRARY_CONTEXTS, type LibraryContext } from '../../../services/contexts/libraryContexts'

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
  contexts: LibraryContext[]
  setContexts: (value: LibraryContext[]) => void
}

/** JSON with sorted keys, so two equal configurations compare equal. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
      : item
  ))
}

/**
 * Keeps the preferences stored in the library configuration in sync with the
 * interface. The backend normalizes the configuration it reads and writes;
 * this hook shows what it returns and sends the sections the person edits.
 */
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
  contexts,
  setContexts,
}: UseLibraryConfigSyncParams): boolean {
  const [isLibraryConfigReady, setIsLibraryConfigReady] = useState(false)
  // The credential is kept out of Redux; this makes a key change rewrite the config.
  const sessionApiKey = useSyncExternalStore(subscribeSessionAiApiKey, getSessionAiApiKey)
  const libraryConfigLoadedRef = useRef(false)
  const storedConfigRef = useRef<NotiaLibraryConfig | null>(null)
  const libraryConfigTimeoutRef = useRef<number | null>(null)
  // Counts local edits; a write's answer is shown only if nothing changed since.
  const editGenerationRef = useRef(0)
  const settersRef = useRef({ setAiPreferences, setExplorerRefreshIntervalMs, setInkMathPreferences, setTelegramPreferences, setContexts })
  const fallbackPreferencesRef = useRef({ aiPreferences, explorerRefreshIntervalMs, inkMathPreferences, telegramPreferences })
  // Declared first so the effects below read the latest values.
  useEffect(() => {
    settersRef.current = { setAiPreferences, setExplorerRefreshIntervalMs, setInkMathPreferences, setTelegramPreferences, setContexts }
    fallbackPreferencesRef.current = { aiPreferences, explorerRefreshIntervalMs, inkMathPreferences, telegramPreferences }
  })

  // Wait until the tree is fully loaded before reading/writing config.
  // This avoids redundant SAF operations that race with the tree sync.
  const libraryStatus = useAppSelector(selectLibraryStatus)
  const isLibraryReady = libraryStatus === 'ready' || libraryStatus === 'idle'

  /** Shows the configuration as the backend stored it. */
  const applyStoredConfig = (config: NotiaLibraryConfig) => {
    const setters = settersRef.current
    const fallback = fallbackPreferencesRef.current
    storedConfigRef.current = config
    if (config.panelDesplegable) setters.setExplorerRefreshIntervalMs(config.panelDesplegable.refreshIntervalMs)
    if (config.inkMath) setters.setInkMathPreferences(config.inkMath)
    // Each library owns its credential; a library without AI settings does
    // not inherit the key of the previous one.
    const ai = config.ia ?? { ...fallback.aiPreferences, apiKey: '' }
    if (canonicalJson(ai) !== canonicalJson({ ...fallback.aiPreferences, apiKey: getSessionAiApiKey() })) setters.setAiPreferences(ai)
    const telegram = config.telegram ?? { enabled: false, botToken: '' }
    if (canonicalJson(telegram) !== canonicalJson(fallback.telegramPreferences)) setters.setTelegramPreferences(telegram)
    setters.setContexts(config.contexts ?? DEFAULT_LIBRARY_CONTEXTS.map((context) => ({ ...context })))
  }

  useEffect(() => {
    const clearPendingWrite = () => {
      if (libraryConfigTimeoutRef.current) {
        window.clearTimeout(libraryConfigTimeoutRef.current)
        libraryConfigTimeoutRef.current = null
      }
    }
    libraryConfigLoadedRef.current = false
    storedConfigRef.current = null
    // Do not expose the previous library's context catalog while this library loads.
    settersRef.current.setContexts(DEFAULT_LIBRARY_CONTEXTS.map((context) => ({ ...context })))
    // On Android, reading the config competes with the tree load for SAF.
    if (!activeLibrary || !isLibraryReady) {
      setIsLibraryConfigReady(false)
      clearPendingWrite()
      return
    }

    let isCancelled = false
    void readLibraryConfig(activeLibrary.id).then((config) => {
      if (isCancelled) return
      if (config) {
        applyStoredConfig(config)
      } else {
        // A library without a configuration starts from this device's
        // preferences, without a credential.
        settersRef.current.setAiPreferences({ ...fallbackPreferencesRef.current.aiPreferences, apiKey: '' })
      }
      libraryConfigLoadedRef.current = true
      setIsLibraryConfigReady(true)
    })

    return () => {
      isCancelled = true
      setIsLibraryConfigReady(false)
      libraryConfigLoadedRef.current = false
      storedConfigRef.current = null
    }
  }, [activeLibrary, isLibraryReady])

  useEffect(() => {
    const generation = ++editGenerationRef.current
    if (!activeLibrary || !libraryConfigLoadedRef.current) {
      return
    }

    const config: NotiaLibraryConfig = {
      version: 1,
      contextDefaultsVersion: 1,
      panelDesplegable: { refreshIntervalMs: explorerRefreshIntervalMs },
      inkMath: inkMathPreferences,
      ia: { ...aiPreferences, apiKey: sessionApiKey },
      telegram: telegramPreferences,
      contexts,
    }
    const stored = storedConfigRef.current
    if (stored && canonicalJson({ ...stored, llamacloud: undefined }) === canonicalJson(config)) {
      return
    }

    const libraryId = activeLibrary.id
    libraryConfigTimeoutRef.current = window.setTimeout(() => {
      void writeLibraryConfig(libraryId, config).then((result) => {
        if (!result.ok || !result.config) return
        if (editGenerationRef.current === generation) applyStoredConfig(result.config)
        else storedConfigRef.current = result.config
      })
    }, 500)

    return () => {
      if (libraryConfigTimeoutRef.current) {
        window.clearTimeout(libraryConfigTimeoutRef.current)
        libraryConfigTimeoutRef.current = null
      }
    }
  }, [activeLibrary, aiPreferences, contexts, explorerRefreshIntervalMs, inkMathPreferences, sessionApiKey, telegramPreferences])

  useEffect(() => {
    saveExplorerRefreshIntervalMs(explorerRefreshIntervalMs)
  }, [explorerRefreshIntervalMs])

  useEffect(() => {
    saveInkMathPreferences(inkMathPreferences)
  }, [inkMathPreferences])

  return isLibraryConfigReady
}
