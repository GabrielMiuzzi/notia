import { invoke } from '@tauri-apps/api/core'
import { normalizeQwen3TtsPreferences, type Qwen3TtsPreferences } from '../preferences/qwen3TtsSettingsStorage'

export interface Qwen3TtsStatus {
  supported: boolean
  ready: boolean
  loading: boolean
  error: string | null
  backend: string | null
}

const NATURAL_SPEECH_RATE_CORRECTION = 1.12
let activeAudio: HTMLAudioElement | null = null
let activeObjectUrl: string | null = null
let cancelActivePlayback: (() => void) | null = null
let speechGeneration = 0
let preparedModelKey: string | null = null
let pendingModelPreparation: Promise<void> | null = null
let pendingModelKey: string | null = null

function releaseActiveAudio(): void {
  const audio = activeAudio
  activeAudio = null
  cancelActivePlayback = null
  if (audio) {
    audio.onended = null
    audio.onerror = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl)
  activeObjectUrl = null
}

export function stopQwen3TtsSpeech(): void {
  speechGeneration += 1
  if (cancelActivePlayback) cancelActivePlayback()
  else releaseActiveAudio()
}

export async function playConversationReadyCue(): Promise<void> {
  const AudioContextConstructor = window.AudioContext
  if (!AudioContextConstructor) return
  const context = new AudioContextConstructor()
  try {
    if (context.state === 'suspended') await context.resume()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, context.currentTime)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12)
    oscillator.connect(gain)
    gain.connect(context.destination)
    await new Promise<void>((resolve) => {
      oscillator.onended = () => resolve()
      oscillator.start()
      oscillator.stop(context.currentTime + 0.13)
    })
  } catch {
    // The visual listening state remains available when a platform blocks the cue.
  } finally {
    await context.close().catch(() => undefined)
  }
}

export async function getQwen3TtsStatus(): Promise<Qwen3TtsStatus> {
  return invoke<Qwen3TtsStatus>('get_qwen3_tts_status')
}

export async function reloadQwen3Tts(): Promise<void> {
  await invoke('reload_qwen3_tts')
  preparedModelKey = null
}

export async function prepareQwen3Tts(preferences: Qwen3TtsPreferences): Promise<void> {
  const settings = normalizeQwen3TtsPreferences(preferences)
  const key = `${settings.model}:${settings.device}`
  if (preparedModelKey === key) return
  if (pendingModelPreparation) {
    if (pendingModelKey === key) return pendingModelPreparation
    await pendingModelPreparation.catch(() => undefined)
    return prepareQwen3Tts(preferences)
  }
  const preparation = invoke<void>('prepare_qwen3_tts', {
    input: { model: settings.model, device: settings.device },
  })
  pendingModelPreparation = preparation
  pendingModelKey = key
  try {
    await preparation
    preparedModelKey = key
  } finally {
    if (pendingModelPreparation === preparation) {
      pendingModelPreparation = null
      pendingModelKey = null
    }
  }
}

function normalizeInvokeError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error('Falló la síntesis local de Qwen3-TTS 0.6B.')
}

async function requestSpeech(text: string, preferences: Qwen3TtsPreferences): Promise<Blob> {
  const settings = normalizeQwen3TtsPreferences(preferences)
  try {
    const bytes = await invoke<number[]>('synthesize_qwen3_tts_speech', {
    input: { text: text.trim(), voice: settings.voice, language: settings.language, speed: settings.speed, model: settings.model, device: settings.device },
    })
    return new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' })
  } catch (error) {
    throw normalizeInvokeError(error)
  }
}

export function resolveQwen3TtsPlaybackRate(speed: number): number {
  return Math.min(1.8, Math.max(0.7, speed * NATURAL_SPEECH_RATE_CORRECTION))
}

function playSpeechBlob(blob: Blob, generation: number, speed: number): Promise<void> {
  if (generation !== speechGeneration) return Promise.reject(new Error('La reproducción fue cancelada.'))
  activeObjectUrl = URL.createObjectURL(blob)
  activeAudio = new Audio(activeObjectUrl)
  activeAudio.playbackRate = resolveQwen3TtsPlaybackRate(speed)
  activeAudio.preservesPitch = true
  return new Promise<void>((resolve, reject) => {
    const audio = activeAudio as HTMLAudioElement
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      releaseActiveAudio()
      if (error) reject(error)
      else resolve()
    }
    cancelActivePlayback = () => finish(new Error('La reproducción fue cancelada.'))
    audio.onended = () => finish()
    audio.onerror = () => finish(new Error('No se pudo reproducir el audio de Qwen3-TTS.'))
    void audio.play().catch((error) => finish(normalizeInvokeError(error)))
  })
}

export async function checkQwen3TtsConnection(preferences: Qwen3TtsPreferences): Promise<void> {
  const status = await getQwen3TtsStatus()
  if (!status.supported) throw new Error('Qwen3-TTS 0.6B nativo no está disponible en esta plataforma.')
  if (status.loading) throw new Error('Qwen3-TTS 0.6B todavía se está precargando.')
  if (!status.ready && status.error) throw new Error(status.error)
  await speakWithQwen3Tts('Prueba de voz.', preferences)
}

export async function speakWithQwen3Tts(text: string, preferences: Qwen3TtsPreferences): Promise<void> {
  if (!preferences.enabled) throw new Error('Qwen3-TTS 0.6B está desactivado en Configuración.')
  stopQwen3TtsSpeech()
  const generation = speechGeneration
  // The backend strips the markup and decides the chunks to synthesize.
  const chunks = await invoke<string[]>('qwen3_tts_speech_plan', { markdown: text })
  if (generation !== speechGeneration || chunks.length === 0) return
  let pendingSpeech = requestSpeech(chunks[0] as string, preferences)
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      if (generation !== speechGeneration) throw new Error('La reproducción fue cancelada.')
      const speech = await pendingSpeech
      const nextChunk = chunks[index + 1]
      if (nextChunk) pendingSpeech = requestSpeech(nextChunk, preferences)
      await playSpeechBlob(speech, generation, normalizeQwen3TtsPreferences(preferences).speed)
    }
  } catch (error) {
    void pendingSpeech.catch(() => undefined)
    throw error
  }
}
