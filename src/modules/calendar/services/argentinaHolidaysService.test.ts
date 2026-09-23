import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { getArgentinaHolidays } from './argentinaHolidaysService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('getArgentinaHolidays', () => {
  afterEach(() => vi.mocked(invoke).mockReset())

  it('asks the backend for the merged holidays of the year', async () => {
    const holidays = [{ date: '2026-05-01', name: 'Feriado bancario coincidente', kind: 'bank' }]
    vi.mocked(invoke).mockResolvedValue(holidays)

    await expect(getArgentinaHolidays(2026)).resolves.toEqual(holidays)
    expect(invoke).toHaveBeenCalledWith('calendar_argentina_holidays', { year: 2026 })
  })

  it('surfaces the backend error message', async () => {
    vi.mocked(invoke).mockRejectedValue({ code: 'invalidInput', message: 'El año del calendario no es válido.', retryable: false })

    await expect(getArgentinaHolidays(1900)).rejects.toThrow('El año del calendario no es válido.')
  })
})
