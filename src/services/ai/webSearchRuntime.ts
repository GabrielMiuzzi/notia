import { invoke } from '@tauri-apps/api/core'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import { resolveAiPreferencesForTransport } from '../preferences/aiSettingsStorage'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type {
  WebSearchFreshness,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResult,
} from '../../types/ai/agentContracts'

const ANDROID_WEB_SEARCH_COMMANDS = [
  'run_android_ai_web_search',
  'mobile_ai_bridge::run_android_ai_web_search',
] as const
const MAX_QUERY_CHARS = 240
const MAX_RESULTS = 10
const MAX_RESULT_TEXT_CHARS = 2_000
const WEB_INSTRUCTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions?/i,
  /disregard\s+(?:the\s+)?(?:system|developer|user)\s+(?:message|instructions?)/i,
  /reveal\s+(?:the\s+)?(?:system\s+prompt|api\s+key|password|token)/i,
  /you\s+are\s+now\s+(?:a|an)\s+/i,
]
const WEB_SECRET_PATTERNS = [
  /bearer\s+[a-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_-]{12,}|xox[baprs]-[a-z0-9-]{12,}|akia[a-z0-9]{12,})\b/gi,
  /(api[_ -]?key|access[_ -]?token|password|passwd|secret|cookie)\s*[:=]\s*[^\s,;}]+/gi,
]

export type WebSearchSanitizationResult =
  | { ok: true; request: WebSearchRequest }
  | { ok: false; code: 'empty' | 'too-long' | 'private-content' | 'invalid-domain' }

export type WebSearchNeed = 'explicit' | 'freshness' | 'none'

const EXPLICIT_SEARCH_PATTERN = /(?:^|\s)(?:busc(?:a|ar|á|ame)|investig(?:a|ar|á)|consult[aá] fuentes?|fuentes? sobre|en internet|en la web|web search|ollama web|con citas?|encontr[aá] informaci[oó]n)(?=\s|$)/i
const FRESH_INFORMATION_PATTERN = /(?:^|\s)(?:actual(?:izado)?|hoy|ahora|[uú]ltim[oa]s?|reciente(?:s)?|vigente|cotizaci[oó]n|precio(?:s)?|clima|noticia(?:s)?|versi[oó]n actual|cambi[oó]|regulaci[oó]n|ley vigente)(?=\s|$)/i

/**
 * Supplies a deterministic hint to the agent without ever building a query
 * or sending the user's text to a provider. The sanitizer remains the final
 * authority before any network request.
 */
export function classifyWebSearchNeed(value: string): WebSearchNeed {
  const normalized = value.normalize('NFKC').trim()
  if (!normalized) return 'none'
  if (EXPLICIT_SEARCH_PATTERN.test(normalized)) return 'explicit'
  return FRESH_INFORMATION_PATTERN.test(normalized) ? 'freshness' : 'none'
}

export type WebSearchErrorCode = 'provider-unavailable' | 'rate-limit' | 'unauthorized' | 'timeout' | 'invalid-response'

export class WebSearchError extends Error {
  readonly code: WebSearchErrorCode
  readonly retryable: boolean

  constructor(code: WebSearchErrorCode, message: string, retryable: boolean) {
    super(message)
    this.name = 'WebSearchError'
    this.code = code
    this.retryable = retryable
  }
}

export function classifyWebSearchTransportError(error: unknown): WebSearchError {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const normalized = raw.toLocaleLowerCase('es')
  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('unauthorized') || normalized.includes('forbidden')) {
    return new WebSearchError('unauthorized', 'El proveedor de busqueda rechazo la credencial configurada.', false)
  }
  if (normalized.includes('429') || normalized.includes('rate limit') || normalized.includes('too many requests')) {
    return new WebSearchError('rate-limit', 'El proveedor de busqueda alcanzo su limite temporal. Intenta mas tarde.', true)
  }
  if (normalized.includes('timeout') || normalized.includes('timed out') || normalized.includes('tiempo de espera')) {
    return new WebSearchError('timeout', 'La busqueda web excedio el tiempo de espera.', true)
  }
  return new WebSearchError('provider-unavailable', 'El proveedor de busqueda no esta disponible.', true)
}

const SECRET_PATTERNS = [
  /bearer\s+[a-z0-9._~+/=-]{8,}/i,
  /(?:api[_ -]?key|access[_ -]?token|auth(?:orization)?|password|passwd|secret|cookie)\s*[:=]\s*[^\s,;]+/i,
  /"?(?:api[_ -]?key|access[_ -]?token|password|passwd|secret|cookie)"?\s*:\s*"?[^",}\s]+/i,
  /\b(?:sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_-]{12,}|xox[baprs]-[a-z0-9-]{12,}|akia[a-z0-9]{12,})\b/i,
  /\bey[a-z0-9_-]{20,}\.[a-z0-9._-]{10,}\.[a-z0-9._-]{10,}\b/i,
  /-----begin\s+(?:rsa|openssh|ec|private)\s+key-----/i,
  /https?:\/\/[^\s/@]+:[^\s/@]+@/i,
]

