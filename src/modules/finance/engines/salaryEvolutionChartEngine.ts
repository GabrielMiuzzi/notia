import type { FinanceSalaryEvolution } from '../types/financeTypes'
import type { HistoricalDollarQuote } from '../services/argentinaDollarHistoryService'

export interface SalaryChartPoint {
  period: string
  ars: number
  usd: number
}

function latestRateOnOrBefore(quotes: HistoricalDollarQuote[], date: string): number | null {
  for (let index = quotes.length - 1; index >= 0; index -= 1) {
    if (quotes[index].date <= date) return quotes[index].sell
  }
  return null
}

export function buildSalaryChartPoints(
  salaries: FinanceSalaryEvolution[],
  quotes: HistoricalDollarQuote[],
): SalaryChartPoint[] {
  const totals = new Map<string, SalaryChartPoint>()
  for (const { salary } of salaries) {
    const amount = Number(salary.netAmount)
    const rate = latestRateOnOrBefore(quotes, salary.paymentDate)
    if (!Number.isFinite(amount) || amount < 0 || !rate) continue

    const point = totals.get(salary.period) ?? { period: salary.period, ars: 0, usd: 0 }
    if (salary.currency === 'ARS') {
      point.ars += amount
      point.usd += amount / rate
    } else {
      point.ars += amount * rate
      point.usd += amount
    }
    totals.set(salary.period, point)
  }
  return [...totals.values()].sort((left, right) => left.period.localeCompare(right.period))
}
