export interface ArgentinaInflationIndex {
  period: string
  percent: number
}

export interface ArgentinaInflationIndices {
  monthly: ArgentinaInflationIndex[]
  annual: ArgentinaInflationIndex[]
}

interface ArgentinaDatosInflationIndex {
  fecha: string
  valor: number
}

const ARGENTINA_DATOS_MONTHLY_INFLATION_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/inflacion'
const ARGENTINA_DATOS_ANNUAL_INFLATION_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/inflacionInteranual'
const REQUEST_TIMEOUT_MS = 10_000

function isArgentinaDatosInflationIndex(value: unknown): value is ArgentinaDatosInflationIndex {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.fecha === 'string' && typeof candidate.valor === 'number' && Number.isFinite(candidate.valor)
}

async function getInflationSeries(url: string): Promise<ArgentinaInflationIndex[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
    if (!response.ok) throw new Error(`ArgentinaDatos respondió con HTTP ${response.status}.`)
    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) throw new Error('ArgentinaDatos devolvió un formato inesperado.')
    return payload
      .filter(isArgentinaDatosInflationIndex)
      .map((index) => ({ period: index.fecha.slice(0, 7), percent: index.valor }))
      .filter((index) => /^\d{4}-(0[1-9]|1[0-2])$/.test(index.period))
      .sort((left, right) => left.period.localeCompare(right.period))
  } finally {
    clearTimeout(timeout)
  }
}

export async function getArgentinaInflationIndices(): Promise<ArgentinaInflationIndices> {
  const [monthly, annual] = await Promise.all([
    getInflationSeries(ARGENTINA_DATOS_MONTHLY_INFLATION_URL),
    getInflationSeries(ARGENTINA_DATOS_ANNUAL_INFLATION_URL),
  ])
  return { monthly, annual }
}
