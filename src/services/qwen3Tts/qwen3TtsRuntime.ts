import { invoke } from '@tauri-apps/api/core'
import { normalizeQwen3TtsPreferences, type Qwen3TtsPreferences } from '../preferences/qwen3TtsSettingsStorage'

export interface Qwen3TtsStatus {
  supported: boolean
  ready: boolean
  loading: boolean
  error: string | null
  backend: string | null
}

// Exceptionally long replies still use bounded chunks to limit peak tensor
// and WAV memory; normal call replies stay in one inference for continuity.
const MAX_SPEECH_CHUNK_CHARACTERS = 280
const MAX_SINGLE_SPEECH_CHARACTERS = 5_900
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

function markdownToSpeechText(markdown: string): string {
  return markdown
    // Remove presentation markup before splitting/synthesizing. Qwen should
    // receive only the words that a person would naturally pronounce.
    .replace(/<https?:\/\/[^>]+>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/```(?:\w+)?\s*([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+] |\d+[.)]\s+)/gm, '')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\\([\\`*_{}()#+.!-])/g, '$1')
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
  const units = text.split(/(?<=[.!?;])\s+|\n+/).flatMap((part) => splitOversizedPart(part, maximum))
  const chunks: string[] = []
  for (const unit of units) {
    const current = chunks.at(-1)
    if (current && current.length + unit.length + 1 <= maximum) chunks[chunks.length - 1] = `${current} ${unit}`
    else if (unit) chunks.push(unit)
  }
  return chunks
}

// Avoid very short independent inferences: Qwen3-TTS can change prosody at
// every inference boundary (pitch, volume and speaking rate). Larger sentence
// groups keep the voice stable while remaining under the native 280-char cap.
const STREAM_SPEECH_MINIMUM_CHARACTERS = 48
const STREAM_SPEECH_TARGET_CHARACTERS = 260

export function takeQwen3TtsStreamChunk(markdown: string, flush = false): { chunk: string, remaining: string } {
  if (!markdown) return { chunk: '', remaining: '' }
  if (flush) return { chunk: markdown, remaining: '' }

  const searchLimit = Math.min(markdown.length, STREAM_SPEECH_TARGET_CHARACTERS)
  const candidate = markdown.slice(0, searchLimit)
  let boundary = -1
  const boundaryPattern = /[.!?;](?:[*_~`]+)?\s+|\n+/g
  for (const match of candidate.matchAll(boundaryPattern)) {
    const end = (match.index ?? 0) + match[0].length
    if (end >= STREAM_SPEECH_MINIMUM_CHARACTERS) boundary = end
  }
  if (boundary < 0 && markdown.length >= STREAM_SPEECH_TARGET_CHARACTERS) {
    const wordBoundary = candidate.lastIndexOf(' ')
    boundary = wordBoundary >= STREAM_SPEECH_MINIMUM_CHARACTERS ? wordBoundary + 1 : searchLimit
  }
  if (boundary < 0) return { chunk: '', remaining: markdown }
  return { chunk: markdown.slice(0, boundary), remaining: markdown.slice(boundary) }
}

export interface Qwen3TtsStreamingSpeech {
  append(delta: string): void
  finish(): Promise<void>
  cancel(): void
}

export function createQwen3TtsStreamingSpeech(preferences: Qwen3TtsPreferences): Qwen3TtsStreamingSpeech {
  if (!preferences.enabled) throw new Error('Qwen3-TTS 0.6B está desactivado en Configuración.')
  stopQwen3TtsSpeech()
  const generation = speechGeneration
  const settings = normalizeQwen3TtsPreferences(preferences)
  let buffer = ''
  let playback = Promise.resolve()
  let finished = false

  const enqueue = (markdown: string) => {
    for (const text of buildQwen3TtsSpeechChunks(markdown)) {
      const speech = requestSpeech(text, settings)
      void speech.catch(() => undefined)
      playback = playback.then(async () => {
        if (generation !== speechGeneration) throw new Error('La reproducción fue cancelada.')
        await playSpeechBlob(await speech, generation, settings.speed)
      })
    }
  }
  const drain = (flush: boolean) => {
    let extracted = takeQwen3TtsStreamChunk(buffer, flush)
    while (extracted.chunk) {
      buffer = extracted.remaining
      enqueue(extracted.chunk)
      extracted = takeQwen3TtsStreamChunk(buffer, flush)
    }
  }

  return {
    append(delta) {
      if (finished || generation !== speechGeneration || !delta) return
      buffer += delta
      drain(false)
    },
    async finish() {
      if (!finished) {
        finished = true
        drain(true)
      }
      await playback
    },
    cancel() {
      finished = true
      buffer = ''
      if (generation === speechGeneration) stopQwen3TtsSpeech()
    },
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
  const cleanedText = markdownToSpeechText(text)
  const chunks = cleanedText.length <= MAX_SINGLE_SPEECH_CHARACTERS
    ? (cleanedText ? [cleanedText] : [])
    : buildQwen3TtsSpeechChunks(cleanedText)
  if (chunks.length === 0) return
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
