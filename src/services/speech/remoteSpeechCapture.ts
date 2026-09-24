import pcmCaptureWorkletUrl from './pcmCaptureWorklet.js?url&no-inline'

/**
 * Microphone capture in the browser for dictation against a Notia server.
 * It only records and encodes 16-bit PCM; the server validates the chunks,
 * assembles them and recognizes the text (`backend-core::remote_audio`).
 */

/** Rates the server accepts for remote PCM. */
const ACCEPTED_SAMPLE_RATES = [8_000, 16_000, 22_050, 44_100, 48_000]
const PREFERRED_SAMPLE_RATE = 16_000
const CHUNK_SECONDS = 0.5


export interface RemoteSpeechCapture {
  sampleRate: number
  pause(): void
  resume(): void
  /** Stops the microphone and returns the audio not yet delivered. */
  stop(): Promise<Uint8Array>
}

/** Little-endian 16-bit PCM of samples in [-1, 1]. */
export function encodePcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  })
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step))
  }
  return btoa(binary)
}

function createContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: PREFERRED_SAMPLE_RATE })
  } catch {
    return new AudioContext()
  }
}

/**
 * Starts recording; `onChunk` receives about half a second of PCM at a time.
 * Rejects when there is no microphone, permission, or a usable sample rate.
 */
export async function startRemoteSpeechCapture(onChunk: (pcm: Uint8Array, sampleRate: number) => void): Promise<RemoteSpeechCapture> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no permite usar el micrófono (se necesita HTTPS).')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  const context = createContext()
  const release = () => {
    stream.getTracks().forEach((track) => track.stop())
    void context.close().catch(() => undefined)
  }
  if (!ACCEPTED_SAMPLE_RATES.includes(context.sampleRate)) {
    release()
    throw new Error('La frecuencia del micrófono no es compatible con el dictado remoto.')
  }
  try {
    await context.audioWorklet.addModule(new URL(pcmCaptureWorkletUrl, document.baseURI).href)
  } catch (error) {
    release()
    throw error
  }
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'notia-pcm-capture')
  const chunkSamples = Math.round(context.sampleRate * CHUNK_SECONDS)
  let pending: Float32Array[] = []
  let pendingLength = 0
  let paused = false

  const drain = (): Float32Array => {
    const joined = new Float32Array(pendingLength)
    let offset = 0
    pending.forEach((part) => {
      joined.set(part, offset)
      offset += part.length
    })
    pending = []
    pendingLength = 0
    return joined
  }

  node.port.onmessage = (message: MessageEvent<Float32Array>) => {
    if (paused) return
    pending.push(message.data)
    pendingLength += message.data.length
    if (pendingLength >= chunkSamples) onChunk(encodePcm16(drain()), context.sampleRate)
  }
  source.connect(node)

  return {
    sampleRate: context.sampleRate,
    pause: () => { paused = true },
    resume: () => { paused = false },
    stop: async () => {
      node.port.onmessage = null
      source.disconnect()
      node.disconnect()
      release()
      return encodePcm16(drain())
    },
  }
}
