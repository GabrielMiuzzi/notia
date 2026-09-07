import { afterEach, describe, expect, it, vi } from 'vitest'
import { getArgentinaHolidays } from './argentinaHolidaysService'

describe('getArgentinaHolidays', () => {
  afterEach(() => vi.restoreAllMocks())

  it('combines national and bank holidays and gives bank days their distinct type', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { fecha: '2026-05-01', nombre: 'Día del Trabajador', tipo: 'inamovible' },
        { fecha: '2026-06-15', nombre: 'Feriado puente' },
      ])))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { fecha: '2026-05-01', nombre: 'Feriado bancario coincidente' },
        { fecha: '2026-06-19', nombre: 'Día del empleado bancario' },
      ])))

    await expect(getArgentinaHolidays(2026)).resolves.toEqual([
      { date: '2026-05-01', name: 'Feriado bancario coincidente', kind: 'bank' },
      { date: '2026-06-15', name: 'Feriado puente', kind: 'national', detail: undefined },
      { date: '2026-06-19', name: 'Día del empleado bancario', kind: 'bank' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
