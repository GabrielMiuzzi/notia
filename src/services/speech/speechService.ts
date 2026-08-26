import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  DiarizedTranscript,
  SherpaRuntimeStatus,
  SpeechAudioInputStatus,
  SpeechErrorCode,
  SpeechCapabilities,
  SpeechPartialEvent,
  SpeechModelStatus,
  SpeechSegmentsEvent,
  SpeechSessionEvent,
  SpeechSessionState,
  StartSpeechSessionInput,
  StartSpeechSessionResult,
} from './speechTypes'

const SPEECH_STATE_EVENT = 'speech://state'
const SPEECH_PARTIAL_EVENT = 'speech://partial'
const SPEECH_SEGMENTS_EVENT = 'speech://segments'
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
  }
}

export function parseDiarizedTranscript(value: unknown): DiarizedTranscript {
  if (!isRecord(value) || !Array.isArray(value.segments) || !isNonNegativeNumber(value.speakerCount)) {
    throw new Error('Transcripcion diarizada invalida.')
  }
  return {
    text: readString(value.text, 'text'),
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
    case 'finalizing':
      if (value.progress !== undefined && !isNonNegativeNumber(value.progress)) {
        throw new Error('Progreso de voz invalido.')
      }
      return { status: value.status, ...(value.progress === undefined ? {} : { progress: value.progress }) }
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
  return parseSpeechCapabilities(await invoke<unknown>('get_speech_capabilities'))
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
  return parseSpeechModelStatus(await invoke<unknown>('get_speech_model_status'))
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
  return parseSpeechAudioInputStatus(await invoke<unknown>('probe_speech_audio_input'))
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
  return parseSherpaRuntimeStatus(await invoke<unknown>('probe_sherpa_runtime'))
}

export async function startSpeechSession(input: StartSpeechSessionInput): Promise<StartSpeechSessionResult> {
  const value = await invoke<unknown>('start_speech_session', { payload: input })
  if (!isRecord(value)) throw new Error('No se pudo iniciar la sesion de voz.')
  return { sessionId: readString(value.sessionId, 'sessionId') }
}

const invokeSessionCommand = async (command: string, sessionId: string): Promise<void> => {
  await invoke(command, { payload: { sessionId } })
}

export const pauseSpeechSession = (sessionId: string) => invokeSessionCommand('pause_speech_session', sessionId)
export const resumeSpeechSession = (sessionId: string) => invokeSessionCommand('resume_speech_session', sessionId)
export const consumeSpeechTurn = (sessionId: string) => invoke<string>('consume_speech_turn', { payload: { sessionId } })
export const stopSpeechSession = (sessionId: string) => invokeSessionCommand('stop_speech_session', sessionId)
export const cancelSpeechSession = (sessionId: string) => invokeSessionCommand('cancel_speech_session', sessionId)

const listenValidated = <T>(
  eventName: string,
  validate: (value: unknown) => T,
  callback: (payload: T) => void,
): Promise<UnlistenFn> => listen<unknown>(eventName, (event) => callback(validate(event.payload)))

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
