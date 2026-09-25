import { callBackend, subscribeBackend, type Unsubscribe } from '../transport'
import type {
  DiarizedTranscript,
  SherpaRuntimeStatus,
  SpeechAudioInputStatus,
  SpeechErrorCode,
  SpeechCapabilities,
  SpeechFinalizingStage,
  SpeechLevelsEvent,
  SpeechPartialEvent,
  SpeechModelStatus,
  SpeechSegmentsEvent,
  SpeechSessionEvent,
  SpeechSessionState,
  StartSpeechSessionInput,
  StartSpeechSessionResult,
} from './speechTypes'
import type { SpeechRecognitionPreferences } from '../preferences/speechRecognitionSettingsStorage'

const SPEECH_STATE_EVENT = 'speech://state'
const SPEECH_PARTIAL_EVENT = 'speech://partial'
const SPEECH_SEGMENTS_EVENT = 'speech://segments'
const SPEECH_LEVELS_EVENT = 'speech://levels'
const FINALIZING_STAGES: SpeechFinalizingStage[] = ['transcribing', 'detecting-speakers', 'assigning-turns']
const SPEECH_ERROR_CODES: SpeechErrorCode[] = [
  'permission-denied',
  'microphone-unavailable',
  'model-not-installed',
  'model-invalid',
  'unsupported-platform',
  'resource-limit',
  'cancelled',
  'internal',
]
let preparedModelKey: string | null = null
let pendingModelPreparation: Promise<void> | null = null
let pendingModelKey: string | null = null

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const isNonNegativeNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
)

const readString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new Error(`Respuesta de voz invalida: ${field}.`)
  return value
}

export function parseSpeechCapabilities(value: unknown): SpeechCapabilities {
  if (!isRecord(value) || typeof value.supported !== 'boolean') {
    throw new Error('Respuesta de capacidades de voz invalida.')
  }

  const platform = value.platform
  const permission = value.permission
  const unavailableReason = value.unavailableReason
  if (!['windows', 'android', 'other'].includes(String(platform))) {
    throw new Error('Plataforma de voz invalida.')
  }
  if (!['granted', 'denied', 'prompt', 'unavailable'].includes(String(permission))) {
    throw new Error('Estado de permiso de voz invalido.')
  }
  if (unavailableReason !== null
    && !['not-integrated', 'unsupported-platform', 'unsupported-architecture'].includes(String(unavailableReason))) {
    throw new Error('Motivo de indisponibilidad de voz invalido.')
  }
  if (typeof value.asrModelInstalled !== 'boolean' || typeof value.diarizationModelInstalled !== 'boolean') {
    throw new Error('Estado de modelos de voz invalido.')
  }

  return {
    supported: value.supported,
    platform: platform as SpeechCapabilities['platform'],
    architecture: readString(value.architecture, 'architecture'),
    permission: permission as SpeechCapabilities['permission'],
    asrModelInstalled: value.asrModelInstalled,
    diarizationModelInstalled: value.diarizationModelInstalled,
    unavailableReason: unavailableReason as SpeechCapabilities['unavailableReason'],
    systemAudioSupported: value.systemAudioSupported === true,
  }
}

export function parseDiarizedTranscript(value: unknown): DiarizedTranscript {
  if (!isRecord(value) || !Array.isArray(value.segments) || !isNonNegativeNumber(value.speakerCount)) {
    throw new Error('Transcripcion diarizada invalida.')
  }
  const text = readString(value.text, 'text')
  return {
    text,
    formattedText: typeof value.formattedText === 'string' ? value.formattedText : text,
    speakerCount: value.speakerCount,
    segments: value.segments.map((segment, index) => {
      if (!isRecord(segment)
        || !isNonNegativeNumber(segment.startMs)
        || !isNonNegativeNumber(segment.endMs)
        || segment.endMs < segment.startMs
        || (segment.speakerId !== null && typeof segment.speakerId !== 'string')
        || typeof segment.isFinal !== 'boolean') {
        throw new Error(`Segmento de voz invalido: ${index}.`)
      }
      return {
        id: readString(segment.id, `segments[${index}].id`),
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerId: segment.speakerId,
        text: readString(segment.text, `segments[${index}].text`),
        isFinal: segment.isFinal,
      }
    }),
  }
}

