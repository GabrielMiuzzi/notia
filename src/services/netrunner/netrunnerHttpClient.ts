import type { NetrunnerPreferences } from '../preferences/netrunnerSettingsStorage'
import { normalizeNetrunnerSettingsInput } from '../preferences/netrunnerSettingsStorage'

const NETRUNNER_REQUEST_TIMEOUT_MS = 15_000

function buildNetrunnerUrl(preferences: NetrunnerPreferences, path: string): string {
  const normalizedPreferences = normalizeNetrunnerSettingsInput(preferences)
  return `${normalizedPreferences.baseUrl}${path}`
}

function describeNetrunnerRequestError(url: string, error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.trim()
    const isAndroidCleartextBlock = url.startsWith('http://') && /cleartext|cleartxt|network security policy/i.test(message)

    if (isAndroidCleartextBlock) {
      return new Error(
        'Android bloquea conexiones HTTP en esta build. Usa HTTPS en Netrunner o habilita cleartext traffic en la app.',
      )
    }

    if (message) {
      return new Error(message)
    }
  }

  return new Error('No se pudo conectar con Netrunner.')
}

export async function fetchNetrunner(
  preferences: NetrunnerPreferences,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const url = buildNetrunnerUrl(preferences, path)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), NETRUNNER_REQUEST_TIMEOUT_MS)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    throw describeNetrunnerRequestError(url, error)
  } finally {
    window.clearTimeout(timeoutId)
  }
}

