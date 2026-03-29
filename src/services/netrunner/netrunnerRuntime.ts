import { normalizeNetrunnerSettingsInput, type NetrunnerPreferences } from '../preferences/netrunnerSettingsStorage'

export interface NetrunnerHealthCheckResult {
  ok: boolean
  message: string
}

export async function checkNetrunnerHealth(
  preferences: NetrunnerPreferences,
): Promise<NetrunnerHealthCheckResult> {
  const normalizedPreferences = normalizeNetrunnerSettingsInput(preferences)

  try {
    const response = await fetch(`${normalizedPreferences.baseUrl}/health`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      return {
        ok: false,
        message: `Netrunner respondio con HTTP ${response.status}.`,
      }
    }

    const payload = await response.json() as { status?: unknown }
    return {
      ok: payload?.status === 'ok',
      message: payload?.status === 'ok'
        ? 'Conexion correcta con Netrunner.'
        : 'Netrunner respondio, pero el health no devolvio status ok.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.message.trim()
        ? error.message
        : 'No se pudo conectar con Netrunner.',
    }
  }
}
