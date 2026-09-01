export type DollarQuoteKind = 'oficial' | 'blue' | 'tarjeta'

export interface DollarQuote {
  kind: DollarQuoteKind
  name: string
  buy: number
  sell: number
  updatedAt: string
}

interface DolarApiQuote {
  casa: string
  nombre: string
  compra: number
  venta: number
  fechaActualizacion: string
}

const DOLAR_API_URL = 'https://dolarapi.com/v1/dolares'
const REQUEST_TIMEOUT_MS = 10_000
const QUOTE_KINDS: DollarQuoteKind[] = ['oficial', 'blue', 'tarjeta']

function isDolarApiQuote(value: unknown): value is DolarApiQuote {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.casa === 'string'
    && typeof candidate.nombre === 'string'
    && typeof candidate.compra === 'number'
    && Number.isFinite(candidate.compra)
    && typeof candidate.venta === 'number'
    && Number.isFinite(candidate.venta)
    && typeof candidate.fechaActualizacion === 'string'
}

export async function getDollarQuotes(): Promise<DollarQuote[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(DOLAR_API_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`DolarApi respondió con HTTP ${response.status}.`)
    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) throw new Error('DolarApi devolvió un formato inesperado.')

    const quotes = payload.filter(isDolarApiQuote)
    return QUOTE_KINDS.map((kind) => {
      const quote = quotes.find((item) => item.casa === kind)
      if (!quote) throw new Error(`DolarApi no devolvió la cotización ${kind}.`)
      return {
        kind,
        name: quote.nombre,
        buy: quote.compra,
        sell: quote.venta,
        updatedAt: quote.fechaActualizacion,
      }
    })
  } finally {
    clearTimeout(timeout)
  }
}
