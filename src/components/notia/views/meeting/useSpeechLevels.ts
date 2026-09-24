import { useEffect, useState } from 'react'
import { listenSpeechLevels } from '../../../../services/speech/speechService'

/** Levels of each source, newest last, as many as the meters draw. */
export interface SpeechLevelHistory {
  microphone: number[]
  system: number[]
}

const EMPTY: SpeechLevelHistory = { microphone: [], system: [] }

const pushLevel = (history: number[], level: number | null, size: number): number[] => (
  level === null ? history : [...history, level].slice(-size)
)

/**
 * Recent levels of the capture `captureId` (a recording or an audio check),
 * kept only to draw the meters. Empty while `captureId` is `null`.
 */
export function useSpeechLevels(captureId: string | null, size: number): SpeechLevelHistory {
  const [history, setHistory] = useState<SpeechLevelHistory>(EMPTY)

  useEffect(() => {
    setHistory(EMPTY)
    if (!captureId) return
    let disposed = false
    let unlisten: (() => void) | null = null
    void listenSpeechLevels((event) => {
      if (event.sessionId !== captureId) return
      setHistory((current) => ({
        microphone: pushLevel(current.microphone, event.microphone, size),
        system: pushLevel(current.system, event.system, size),
      }))
    }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    }).catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [captureId, size])

  return history
}