function parseSpeechSessionState(value: unknown): SpeechSessionState {
  if (!isRecord(value) || typeof value.status !== 'string') {
    throw new Error('Estado de sesion de voz invalido.')
  }
  switch (value.status) {
    case 'idle': return { status: 'idle' }
    case 'preparing':
      if (value.progress !== undefined && !isNonNegativeNumber(value.progress)) {
        throw new Error('Progreso de voz invalido.')
      }
      return { status: value.status, ...(value.progress === undefined ? {} : { progress: value.progress }) }
    case 'finalizing':
      if (value.progress !== undefined && !isNonNegativeNumber(value.progress)) {
        throw new Error('Progreso de voz invalido.')
      }
      if (value.stage !== undefined && !FINALIZING_STAGES.includes(value.stage as SpeechFinalizingStage)) {
        throw new Error('Etapa de voz invalida.')
      }
      return {
        status: 'finalizing',
        ...(value.progress === undefined ? {} : { progress: value.progress }),
        ...(value.stage === undefined ? {} : { stage: value.stage as SpeechFinalizingStage }),
      }
    case 'recording':
      if (!isNonNegativeNumber(value.elapsedMs) || typeof value.hasSpeech !== 'boolean') {
        throw new Error('Estado de grabacion invalido.')
      }
      return { status: 'recording', elapsedMs: value.elapsedMs, hasSpeech: value.hasSpeech }
    case 'paused':
      if (!isNonNegativeNumber(value.elapsedMs)) throw new Error('Estado de pausa invalido.')
      return { status: 'paused', elapsedMs: value.elapsedMs }
    case 'completed':
      return { status: 'completed', transcript: parseDiarizedTranscript(value.transcript) }
    case 'error':
      if (!isRecord(value.error)
        || typeof value.error.code !== 'string'
        || !SPEECH_ERROR_CODES.includes(value.error.code as SpeechErrorCode)) {
        throw new Error('Error de voz invalido.')
      }
      return {
        status: 'error',
        error: {
          code: value.error.code as SpeechErrorCode,
          message: readString(value.error.message, 'error.message'),
        },
      }
    default: throw new Error('Estado de sesion de voz desconocido.')
  }
}

export async function getSpeechCapabilities(): Promise<SpeechCapabilities> {
  return parseSpeechCapabilities(await callBackend<unknown>('get_speech_capabilities'))
}

