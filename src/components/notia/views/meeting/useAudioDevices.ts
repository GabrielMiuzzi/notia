import { useCallback, useEffect, useState } from 'react'
import { getAudioDevices, type AudioDevices } from '../../../../services/speech/speechService'
import { saveDevicePreferences } from '../../../../services/preferences/devicePreferencesStorage'
import type { MeetingSource } from './MeetingReadyPanel'

export interface AudioDevicesState {
  devices: AudioDevices | null
  /** Captures `name` for `source` from now on; `null` goes back to the system default. */
  choose: (source: MeetingSource, name: string | null) => void
}

/**
 * The devices of this computer for the recording setup, read again when the
 * window comes back (a headset plugged in meanwhile) and after a choice.
 */
export function useAudioDevices(): AudioDevicesState {
  const [devices, setDevices] = useState<AudioDevices | null>(null)

  const refresh = useCallback(() => {
    void getAudioDevices().then(setDevices).catch(() => setDevices(null))
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const choose = useCallback((source: MeetingSource, name: string | null) => {
    if (!devices) return
    const audioDevices = {
      microphone: source === 'microphone' ? name : devices.microphone,
      output: source === 'system' ? name : devices.output,
    }
    setDevices({ ...devices, microphone: audioDevices.microphone, output: audioDevices.output })
    void saveDevicePreferences({ audioDevices }).then(refresh).catch(refresh)
  }, [devices, refresh])

  return { devices, choose }
}
