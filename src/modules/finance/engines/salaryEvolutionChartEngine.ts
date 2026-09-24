/*
 * Layout of the salary charts. The backend computes the points, the
 * comparisons and the inflation benchmark (`finance_salary_analysis`).
 */

export interface SalaryChartPoint {
  period: string
  ars: number
  usd: number
}

export interface SalaryChartScale {
  maximum: number
  ticks: number[]
}

const MINIMUM_CHART_WIDTH = 480
const CHART_HORIZONTAL_PADDING = 144
const MINIMUM_PERIOD_SPACING = 72

export function salaryChartWidth(periodCount: number): number {
  const intervals = Math.max(0, Math.trunc(periodCount) - 1)
  return Math.max(MINIMUM_CHART_WIDTH, CHART_HORIZONTAL_PADDING + intervals * MINIMUM_PERIOD_SPACING)
}

export function buildSalaryChartScale(values: number[], intervalCount = 4): SalaryChartScale {
  const safeIntervalCount = Math.max(1, Math.trunc(intervalCount))
  const dataMaximum = Math.max(0, ...values.filter((value) => Number.isFinite(value)))
  if (dataMaximum === 0) {
    return { maximum: 1, ticks: Array.from({ length: safeIntervalCount + 1 }, (_, index) => index / safeIntervalCount) }
  }

  const roughStep = dataMaximum / safeIntervalCount
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const normalizedStep = roughStep / magnitude
  const multiplier = normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10
  const step = multiplier * magnitude
  const maximum = step * Math.ceil(dataMaximum / step)
  const ticks = Array.from({ length: Math.round(maximum / step) + 1 }, (_, index) => index * step)
  return { maximum, ticks }
}
