import { invoke } from '@tauri-apps/api/core'
import { normalizeQwen3TtsPreferences, type Qwen3TtsPreferences } from '../preferences/qwen3TtsSettingsStorage'

export interface Qwen3TtsStatus {
  supported: boolean
  ready: boolean
  loading: boolean
  error: string | null
}

// The native model is optimized for inputs of at most 300 characters. Keeping
// each invoke below that boundary limits peak tensor and WAV memory.
const MAX_SPEECH_CHUNK_CHARACTERS = 280
let activeAudio: HTMLAudioElement | null = null
let activeObjectUrl: string | null = null
let cancelActivePlayback: (() => void) | null = null
let speechGeneration = 0

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

function markdownToSpeechText(markdown: string): string {
  return markdown
    .replace(/```(?:\w+)?\s*([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+] |\d+[.)]\s+)/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\|/g, '. ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function splitOversizedPart(part: string, maximum: number): string[] {
  const chunks: string[] = []
  let remaining = part.trim()
  while (remaining.length > maximum) {
    const candidate = remaining.slice(0, maximum + 1)
    const boundary = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf('? '), candidate.lastIndexOf('! '), candidate.lastIndexOf('; '), candidate.lastIndexOf(' '))
    const cut = boundary > maximum * 0.5 ? boundary + 1 : maximum
    chunks.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

export function buildQwen3TtsSpeechChunks(markdown: string, maximum = MAX_SPEECH_CHUNK_CHARACTERS): string[] {
  const text = markdownToSpeechText(markdown)
  if (!text) return []
  const units = text.split(/(?<=[.!?;:])\s+|\n+/).flatMap((part) => splitOversizedPart(part, maximum))
  const chunks: string[] = []
  for (const unit of units) {
    const current = chunks.at(-1)
    if (current && current.length + unit.length + 1 <= maximum) chunks[chunks.length - 1] = `${current} ${unit}`
    else if (unit) chunks.push(unit)
  }
  return chunks
}

function playSpeechBlob(blob: Blob, generation: number, speed: number): Promise<void> {
  if (generation !== speechGeneration) return Promise.reject(new Error('La reproducción fue cancelada.'))
  activeObjectUrl = URL.createObjectURL(blob)
  activeAudio = new Audio(activeObjectUrl)
  activeAudio.playbackRate = speed
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
  const chunks = buildQwen3TtsSpeechChunks(text)
  if (chunks.length === 0) return
  let pendingSpeech = requestSpeech(chunks[0] as string, preferences)
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      if (generation !== speechGeneration) throw new Error('La reproducción fue cancelada.')
      const speech = await pendingSpeech
      // Native inference for the next fragment runs while the current WAV plays,
      // removing the long synthetic pause without running two native generations at once.
      const nextChunk = chunks[index + 1]
      if (nextChunk) pendingSpeech = requestSpeech(nextChunk, preferences)
      await playSpeechBlob(speech, generation, normalizeQwen3TtsPreferences(preferences).speed)
    }
  } catch (error) {
    void pendingSpeech.catch(() => undefined)
    throw error
  }
}
