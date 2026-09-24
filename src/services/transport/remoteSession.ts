import type { RemoteCapabilities } from './remoteTransport'

/** Session of the owner with a headless Notia server (HttpOnly cookie). */

type FetchImpl = typeof fetch

const defaultFetch: FetchImpl = (input, init) => fetch(input, init)

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

function messageOf(body: unknown, fallback: string): string {
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error.trim()
    ? body.error
    : fallback
}

/** Whether this page is served by a Notia server (and not a static host). */
export async function isRemoteServer(fetchImpl: FetchImpl = defaultFetch): Promise<boolean> {
  try {
    const response = await fetchImpl('/api/health', { credentials: 'same-origin' })
    const body = await readJson(response)
    return response.ok && Boolean(body && typeof body === 'object' && 'ok' in body && body.ok === true)
  } catch {
    return false
  }
}

export async function fetchRemoteSession(fetchImpl: FetchImpl = defaultFetch): Promise<boolean> {
  const response = await fetchImpl('/api/session', { credentials: 'same-origin' })
  const body = await readJson(response)
  return Boolean(body && typeof body === 'object' && 'authenticated' in body && body.authenticated === true)
}

export async function loginRemote(password: string, fetchImpl: FetchImpl = defaultFetch): Promise<void> {
  let response: Response
  try {
    response = await fetchImpl('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })
  } catch {
    throw new Error('No se pudo contactar al servidor de Notia.')
  }
  if (response.ok) return
  throw new Error(messageOf(await readJson(response), 'No se pudo iniciar sesión.'))
}

export async function logoutRemote(fetchImpl: FetchImpl = defaultFetch): Promise<void> {
  await fetchImpl('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export async function fetchRemoteCapabilities(fetchImpl: FetchImpl = defaultFetch): Promise<RemoteCapabilities> {
  const response = await fetchImpl('/api/capabilities', { credentials: 'same-origin' })
  const body = await readJson(response)
  if (!response.ok || !body || typeof body !== 'object') {
    throw new Error(messageOf(body, 'No se pudieron leer las capacidades del servidor.'))
  }
  const value = body as Record<string, unknown>
  if (typeof value.protocolVersion !== 'number' || !isStringList(value.commands)) {
    throw new Error('El servidor respondió capacidades inválidas.')
  }
  return {
    protocolVersion: value.protocolVersion,
    platform: typeof value.platform === 'string' ? value.platform : 'unknown',
    commands: value.commands,
    localOnlyCommands: isStringList(value.localOnlyCommands) ? value.localOnlyCommands : [],
  }
}
