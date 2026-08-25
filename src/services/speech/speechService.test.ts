import { describe, expect, it } from 'vitest'
import {
  parseDiarizedTranscript,
  parseSherpaRuntimeStatus,
  parseSpeechAudioInputStatus,
  parseSpeechCapabilities,
  parseSpeechModelStatus,
} from './speechService'

describe('parseSpeechCapabilities', () => {
  it('acepta el contrato nativo esperado', () => {
    expect(parseSpeechCapabilities({
      supported: false,
      platform: 'windows',
      architecture: 'x86_64',
      permission: 'unavailable',
      asrModelInstalled: false,
      diarizationModelInstalled: false,
      unavailableReason: 'not-integrated',
    })).toMatchObject({ supported: false, platform: 'windows' })
  })

  it('rechaza estados de permiso desconocidos', () => {
    expect(() => parseSpeechCapabilities({
      supported: true,
      platform: 'android',
      architecture: 'aarch64',
      permission: 'sometimes',
      asrModelInstalled: true,
      diarizationModelInstalled: true,
      unavailableReason: null,
    })).toThrow('Estado de permiso')
  })
})

describe('parseDiarizedTranscript', () => {
  it('preserva timestamps y speaker IDs validos', () => {
    expect(parseDiarizedTranscript({
      text: 'Hola',
      speakerCount: 1,
      segments: [{
        id: 'segment-1', startMs: 0, endMs: 400, speakerId: 'speaker-0', text: 'Hola', isFinal: true,
      }],
    }).segments[0]?.speakerId).toBe('speaker-0')
  })

  it('rechaza intervalos invertidos', () => {
    expect(() => parseDiarizedTranscript({
      text: 'Hola',
      speakerCount: 1,
      segments: [{ id: 'segment-1', startMs: 10, endMs: 2, speakerId: null, text: 'Hola', isFinal: true }],
    })).toThrow('Segmento de voz invalido')
  })
})

describe('parseSpeechModelStatus', () => {
  it('valida perfiles y archivos sin exponer rutas absolutas', () => {
    expect(parseSpeechModelStatus({
      schemaVersion: 1,
      profiles: [{
        profileId: 'es-test',
        language: 'es',
        ready: true,
        asrReady: true,
        diarizationReady: true,
        files: [{ relativePath: 'model.onnx', expectedBytes: 3, installed: true, valid: true }],
      }],
    }).profiles[0]?.files[0]?.valid).toBe(true)
  })
})

describe('parseSpeechAudioInputStatus', () => {
  it('acepta un dispositivo disponible', () => {
    expect(parseSpeechAudioInputStatus({
      supported: true,
      available: true,
      deviceLabel: 'Microphone',
      sampleRate: 48_000,
      channels: 2,
      errorMessage: null,
    }).sampleRate).toBe(48_000)
  })
})

describe('parseSherpaRuntimeStatus', () => {
  it('distingue un runtime instalado pero incompatible', () => {
    expect(parseSherpaRuntimeStatus({
      supported: true,
      installed: true,
      compatible: false,
      expectedVersion: '1.13.4',
      runtimeVersion: '1.12.0',
      onnxRuntimeVersion: '1.22.0',
      errorMessage: 'Version incompatible',
    }).compatible).toBe(false)
  })
})
