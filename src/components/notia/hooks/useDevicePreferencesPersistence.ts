import { useEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { hydrateDevicePreferences } from '../../../features/preferences/preferencesSlice'
import { loadDevicePreferences, saveDevicePreferences } from '../../../services/preferences/devicePreferencesStorage'

/**
 * Loads the device preferences from the backend on start and stores every
 * later change of the publication or voice settings, in order.
 */
export function useDevicePreferencesPersistence(): void {
  const dispatch = useAppDispatch()
  const loaded = useAppSelector((state) => state.preferences.devicePreferencesLoaded)
  const taskManagerPublication = useAppSelector((state) => state.preferences.taskManagerPublicationPreferences)
  const qwen3Asr = useAppSelector((state) => state.preferences.qwen3AsrSettings)
  const qwen3Tts = useAppSelector((state) => state.preferences.qwen3TtsSettings)
  const skipNextSaveRef = useRef(true)
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    void loadDevicePreferences()
      .then((preferences) => {
        if (!cancelled) dispatch(hydrateDevicePreferences(preferences))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [dispatch])

  useEffect(() => {
    if (!loaded) return
    if (skipNextSaveRef.current) {
      // The first render after hydration only reflects what was loaded.
      skipNextSaveRef.current = false
      return
    }
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveDevicePreferences({ taskManagerPublication, qwen3Asr, qwen3Tts }))
      .catch(() => undefined)
  }, [loaded, qwen3Asr, qwen3Tts, taskManagerPublication])
}
