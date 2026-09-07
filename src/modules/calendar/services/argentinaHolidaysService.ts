export type HolidayKind = 'national' | 'bank'

export interface CalendarHoliday {
  date: string
  name: string
  kind: HolidayKind
  detail?: string
}

interface ArgentinaHoliday { fecha: string; nombre: string; tipo?: string }

const HOLIDAYS_URL = 'https://api.argentinadatos.com/v1/feriados'
const BANK_HOLIDAYS_URL = 'https://api.argentinadatos.com/v1/feriados-bancarios'
const REQUEST_TIMEOUT_MS = 10_000

function isHoliday(value: unknown): value is ArgentinaHoliday {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.fecha)
    && typeof candidate.nombre === 'string'
}

async function getHolidaySeries(url: string, year: number): Promise<ArgentinaHoliday[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${url}/${year}`, { headers: { Accept: 'application/json' }, signal: controller.signal })
    if (!response.ok) throw new Error(`ArgentinaDatos respondió con HTTP ${response.status}.`)
    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) throw new Error('ArgentinaDatos devolvió un formato inesperado.')
    return payload.filter(isHoliday)
  } finally {
    clearTimeout(timeout)
  }
}

export async function getArgentinaHolidays(year: number): Promise<CalendarHoliday[]> {
  if (!Number.isInteger(year) || year < 2016 || year > 2100) throw new Error('El año del calendario no es válido.')
  const [national, bank] = await Promise.all([
    getHolidaySeries(HOLIDAYS_URL, year),
    getHolidaySeries(BANK_HOLIDAYS_URL, year),
  ])
  const holidays = new Map<string, CalendarHoliday>()
  for (const holiday of national) {
    holidays.set(holiday.fecha, { date: holiday.fecha, name: holiday.nombre, kind: 'national', detail: holiday.tipo })
  }
  for (const holiday of bank) {
    holidays.set(holiday.fecha, { date: holiday.fecha, name: holiday.nombre, kind: 'bank' })
  }
  return [...holidays.values()].sort((left, right) => left.date.localeCompare(right.date))
}
