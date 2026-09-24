import { callBackend } from '../../../services/transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getArgentinaHolidays } from './argentinaHolidaysService'

vi.mock('../../../services/transport', () => ({ callBackend: vi.fn() }))

describe('getArgentinaHolidays', () => {
  afterEach(() => vi.mocked(callBackend).mockReset())

  it('asks the backend for the merged holidays of the year', async () => {
    const holidays = [{ date: '2026-05-01', name: 'Feriado bancario coincidente', kind: 'bank' }]
    vi.mocked(callBackend).mockResolvedValue(holidays)

    await expect(getArgentinaHolidays(2026)).resolves.toEqual(holidays)
    expect(callBackend).toHaveBeenCalledWith('calendar_argentina_holidays', { year: 2026 })
  })

  it('surfaces the backend error message', async () => {
    vi.mocked(callBackend).mockRejectedValue({ code: 'invalidInput', message: 'El año del calendario no es válido.', retryable: false })

    await expect(getArgentinaHolidays(1900)).rejects.toThrow('El año del calendario no es válido.')
  })
})
