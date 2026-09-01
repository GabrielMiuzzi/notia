import { describe, expect, it } from 'vitest'
import { buildDebtRatioChartData } from './debtRatioEvolutionChartEngine'

describe('buildDebtRatioChartData', () => {
  it('calcula el porcentaje por moneda y deja vacío un mes sin sueldo', () => {
    expect(buildDebtRatioChartData([
      { period: '2026-09', debtByCurrency: { ARS: '300' }, salaryByCurrency: { ARS: '1000' } },
      { period: '2026-08', debtByCurrency: { ARS: '100' }, salaryByCurrency: { ARS: '0' } },
      { period: '2026-10', debtByCurrency: {}, salaryByCurrency: { ARS: '800' } },
    ])).toEqual({
      periods: ['2026-08', '2026-09', '2026-10'],
      series: [{ currency: 'ARS', values: [null, 30, 0] }],
    })
  })
})
