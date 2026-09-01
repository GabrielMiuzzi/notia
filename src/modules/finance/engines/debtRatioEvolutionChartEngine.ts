import { parseFinanceCents } from './financeAmounts'
import type { FinanceDebtRatioHistoryPoint } from '../types/financeTypes'

export interface DebtRatioChartSeries {
  currency: string
  values: Array<number | null>
}

export function buildDebtRatioChartData(history: FinanceDebtRatioHistoryPoint[]): {
  periods: string[]
  series: DebtRatioChartSeries[]
} {
  const points = [...history].sort((left, right) => left.period.localeCompare(right.period))
  const currencies = [...new Set(points.flatMap((point) => Object.keys(point.salaryByCurrency)))].sort()
  return {
    periods: points.map((point) => point.period),
    series: currencies.map((currency) => ({
      currency,
      values: points.map((point) => {
        const salary = parseFinanceCents(point.salaryByCurrency[currency] ?? '0')
        if (salary <= 0n) return null
        return Number((parseFinanceCents(point.debtByCurrency[currency] ?? '0') * 1_000n) / salary) / 10
      }),
    })).filter((series) => series.values.some((value) => value !== null)),
  }
}
