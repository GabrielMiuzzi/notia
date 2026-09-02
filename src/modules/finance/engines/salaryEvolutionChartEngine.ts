import type { FinanceSalaryEvolution } from '../types/financeTypes'
import type { HistoricalDollarQuote } from '../services/argentinaDollarHistoryService'
import type { ArgentinaInflationIndex, ArgentinaInflationIndices } from '../services/argentinaInflationService'

export interface SalaryChartPoint {
  period: string
  ars: number
  usd: number
}

export interface SalaryChartScale {
  maximum: number
  ticks: number[]
}

export interface SalaryYearlySummary {
  currentPeriod: string
  comparisonPeriod: string
  monthCount: number
  arsVariationPercent: number
  usdVariationPercent: number
  averageArs: number
  averageUsd: number
}

export interface SalaryInflationBenchmark {
  period: string
  ipcAccumulatedPercent: number
  annualInflationPercent: number
  arsVsIpcPercentagePoints: number
  arsVsAnnualPercentagePoints: number
  usdVsIpcPercentagePoints: number
  usdVsAnnualPercentagePoints: number
}

export interface SalaryPointComparison {
  salaryChangePercent: number
  ipcAccumulatedPercent: number | null
  ipcDifferencePercentagePoints: number | null
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

function shiftPeriod(period: string, monthOffset: number): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
  if (!match) return null
  const absoluteMonth = Number(match[1]) * 12 + Number(match[2]) - 1 + monthOffset
  return `${Math.floor(absoluteMonth / 12)}-${String((absoluteMonth % 12) + 1).padStart(2, '0')}`
}

function monthDistance(fromPeriod: string, toPeriod: string): number | null {
  const from = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(fromPeriod)
  const to = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(toPeriod)
  if (!from || !to) return null
  return (Number(to[1]) - Number(from[1])) * 12 + Number(to[2]) - Number(from[2])
}

export function compareSalaryPointToPrevious(
  points: SalaryChartPoint[],
  pointIndex: number,
  field: 'ars' | 'usd',
  monthlyInflation: ArgentinaInflationIndex[],
): SalaryPointComparison | null {
  if (pointIndex <= 0 || pointIndex >= points.length) return null
  const previousPoint = points[pointIndex - 1]
  const currentPoint = points[pointIndex]
  const previousValue = previousPoint[field]
  const currentValue = currentPoint[field]
  if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue) || previousValue === 0) return null
  const salaryChangePercent = Number((((currentValue - previousValue) / previousValue) * 100).toFixed(2))
  const distance = monthDistance(previousPoint.period, currentPoint.period)
  if (!distance || distance < 0) return { salaryChangePercent, ipcAccumulatedPercent: null, ipcDifferencePercentagePoints: null }
  const monthlyByPeriod = new Map(monthlyInflation.map((index) => [index.period, index.percent]))
  const rates = Array.from({ length: distance }, (_, index) => monthlyByPeriod.get(shiftPeriod(previousPoint.period, index + 1) ?? ''))
  const confirmedRates = rates.filter((rate): rate is number => rate !== undefined)
  if (confirmedRates.length !== distance) return { salaryChangePercent, ipcAccumulatedPercent: null, ipcDifferencePercentagePoints: null }
  const ipcAccumulatedPercent = Number(((confirmedRates.reduce((factor, rate) => factor * (1 + rate / 100), 1) - 1) * 100).toFixed(2))
  return {
    salaryChangePercent,
    ipcAccumulatedPercent,
    ipcDifferencePercentagePoints: Number((salaryChangePercent - ipcAccumulatedPercent).toFixed(2)),
  }
}

export function summarizeSalaryYearAtPeriod(points: SalaryChartPoint[], currentPeriod: string): SalaryYearlySummary | null {
  const validPoints = points.filter((point) => /^(\d{4})-(0[1-9]|1[0-2])$/.test(point.period))
  const currentPoint = validPoints.find((point) => point.period === currentPeriod)
  if (!currentPoint) return null
  const comparisonPeriod = shiftPeriod(currentPoint.period, -12)
  if (!comparisonPeriod) return null
  const comparisonPoint = validPoints.find((point) => point.period === comparisonPeriod)
  if (!comparisonPoint || comparisonPoint.ars === 0 || comparisonPoint.usd === 0) return null
  const rollingPoints = validPoints.filter((point) => point.period > comparisonPeriod && point.period <= currentPoint.period)
  if (rollingPoints.length === 0) return null
  const percentageChange = (start: number, end: number) => Number((((end - start) / start) * 100).toFixed(2))
  return {
    currentPeriod: currentPoint.period,
    comparisonPeriod,
    monthCount: rollingPoints.length,
    arsVariationPercent: percentageChange(comparisonPoint.ars, currentPoint.ars),
    usdVariationPercent: percentageChange(comparisonPoint.usd, currentPoint.usd),
    averageArs: rollingPoints.reduce((sum, point) => sum + point.ars, 0) / rollingPoints.length,
    averageUsd: rollingPoints.reduce((sum, point) => sum + point.usd, 0) / rollingPoints.length,
  }
}

export function summarizeLatestSalaryYear(points: SalaryChartPoint[]): SalaryYearlySummary | null {
  const currentPeriod = points
    .map((point) => point.period)
    .filter((period) => /^(\d{4})-(0[1-9]|1[0-2])$/.test(period))
    .sort((left, right) => right.localeCompare(left))[0]
  return currentPeriod ? summarizeSalaryYearAtPeriod(points, currentPeriod) : null
}

export function buildSalaryInflationBenchmark(
  salarySummary: SalaryYearlySummary,
  inflation: ArgentinaInflationIndices,
): SalaryInflationBenchmark | null {
  const monthlyByPeriod = new Map(inflation.monthly.map((index) => [index.period, index.percent]))
  const monthlyRates = Array.from({ length: 12 }, (_, index) => monthlyByPeriod.get(shiftPeriod(salarySummary.comparisonPeriod, index + 1) ?? ''))
  const confirmedMonthlyRates = monthlyRates.filter((rate): rate is number => rate !== undefined)
  if (confirmedMonthlyRates.length !== 12) return null
  const annualInflationPercent = inflation.annual.find((index) => index.period === salarySummary.currentPeriod)?.percent
  if (annualInflationPercent === undefined) return null
  const ipcAccumulatedPercent = Number(((confirmedMonthlyRates.reduce((factor, rate) => factor * (1 + rate / 100), 1) - 1) * 100).toFixed(2))
  return {
    period: salarySummary.currentPeriod,
    ipcAccumulatedPercent,
    annualInflationPercent,
    arsVsIpcPercentagePoints: Number((salarySummary.arsVariationPercent - ipcAccumulatedPercent).toFixed(2)),
    arsVsAnnualPercentagePoints: Number((salarySummary.arsVariationPercent - annualInflationPercent).toFixed(2)),
    usdVsIpcPercentagePoints: Number((salarySummary.usdVariationPercent - ipcAccumulatedPercent).toFixed(2)),
    usdVsAnnualPercentagePoints: Number((salarySummary.usdVariationPercent - annualInflationPercent).toFixed(2)),
  }
}
