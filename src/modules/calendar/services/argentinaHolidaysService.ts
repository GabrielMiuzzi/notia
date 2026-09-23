import { invoke } from '@tauri-apps/api/core'

export type HolidayKind = 'national' | 'bank'

export interface CalendarHoliday {
  date: string
  name: string
  kind: HolidayKind
  detail?: string
}

/**
 * National and bank holidays of `year`. The backend fetches the provider with
 * a timeout, validates and merges the series and caches them per year.
 */
export async function getArgentinaHolidays(year: number): Promise<CalendarHoliday[]> {
  try {
    return await invoke<CalendarHoliday[]>('calendar_argentina_holidays', { year })
  } catch (error) {
    if (error instanceof Error) throw error
    const message = error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : 'No se pudieron obtener los feriados.'
    throw new Error(message)
  }
}
