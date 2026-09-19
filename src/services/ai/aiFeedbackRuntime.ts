export type AiFeedbackErrorKind =
  | 'cancelled'
  | 'timeout'
  | 'search-blocked'
  | 'provider-unavailable'
  | 'no-data'
  | 'no-evidence'
  | 'unauthorized'
  | 'generic'

function errorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown }
    return {
      code: typeof candidate.code === 'string' ? candidate.code : '',
      message: candidate.message.trim(),
    }
  }
  if (typeof error === 'string') return { code: '', message: error.trim() }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>
    return {
      code: typeof candidate.code === 'string' ? candidate.code : '',
      message: typeof candidate.message === 'string'
        ? candidate.message.trim()
        : typeof candidate.error === 'string' ? candidate.error.trim() : '',
    }
  }
  return { code: '', message: '' }
}

export function isAiCancellation(error: unknown): boolean {
  const { code, message } = errorDetails(error)
  return code === 'cancelled'
    || (error instanceof DOMException && error.name === 'AbortError')
    || /\b(?:cancel(?:o|ó|ar|ed|ada|ado)|abort(?:o|ó|ar|ed|ada|ado)|interrump(?:ida|ido|o))\b/i.test(message)
}

function classifyAiFeedbackError(error: unknown): AiFeedbackErrorKind {
  const { code, message } = errorDetails(error)
  const normalized = `${code} ${message}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
  if (isAiCancellation(error)) return 'cancelled'
  if (code === 'timeout' || /\b(?:timeout|timed out|tiempo de espera|demasiado tiempo)\b/.test(normalized)) return 'timeout'
  if (code === 'web-search-limit' || /busqueda web.*bloquead|consulta.*no es publica|no es publica y segura/.test(normalized)) return 'search-blocked'
  if (code === 'provider-unavailable' || /proveedor.*(?:no esta|no está).*disponible|no se pudo conectar|ollama.*(?:no esta|no está)/.test(normalized)) return 'provider-unavailable'
  if (/\b(?:sin evidencia|evidencia insuficiente|no pude verificar|no devolvio fuentes|no devolvió fuentes|no se encontraron fuentes|no hay fuentes|no hay evidencia|no presentare resultados|no presentaré resultados)\b/.test(normalized)) return 'no-evidence'
  if (code === 'not-found' || code === 'resource-not-found' || /\b(?:no hay datos|no se encontraron datos|no encontre datos|no encontré datos|sin datos|not found)\b/.test(normalized)) return 'no-data'
  if (/\b(?:unauthorized|no tenes autorizacion|no tenés autorización|no esta autorizado|no está autorizado)\b/.test(normalized)) return 'unauthorized'
  return 'generic'
}

function redactFeedbackMessage(value: string): string {
  return value
    .replace(/bearer\s+[a-z0-9._~+/=-]{8,}/gi, 'Bearer [oculto]')
    .replace(/\b(?:sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_-]{12,}|xox[baprs]-[a-z0-9-]{12,}|akia[a-z0-9]{12,})\b/gi, '[secreto oculto]')
    .replace(/(api[_ -]?key|access[_ -]?token|password|passwd|secret|cookie)\s*[:=]\s*[^\s,;}]+/gi, '$1=[oculto]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[credenciales-ocultas]@')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|appdata|documents)[\\/])[^\s"']+/gi, '[ruta privada]')
    .slice(0, 500)
}

export function describeAiFeedbackError(
  error: unknown,
  fallback = 'No pude completar la consulta.',
): string {
  switch (classifyAiFeedbackError(error)) {
    case 'cancelled': return 'Operación cancelada. No se aplicaron cambios.'
    case 'timeout': return 'La operación tardó demasiado y se detuvo. No se aplicaron cambios.'
    case 'search-blocked': return 'La búsqueda pública fue bloqueada porque la consulta no es segura. No presento resultados sin verificar.'
    case 'provider-unavailable': return 'El proveedor de IA o búsqueda no está disponible. Verificá la conexión e intentá nuevamente.'
    case 'no-data': return 'No encontré datos cargados para esa consulta.'
    case 'no-evidence': return 'No encontré evidencia suficiente para responder con seguridad.'
    case 'unauthorized': return 'No tenés autorización para realizar esa consulta.'
    case 'generic': {
      const { message } = errorDetails(error)
      return message ? redactFeedbackMessage(message) : fallback
    }
  }
}

export function getAiFeedbackErrorKind(error: unknown): AiFeedbackErrorKind {
  return classifyAiFeedbackError(error)
}
