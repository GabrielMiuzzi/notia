export interface HistoricalDollarQuote {
  date: string
  buy: number
  sell: number
}

interface ArgentinaDatosDollarQuote {
  casa: string
  fecha: string
  compra: number
  venta: number
}

const ARGENTINA_DATOS_DOLLARS_URL = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial'
const REQUEST_TIMEOUT_MS = 10_000

function isArgentinaDatosDollarQuote(value: unknown): value is ArgentinaDatosDollarQuote {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.casa === 'string'
    && typeof candidate.fecha === 'string'
    && typeof candidate.compra === 'number'
    && Number.isFinite(candidate.compra)
    && typeof candidate.venta === 'number'
    && Number.isFinite(candidate.venta)
}

export async function getOfficialHistoricalDollarQuotes(): Promise<HistoricalDollarQuote[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(ARGENTINA_DATOS_DOLLARS_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`ArgentinaDatos respondió con HTTP ${response.status}.`)
    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) throw new Error('ArgentinaDatos devolvió un formato inesperado.')

    return payload
      .filter(isArgentinaDatosDollarQuote)
      .map((quote) => ({ date: quote.fecha.slice(0, 10), buy: quote.compra, sell: quote.venta }))
      .filter((quote) => /^\d{4}-\d{2}-\d{2}$/.test(quote.date) && quote.sell > 0)
      .sort((left, right) => left.date.localeCompare(right.date))
  } finally {
    clearTimeout(timeout)
  }
}