export async function prepareSpeechModel(preferences: SpeechRecognitionPreferences): Promise<void> {
  const key = preferences.language.trim().toLowerCase()
  if (preparedModelKey === key) return
  if (pendingModelPreparation) {
    if (pendingModelKey === key) return pendingModelPreparation
    await pendingModelPreparation.catch(() => undefined)
    return prepareSpeechModel(preferences)
  }
  const preparation = callBackend<void>('prepare_speech_model', {
    payload: {
      language: preferences.language,
    },
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

export function parseSpeechModelStatus(value: unknown): SpeechModelStatus {
  if (!isRecord(value) || !Number.isInteger(value.schemaVersion) || !Array.isArray(value.profiles)) {
    throw new Error('Respuesta de modelos de voz invalida.')
  }
  return {
    schemaVersion: value.schemaVersion as number,
    profiles: value.profiles.map((profile, profileIndex) => {
      if (!isRecord(profile)
        || typeof profile.ready !== 'boolean'
        || typeof profile.asrReady !== 'boolean'
        || typeof profile.diarizationReady !== 'boolean'
        || !Array.isArray(profile.files)) {
        throw new Error(`Perfil de voz invalido: ${profileIndex}.`)
      }
      return {
        profileId: readString(profile.profileId, `profiles[${profileIndex}].profileId`),
        language: readString(profile.language, `profiles[${profileIndex}].language`),
        ready: profile.ready,
        asrReady: profile.asrReady,
        diarizationReady: profile.diarizationReady,
        files: profile.files.map((file, fileIndex) => {
          if (!isRecord(file)
            || !isNonNegativeNumber(file.expectedBytes)
            || typeof file.installed !== 'boolean'
            || typeof file.valid !== 'boolean') {
            throw new Error(`Archivo de modelo invalido: ${profileIndex}/${fileIndex}.`)
          }
          return {
            relativePath: readString(file.relativePath, `profiles[${profileIndex}].files[${fileIndex}].relativePath`),
            expectedBytes: file.expectedBytes,
            installed: file.installed,
            valid: file.valid,
          }
        }),
      }
    }),
  }
}

export async function getSpeechModelStatus(): Promise<SpeechModelStatus> {
  return parseSpeechModelStatus(await callBackend<unknown>('get_speech_model_status'))
}

export function parseSpeechAudioInputStatus(value: unknown): SpeechAudioInputStatus {
  if (!isRecord(value)
    || typeof value.supported !== 'boolean'
    || typeof value.available !== 'boolean'
    || (value.deviceLabel !== null && typeof value.deviceLabel !== 'string')
    || (value.sampleRate !== null && !isNonNegativeNumber(value.sampleRate))
    || (value.channels !== null && !isNonNegativeNumber(value.channels))
    || (value.errorMessage !== null && typeof value.errorMessage !== 'string')) {
    throw new Error('Respuesta del microfono invalida.')
  }
  return {
    supported: value.supported,
    available: value.available,
    deviceLabel: value.deviceLabel,
    sampleRate: value.sampleRate,
    channels: value.channels,
    errorMessage: value.errorMessage,
  }
}

export async function probeSpeechAudioInput(): Promise<SpeechAudioInputStatus> {
  return parseSpeechAudioInputStatus(await callBackend<unknown>('probe_speech_audio_input'))
}

export function parseSherpaRuntimeStatus(value: unknown): SherpaRuntimeStatus {
  if (!isRecord(value)
    || typeof value.supported !== 'boolean'
    || typeof value.installed !== 'boolean'
    || typeof value.compatible !== 'boolean'
    || typeof value.expectedVersion !== 'string'
    || (value.runtimeVersion !== null && typeof value.runtimeVersion !== 'string')
    || (value.onnxRuntimeVersion !== null && typeof value.onnxRuntimeVersion !== 'string')
    || (value.errorMessage !== null && typeof value.errorMessage !== 'string')) {
    throw new Error('Respuesta del runtime sherpa-onnx invalida.')
  }
  return {
    supported: value.supported,
    installed: value.installed,
    compatible: value.compatible,
    expectedVersion: value.expectedVersion,
    runtimeVersion: value.runtimeVersion,
    onnxRuntimeVersion: value.onnxRuntimeVersion,
    errorMessage: value.errorMessage,
  }
}

export async function probeSherpaRuntime(): Promise<SherpaRuntimeStatus> {
  return parseSherpaRuntimeStatus(await callBackend<unknown>('probe_sherpa_runtime'))
}

export async function startSpeechSession(input: StartSpeechSessionInput): Promise<StartSpeechSessionResult> {
  const value = await callBackend<unknown>('start_speech_session', { payload: input })
  if (!isRecord(value)) throw new Error('No se pudo iniciar la sesion de voz.')
  return { sessionId: readString(value.sessionId, 'sessionId') }
}

const invokeSessionCommand = async (command: string, sessionId: string): Promise<void> => {
  await callBackend(command, { payload: { sessionId } })
}

export const pauseSpeechSession = (sessionId: string) => invokeSessionCommand('pause_speech_session', sessionId)
export const resumeSpeechSession = (sessionId: string) => invokeSessionCommand('resume_speech_session', sessionId)
export const consumeSpeechTurn = (sessionId: string) => callBackend<string>('consume_speech_turn', { payload: { sessionId } })
export const stopSpeechSession = (sessionId: string) => invokeSessionCommand('stop_speech_session', sessionId)
export const cancelSpeechSession = (sessionId: string) => invokeSessionCommand('cancel_speech_session', sessionId)
/** State of a session that is still recording or separating its speakers. */
export async function getSpeechSessionState(sessionId: string): Promise<SpeechSessionState> {
  return parseSpeechSessionState(await callBackend<unknown>('speech_session_state', { payload: { sessionId } }))
}
/** Finishes a session that is separating speakers with its text alone. */
export const skipSpeechDiarization = (sessionId: string) => invokeSessionCommand('skip_speech_diarization', sessionId)

/** Opens the sources only to show their levels; resolves with the check's id. */
export async function startAudioMonitor(sources: { microphone: boolean; system: boolean }): Promise<string> {
  const value = await callBackend<unknown>('start_audio_monitor', { payload: sources })
  if (!isRecord(value)) throw new Error('No se pudo probar el audio.')
  return readString(value.monitorId, 'monitorId')
}

export const stopAudioMonitor = (monitorId: string) =>
  callBackend<void>('stop_audio_monitor', { payload: { monitorId } })

const listenValidated = <T>(
  eventName: string,
  validate: (value: unknown) => T,
  callback: (payload: T) => void,
): Promise<Unsubscribe> => subscribeBackend<unknown>(eventName, (payload) => callback(validate(payload)))

export const listenSpeechState = (callback: (payload: SpeechSessionEvent) => void) => (
  listenValidated(SPEECH_STATE_EVENT, (value) => {
    if (!isRecord(value) || !isRecord(value.state)) throw new Error('Evento de estado de voz invalido.')
    return { sessionId: readString(value.sessionId, 'sessionId'), state: parseSpeechSessionState(value.state) }
  }, callback)
)

export const listenSpeechPartial = (callback: (payload: SpeechPartialEvent) => void) => (
  listenValidated(SPEECH_PARTIAL_EVENT, (value) => {
    if (!isRecord(value)) throw new Error('Evento parcial de voz invalido.')
    return {
      sessionId: readString(value.sessionId, 'sessionId'),
      confirmedText: readString(value.confirmedText, 'confirmedText'),
      partialText: readString(value.partialText, 'partialText'),
    }
  }, callback)
)

export const listenSpeechSegments = (callback: (payload: SpeechSegmentsEvent) => void) => (
  listenValidated(SPEECH_SEGMENTS_EVENT, (value) => {
    if (!isRecord(value)) throw new Error('Evento de segmentos de voz invalido.')
    return {
      sessionId: readString(value.sessionId, 'sessionId'),
      transcript: parseDiarizedTranscript(value.transcript),
    }
  }, callback)
)

const readLevel = (value: unknown, field: string): number | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Nivel de audio invalido: ${field}.`)
  return Math.min(1, Math.max(0, value))
}

export const listenSpeechLevels = (callback: (payload: SpeechLevelsEvent) => void) => (
  listenValidated(SPEECH_LEVELS_EVENT, (value) => {
    if (!isRecord(value)) throw new Error('Evento de niveles de audio invalido.')
    return {
      sessionId: readString(value.sessionId, 'sessionId'),
      microphone: readLevel(value.microphone, 'microphone'),
      system: readLevel(value.system, 'system'),
    }
  }, callback)
)

/** A chunk of dictation recorded by a remote client (16-bit PCM). */
export interface RemoteSpeechChunk {
  sessionId: string
  sequence: number
  sampleRate: number
  last: boolean
  dataBase64: string
}

/** Sends a chunk; with the last one the server answers the recognized text. */
export async function sendRemoteSpeechChunk(chunk: RemoteSpeechChunk): Promise<string | null> {
  const result = await callBackend<{ done: boolean; text: string | null }>('speech_remote_audio', {
    payload: { chunk: { ...chunk, encoding: 'pcm-s16le', channels: 1 } },
  })
  return result.done ? result.text ?? '' : null
}

export const cancelRemoteSpeech = (sessionId: string) =>
  callBackend<void>('speech_remote_audio_cancel', { payload: { sessionId } })
