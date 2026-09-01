import { describe, expect, it } from 'vitest'
import { buildSalaryChartPoints } from './salaryEvolutionChartEngine'

describe('buildSalaryChartPoints', () => {
  it('converts ARS salaries with the official selling rate available at payment date', () => {
    const points = buildSalaryChartPoints([
      { salary: { id: 'aug', period: '2026-08', paymentDate: '2026-08-28', employer: 'Demo', grossAmount: '110000', deductionsTotal: '10000', netAmount: '100000', currency: 'ARS', accountId: 'bank', status: 'confirmed', concepts: [] }, grossChange: '0', netChange: '0', deductionsChange: '0' },
      { salary: { id: 'sep', period: '2026-09', paymentDate: '2026-09-15', employer: 'Demo', grossAmount: '125000', deductionsTotal: '5000', netAmount: '120000', currency: 'ARS', accountId: 'bank', status: 'confirmed', concepts: [] }, grossChange: '0', netChange: '0', deductionsChange: '0' },
    ], [
      { date: '2026-08-27', buy: 1000, sell: 1250 },
      { date: '2026-09-10', buy: 1100, sell: 1500 },
    ])

    expect(points).toEqual([
      { period: '2026-08', ars: 100000, usd: 80 },
      { period: '2026-09', ars: 120000, usd: 80 },
    ])
  })

  it('combines salary receipts from the same period and supports USD receipts', () => {
    const points = buildSalaryChartPoints([
      { salary: { id: 'usd', period: '2026-08', paymentDate: '2026-08-28', employer: 'Outside', grossAmount: '100', deductionsTotal: '0', netAmount: '100', currency: 'USD', accountId: 'usd', status: 'confirmed', concepts: [] }, grossChange: '0', netChange: '0', deductionsChange: '0' },
      { salary: { id: 'ars', period: '2026-08', paymentDate: '2026-08-29', employer: 'Local', grossAmount: '12500', deductionsTotal: '2500', netAmount: '10000', currency: 'ARS', accountId: 'bank', status: 'confirmed', concepts: [] }, grossChange: '0', netChange: '0', deductionsChange: '0' },
    ], [{ date: '2026-08-28', buy: 90, sell: 100 }])

    expect(points).toEqual([{ period: '2026-08', ars: 20000, usd: 200 }])
  })
})
