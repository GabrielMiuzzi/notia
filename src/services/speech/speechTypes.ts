export type SpeechPermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable'

export type SpeechUnavailableReason =
  | 'not-integrated'
  | 'unsupported-platform'
  | 'unsupported-architecture'

export interface SpeechCapabilities {
  supported: boolean
  platform: 'windows' | 'android' | 'other'
  architecture: string
  permission: SpeechPermissionState
  asrModelInstalled: boolean
  diarizationModelInstalled: boolean
  unavailableReason: SpeechUnavailableReason | null
}

export interface SpeechTranscriptSegment {
  id: string
  startMs: number
  endMs: number
  speakerId: string | null
  text: string
  isFinal: boolean
}

export interface DiarizedTranscript {
  text: string
  segments: SpeechTranscriptSegment[]
  speakerCount: number
}

export type SpeechErrorCode =
  | 'permission-denied'
  | 'microphone-unavailable'
  | 'model-not-installed'
  | 'model-invalid'
  | 'unsupported-platform'
  | 'resource-limit'
  | 'cancelled'
  | 'internal'

export interface SpeechError {
  code: SpeechErrorCode
  message: string
}

export type SpeechSessionState =
  | { status: 'idle' }
  | { status: 'preparing'; progress?: number }
  | { status: 'recording'; elapsedMs: number; hasSpeech: boolean }
  | { status: 'paused'; elapsedMs: number }
  | { status: 'finalizing'; progress?: number }
  | { status: 'completed'; transcript: DiarizedTranscript }
  | { status: 'error'; error: SpeechError }

export interface SpeechSessionEvent {
  sessionId: string
  state: SpeechSessionState
}

export interface SpeechPartialEvent {
  sessionId: string
  confirmedText: string
  partialText: string
}

export interface SpeechSegmentsEvent {
  sessionId: string
  transcript: DiarizedTranscript
}

export interface StartSpeechSessionInput {
  language: string
  model: '0.6b' | '1.7b'
  device: 'cpu' | 'gpu'
  diarizationEnabled: boolean
  maxDurationSeconds: number
  captureSystemAudio?: boolean
}

export interface StartSpeechSessionResult {
  sessionId: string
}

export interface SpeechModelFileStatus {
  relativePath: string
  expectedBytes: number
  installed: boolean
  valid: boolean
}

export interface SpeechModelProfileStatus {
  profileId: string
  language: string
  ready: boolean
  asrReady: boolean
  diarizationReady: boolean
  files: SpeechModelFileStatus[]
}

export interface SpeechModelStatus {
  schemaVersion: number
  profiles: SpeechModelProfileStatus[]
}

export interface SpeechAudioInputStatus {
  supported: boolean
  available: boolean
  deviceLabel: string | null
  sampleRate: number | null
  channels: number | null
  errorMessage: string | null
}

export interface SherpaRuntimeStatus {
  supported: boolean
  installed: boolean
  compatible: boolean
  expectedVersion: string
  runtimeVersion: string | null
  onnxRuntimeVersion: string | null
  errorMessage: string | null
}