const PERSONAL_DATA_PATTERNS = [
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/i,
  /(?:^|\s)\+?\d[\d\s().-]{7,}\d(?:\s|$)/,
  /\b(?:dni|cuit|cuil|ssn|pasaporte|n(?:ú|u)mero\s+de\s+(?:documento|identidad))\s*[:#-]?\s*[a-z0-9.-]{4,}/i,
  /(?:^|\s)(?:mi\s+(?:nombre(?:\s+completo)?|apellido|correo|email|tel(?:é|e)fono|domicilio|direcci(?:ó|o)n|ubicaci(?:ó|o)n|empresa|trabajo)\s+es|me\s+llamo|vivo\s+en|soy\s+de)\b/i,
  /\b(?:calle|avenida|av\.?|ruta)\s+[\wÀ-ÿ .'-]+\s+\d{1,5}\b/i,
  /\b(?:coordenadas?|latitud|longitud)\s*[:=]?\s*[-+]?\d/i,
  /\b(?:paciente|historia\s+cl(?:í|i)nica|diagn(?:ó|o)stico|medicaci(?:ó|o)n|salario|sueldo|recibo\s+de\s+sueldo|tarjeta\s+de\s+cr(?:é|e)dito|cuenta\s+bancaria|cbu|alias\s+bancario|contrase(?:ñ|n)a|calendario\s+privado|expediente\s+legal|obra\s+social)\b/i,
  /(?:^|[\\/])(?:users|home|private|appdata|library|documents)(?:[\\/]|$)/i,
  /\b(?:127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/,
  /\b(?:nota|archivo|documento|biblioteca|chat|ticket|tarea)\s+(?:privad[oa]|intern[oa]|personal)\b/i,
]

function normalizeQuery(value: string): string | null {
  const normalizedValue = value
    .normalize('NFKC')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x1f || code === 0x7f ? ' ' : character
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalizedValue) return null
  try {
    let decoded = normalizedValue.replace(/\+/g, ' ')
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
    return decoded
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    return null
  }
}

function normalizeDomains(domains: readonly string[]): string[] | null {
  const normalized = [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))]
  if (normalized.length > 5) return null
  if (normalized.some((domain) => !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain))) return null
  return normalized
}

export function sanitizeWebSearchQuery(
  value: unknown,
  options: {
    maxResults?: number
    freshness?: WebSearchFreshness
    domains?: readonly string[]
  } = {},
): WebSearchSanitizationResult {
  if (typeof value !== 'string') return { ok: false, code: 'empty' }
  const query = normalizeQuery(value)
  if (!query) return { ok: false, code: 'empty' }
  if (query.length > MAX_QUERY_CHARS) return { ok: false, code: 'too-long' }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(query)) || PERSONAL_DATA_PATTERNS.some((pattern) => pattern.test(query))) {
    return { ok: false, code: 'private-content' }
  }
  const domains = normalizeDomains(options.domains ?? [])
  if (!domains) return { ok: false, code: 'invalid-domain' }
  const maxResults = Math.min(MAX_RESULTS, Math.max(1, Math.trunc(options.maxResults ?? 5)))
  return {
    ok: true,
    request: {
      query,
      queryIsSanitized: true,
      maxResults,
      freshness: options.freshness ?? 'any',
      domains,
    },
  }
}

function isOllamaCloudUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'ollama.com' || url.hostname === 'www.ollama.com')
  } catch {
    return false
  }
}

export function sanitizeWebResultText(value: string): string {
  const withoutMarkup = value.replace(/<[^>]*>/g, ' ')
  return sanitizeWebResultSecrets(WEB_INSTRUCTION_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, '[instrucción web omitida]'),
    withoutMarkup,
  )).replace(/\s+/g, ' ').trim().slice(0, MAX_RESULT_TEXT_CHARS)
}

function sanitizeWebResultSecrets(value: string): string {
  return WEB_SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, '[secreto web omitido]'),
    value,
  )
}

function sanitizeWebResultUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (!/^https?:$/i.test(url.protocol) || !url.hostname) return null
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:api[_-]?key|token|secret|password|passwd|authorization|cookie|session)/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function normalizeWebSearchResult(value: unknown, rank: number): WebSearchResult | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const title = typeof record.title === 'string' ? sanitizeWebResultSecrets(sanitizeWebResultText(record.title)).slice(0, 300) : ''
  const rawUrl = typeof record.url === 'string' ? record.url.trim() : ''
  const snippetValue = typeof record.snippet === 'string'
    ? record.snippet
    : typeof record.content === 'string' ? record.content : ''
  const url = sanitizeWebResultUrl(rawUrl)
  if (!title || !url) return null
  const sourceName = new URL(url).hostname
  return {
    rank,
    title,
    url,
    snippet: sanitizeWebResultSecrets(sanitizeWebResultText(snippetValue)),
    sourceName,
    publishedAt: typeof record.publishedAt === 'string' ? record.publishedAt : null,
    verification: 'unverified',
    verificationScore: 0,
  }
}

function resultTerms(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase('es').split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 5))
}

export function estimateWebResultConsistency(results: readonly WebSearchResult[]): WebSearchResponse['consistency'] {
  if (results.length < 2) return 'insufficient'
  const firstTerms = resultTerms(`${results[0]?.title ?? ''} ${results[0]?.snippet ?? ''}`)
  const overlap = results.slice(1).some((result) => {
    const terms = resultTerms(`${result.title} ${result.snippet}`)
    return [...firstTerms].filter((term) => terms.has(term)).length >= 2
  })
  return overlap ? 'consistent' : 'mixed'
}

function normalizeWebSearchResponse(value: unknown, searchedQuery: string): WebSearchResponse {
  const resultsValue = typeof value === 'object' && value !== null && Array.isArray((value as { results?: unknown }).results)
    ? (value as { results: unknown[] }).results
    : []
  const results = resultsValue
    .map((item, index) => normalizeWebSearchResult(item, index + 1))
    .filter((item): item is WebSearchResult => Boolean(item))
  return { results, searchedQuery, consistency: estimateWebResultConsistency(results) }
}

function requireWebSearchResponse(value: unknown): void {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { results?: unknown }).results)) {
    throw new WebSearchError('invalid-response', 'El proveedor devolviÃ³ una respuesta de bÃºsqueda invÃ¡lida.', false)
  }
}

export async function searchOllamaWeb(
  preferences: AiPreferences,
  request: WebSearchRequest,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  const transportPreferences = resolveAiPreferencesForTransport(preferences)
  const sanitized = sanitizeWebSearchQuery(request.query, request)
  if (!sanitized.ok) {
    throw new Error('La búsqueda web fue bloqueada porque la consulta no es pública y segura.')
  }
  if (!isOllamaCloudUrl(preferences.ollamaUrl)) {
    throw new Error('La búsqueda web de Ollama requiere usar Ollama Cloud (ollama.com).')
  }
  if (!transportPreferences.apiKey.trim()) {
    throw new Error('La búsqueda web de Ollama requiere una API key configurada.')
  }

  const payload = {
    query: sanitized.request.query,
    maxResults: sanitized.request.maxResults,
  }
  if (getRuntimeDevice() !== 'Android') {
    try {
      const response = await invoke<unknown>('run_desktop_ai_web_search', {
        payload: {
          ollamaUrl: transportPreferences.ollamaUrl,
          apiKey: transportPreferences.apiKey,
          query: payload.query,
          maxResults: payload.maxResults,
        },
      })
      requireWebSearchResponse(response)
      return normalizeWebSearchResponse(response, sanitized.request.query)
    } catch (error) {
      if (error instanceof WebSearchError) throw error
      const classified = classifyWebSearchTransportError(error)
      if (classified.code !== 'provider-unavailable') throw classified
      throw new WebSearchError('provider-unavailable', 'El proveedor de búsqueda no está disponible.', true)
    }
  }

  for (const command of ANDROID_WEB_SEARCH_COMMANDS) {
    try {
      const response = await invoke<unknown>(command, {
        payload: {
          ollamaUrl: transportPreferences.ollamaUrl,
          apiKey: transportPreferences.apiKey,
          query: payload.query,
          maxResults: payload.maxResults,
        },
      })
      requireWebSearchResponse(response)
      return normalizeWebSearchResponse(response, sanitized.request.query)
    } catch (error) {
      if (error instanceof WebSearchError) throw error
      const classified = classifyWebSearchTransportError(error)
      if (classified.code !== 'provider-unavailable') throw classified
    }
  }
  if (signal?.aborted) throw new WebSearchError('timeout', 'La búsqueda web fue cancelada.', true)
  // The native adapter may include transport details in its error. Never
  // propagate those details to the model, UI, or Telegram; they can contain
  // URLs, authorization material, or provider response bodies.
  throw new WebSearchError('provider-unavailable', 'El proveedor de búsqueda no está disponible.', true)
}
