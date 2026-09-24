import { callBackend } from '../transport'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import { resolveAiPreferencesForTransport } from '../preferences/aiSettingsStorage'

/**
 * AI provider client. The backend normalizes the preferences, talks to the
 * provider over the platform's transport, reads model capabilities, keeps
 * short caches and builds the prompts of the one-shot tasks; this module
 * only sends the preferences being used and the task input.
 */

export interface AiHealthCheckResult {
  ok: boolean
  message: string
  defaultModel?: string
}

export interface AiModelOption {
  name: string
  supportsThinking: boolean
  supportsThinkingLevels: boolean
  supportsVision: boolean
  supportsTools: boolean
}

export interface AiImageAttachment {
  name: string
  mimeType: string
  base64: string
  additionalBase64?: string[]
}

export interface CancelableAiReplyHandle {
  abort: () => void
  promise: Promise<string>
}

function describeAiError(error: unknown, fallback: string): Error {
  if (error instanceof Error && error.message.trim()) return new Error(error.message.trim())
  if (typeof error === 'string' && error.trim()) return new Error(error.trim())
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    const message = (error as { message: string }).message.trim()
    if (message) return new Error(message)
  }
  return new Error(fallback)
}

async function call<T>(command: string, payload: Record<string, unknown>, fallback: string): Promise<T> {
  try {
    return await callBackend<T>(command, { payload })
  } catch (error) {
    throw describeAiError(error, fallback)
  }
}

/** Preferences with the session credential, as the provider needs them. */
function settingsOf(preferences: AiPreferences) {
  return resolveAiPreferencesForTransport(preferences)
}

/** Checks the provider; `fresh` skips the backend's recent answer. */
export async function checkAiHealth(
  preferences: AiPreferences,
  options: { fresh?: boolean } = {},
): Promise<AiHealthCheckResult> {
  try {
    return await call<AiHealthCheckResult>('ai_check_health', {
      settings: settingsOf(preferences),
      fresh: Boolean(options.fresh),
    }, 'No se pudo conectar con la IA.')
  } catch (error) {
    return { ok: false, message: describeAiError(error, 'No se pudo conectar con la IA.').message }
  }
}

export function listAiModels(preferences: AiPreferences): Promise<AiModelOption[]> {
  return call('ai_list_models', { settings: settingsOf(preferences) }, 'No se pudo listar los modelos de IA.')
}

/** Model a chat uses with these preferences. */
export function resolveActiveModel(preferences: AiPreferences): Promise<string> {
  return call('ai_resolve_model', { settings: settingsOf(preferences) }, 'No hay modelos disponibles en Ollama.')
}

/** Handwritten formula (PNG) to LaTeX. */
export async function recognizeInkMathWithAi(
  preferences: AiPreferences,
  image: AiImageAttachment,
  abortSignal?: AbortSignal,
): Promise<string> {
  const latex = await call<string>('ai_recognize_inkmath', {
    settings: settingsOf(preferences),
    imageBase64: image.base64,
  }, 'No se pudo reconocer la formula.')
  if (abortSignal?.aborted) {
    throw new DOMException('Reconocimiento cancelado.', 'AbortError')
  }
  return latex
}
