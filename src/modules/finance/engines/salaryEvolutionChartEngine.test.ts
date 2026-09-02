import { describe, expect, it } from 'vitest'
import { buildSalaryChartPoints, buildSalaryChartScale, buildSalaryInflationBenchmark, compareSalaryPointToPrevious, salaryChartWidth, summarizeLatestSalaryYear, summarizeSalaryYearAtPeriod } from './salaryEvolutionChartEngine'

describe('buildSalaryChartPoints', () => {
  it('keeps long histories readable with horizontal spacing for every period', () => {
    expect(salaryChartWidth(1)).toBe(480)
    expect(salaryChartWidth(6)).toBe(504)
    expect(salaryChartWidth(21)).toBe(1584)
  })

  it('builds readable monetary ticks that cover every salary value', () => {
    expect(buildSalaryChartScale([3_374_902.85, 7_815_434.89])).toEqual({
      maximum: 8_000_000,
      ticks: [0, 2_000_000, 4_000_000, 6_000_000, 8_000_000],
    })
    expect(buildSalaryChartScale([3297])).toEqual({
      maximum: 4000,
      ticks: [0, 1000, 2000, 3000, 4000],
    })
  })

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

  it('compares the latest period with the same period twelve months earlier and uses a rolling average', () => {
    const points = [
      ...Array.from({ length: 12 }, (_, index) => ({
        period: `2025-${String(index + 1).padStart(2, '0')}`,
        ars: 100 + index * 10,
        usd: 10 + index,
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        period: `2026-${String(index + 1).padStart(2, '0')}`,
        ars: 220 + index * 10,
        usd: 22 + index,
      })),
    ]

    expect(summarizeLatestSalaryYear(points)).toEqual({
      currentPeriod: '2026-08',
      comparisonPeriod: '2025-08',
      monthCount: 12,
      arsVariationPercent: 70.59,
      usdVariationPercent: 70.59,
      averageArs: 235,
      averageUsd: 23.5,
    })
  })

  it('does not produce a rolling comparison without the period from twelve months earlier', () => {
    expect(summarizeLatestSalaryYear([
      { period: '2026-01', ars: 100, usd: 10 },
      { period: '2026-02', ars: 120, usd: 12 },
    ])).toBeNull()
  })

  it('can align the rolling summary with the latest published inflation period', () => {
    const points = [
      { period: '2025-07', ars: 100, usd: 100 },
      { period: '2026-07', ars: 150, usd: 150 },
      { period: '2026-08', ars: 160, usd: 160 },
    ]

    expect(summarizeLatestSalaryYear(points)).toBeNull()
    expect(summarizeSalaryYearAtPeriod(points, '2026-07')).toMatchObject({
      currentPeriod: '2026-07',
      comparisonPeriod: '2025-07',
      arsVariationPercent: 50,
    })
  })

  it('reports the change from the preceding point and whether it surpassed IPC for that span', () => {
    const points = [
      { period: '2026-01', ars: 100, usd: 100 },
      { period: '2026-03', ars: 120, usd: 110 },
    ]
    const monthlyInflation = [
      { period: '2026-02', percent: 5 },
      { period: '2026-03', percent: 5 },
    ]

    expect(compareSalaryPointToPrevious(points, 1, 'ars', monthlyInflation)).toEqual({
      salaryChangePercent: 20,
      ipcAccumulatedPercent: 10.25,
      ipcDifferencePercentagePoints: 9.75,
    })
    expect(compareSalaryPointToPrevious(points, 0, 'ars', monthlyInflation)).toBeNull()
    expect(compareSalaryPointToPrevious(points, 1, 'usd', [])).toEqual({
      salaryChangePercent: 10,
      ipcAccumulatedPercent: null,
      ipcDifferencePercentagePoints: null,
    })
  })

  it('compares salary variation with compounded IPC and the aligned interannual rate', () => {
    const summary = summarizeLatestSalaryYear([
      { period: '2025-08', ars: 100, usd: 100 },
      ...Array.from({ length: 12 }, (_, index) => ({ period: index < 4 ? `2025-${String(index + 9).padStart(2, '0')}` : `2026-${String(index - 3).padStart(2, '0')}`, ars: 150, usd: 150 })),
    ])
    expect(summary).not.toBeNull()
    if (!summary) throw new Error('Expected rolling salary summary.')

    expect(buildSalaryInflationBenchmark(summary, {
      monthly: Array.from({ length: 12 }, (_, index) => ({ period: index < 4 ? `2025-${String(index + 9).padStart(2, '0')}` : `2026-${String(index - 3).padStart(2, '0')}`, percent: 5 })),
      annual: [{ period: '2026-08', percent: 70 }],
    })).toEqual({
      period: '2026-08',
      ipcAccumulatedPercent: 79.59,
      annualInflationPercent: 70,
      arsVsIpcPercentagePoints: -29.59,
      arsVsAnnualPercentagePoints: -20,
      usdVsIpcPercentagePoints: -29.59,
      usdVsAnnualPercentagePoints: -20,
    })
  })
})
