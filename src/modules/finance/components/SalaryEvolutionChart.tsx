import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { financeErrorMessage } from '../engines/financeError'
import { buildSalaryChartPoints, buildSalaryChartScale, buildSalaryInflationBenchmark, compareSalaryPointToPrevious, salaryChartWidth, summarizeLatestSalaryYear, summarizeSalaryYearAtPeriod, type SalaryChartPoint, type SalaryInflationBenchmark } from '../engines/salaryEvolutionChartEngine'
import { getOfficialHistoricalDollarQuotes } from '../services/argentinaDollarHistoryService'
import { getArgentinaInflationIndices } from '../services/argentinaInflationService'
import type { ArgentinaInflationIndex } from '../services/argentinaInflationService'
import type { FinanceSalaryEvolution } from '../types/financeTypes'

interface SalaryEvolutionChartProps {
  salaries: FinanceSalaryEvolution[]
}

const CHART_HEIGHT = 220
const CHART_PADDING = { top: 18, right: 24, bottom: 34, left: 96 }

function formatCurrency(value: number, currency: 'ARS' | 'USD'): string {
  return value.toLocaleString('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 })
}

function formatExactCurrency(value: number, currency: 'ARS' | 'USD'): string {
  return value.toLocaleString('es-AR', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

function formatPercentagePoints(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} p.p.`
}

function linePath(points: SalaryChartPoint[], field: 'ars' | 'usd', maximum: number, chartWidth: number): string {
  const width = chartWidth - CHART_PADDING.left - CHART_PADDING.right
  const height = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
  return points.map((point, index) => {
    const x = CHART_PADDING.left + (points.length === 1 ? width / 2 : (width * index) / (points.length - 1))
    const y = CHART_PADDING.top + height - (point[field] / maximum) * height
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

export function SalaryEvolutionChart({ salaries }: SalaryEvolutionChartProps) {
  const [points, setPoints] = useState<SalaryChartPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [inflationBenchmark, setInflationBenchmark] = useState<SalaryInflationBenchmark | null>(null)
  const [monthlyInflation, setMonthlyInflation] = useState<ArgentinaInflationIndex[]>([])
  const [inflationError, setInflationError] = useState<string | null>(null)
  const [isLoadingInflation, setIsLoadingInflation] = useState(false)
  const yearlySummary = summarizeLatestSalaryYear(points)

  useEffect(() => {
    let isCurrent = true
    if (salaries.length === 0) {
      setPoints([])
      setError(null)
      return () => { isCurrent = false }
    }
    setIsLoading(true)
    setError(null)
    void getOfficialHistoricalDollarQuotes()
      .then((quotes) => {
        if (isCurrent) setPoints(buildSalaryChartPoints(salaries, quotes))
      })
      .catch((reason) => {
        if (isCurrent) setError(financeErrorMessage(reason, 'No se pudo cargar la cotización histórica del dólar.'))
      })
      .finally(() => { if (isCurrent) setIsLoading(false) })
    return () => { isCurrent = false }
  }, [salaries])

  useEffect(() => {
    let isCurrent = true
    const summary = summarizeLatestSalaryYear(points)
    if (!summary) {
      setInflationBenchmark(null)
      setMonthlyInflation([])
      setInflationError(null)
      setIsLoadingInflation(false)
      return () => { isCurrent = false }
    }
    setIsLoadingInflation(true)
    setInflationError(null)
    setMonthlyInflation([])
    void getArgentinaInflationIndices()
      .then((indices) => {
        if (isCurrent) setMonthlyInflation(indices.monthly)
        const salaryPeriods = [...new Set(points.map((point) => point.period))].sort((left, right) => right.localeCompare(left))
        for (const period of salaryPeriods) {
          const alignedSummary = summarizeSalaryYearAtPeriod(points, period)
          if (!alignedSummary) continue
          const benchmark = buildSalaryInflationBenchmark(alignedSummary, indices)
          if (benchmark) {
            if (isCurrent) setInflationBenchmark(benchmark)
            return
          }
        }
        if (isCurrent) setInflationBenchmark(null)
      })
      .catch((reason) => {
        if (isCurrent) {
          setMonthlyInflation([])
          setInflationError(financeErrorMessage(reason, 'No se pudieron cargar los índices de inflación.'))
        }
      })
      .finally(() => { if (isCurrent) setIsLoadingInflation(false) })
    return () => { isCurrent = false }
  }, [points])

  return <article className="finance-card finance-salary-chart-card" aria-labelledby="finance-salary-chart-title">
    <div className="finance-section-heading">
      <div>
        <h3 id="finance-salary-chart-title">Evolución salarial</h3>
        <p className="finance-muted">Neto mensual y equivalente en USD oficial.</p>
      </div>
    </div>
    {isLoading && <p className="finance-muted" role="status">Cargando cotizaciones históricas…</p>}
    {error && <p className="finance-error" role="alert">{error}</p>}
    {!isLoading && !error && points.length === 0 && <p className="finance-muted">Cargá recibos de sueldo con fecha de cobro para ver su evolución.</p>}
    {points.length > 0 && <>
      <div className="finance-salary-charts"><SalaryLineChart points={points} monthlyInflation={monthlyInflation} currency="ARS" field="ars" title="Sueldo neto en pesos" /><SalaryLineChart points={points} monthlyInflation={monthlyInflation} currency="USD" field="usd" title="Sueldo neto en dólares" /></div>
      {yearlySummary ? <div className="finance-salary-summary" aria-label={`Resumen salarial móvil hasta ${yearlySummary.currentPeriod}`}>
        <SalarySummaryCard title="Variación anual en dólares" value={formatPercent(yearlySummary.usdVariationPercent)} detail={`${yearlySummary.comparisonPeriod} vs. ${yearlySummary.currentPeriod}`} />
        <SalarySummaryCard title="Variación anual en pesos" value={formatPercent(yearlySummary.arsVariationPercent)} detail={`${yearlySummary.comparisonPeriod} vs. ${yearlySummary.currentPeriod}`} />
        <SalarySummaryCard title="Promedio mensual en pesos" value={formatExactCurrency(yearlySummary.averageArs, 'ARS')} detail={`Últimos ${yearlySummary.monthCount} meses hasta ${yearlySummary.currentPeriod}`} />
        <SalarySummaryCard title="Promedio mensual en dólares" value={formatExactCurrency(yearlySummary.averageUsd, 'USD')} detail={`Últimos ${yearlySummary.monthCount} meses hasta ${yearlySummary.currentPeriod}`} />
      </div> : <p className="finance-muted finance-salary-summary-unavailable">El resumen estará disponible al tener un sueldo del mismo período de hace 12 meses.</p>}
      {yearlySummary && <SalaryInflationComparison period={yearlySummary.currentPeriod} benchmark={inflationBenchmark} error={inflationError} isLoading={isLoadingInflation} />}
    </>}
  </article>
}

function SalarySummaryCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <section className="finance-salary-summary__card">
    <h4>{title}</h4>
    <strong>{value}</strong>
    <small>{detail}</small>
  </section>
}

function SalaryInflationComparison({ period, benchmark, error, isLoading }: { period: string; benchmark: SalaryInflationBenchmark | null; error: string | null; isLoading: boolean }) {
  if (isLoading) return <p className="finance-muted finance-salary-inflation-status" role="status">Comparando con IPC e inflación interanual…</p>
  if (error) return <p className="finance-warning finance-salary-inflation-status" role="status">{error}</p>
  if (!benchmark) return <p className="finance-muted finance-salary-inflation-status">Aguardando el IPC y la inflación interanual de {period} para compararlos.</p>
  return <section className="finance-salary-inflation" aria-label={`Comparación salarial con inflación hasta ${benchmark.period}`}>
    <h4>Variación salarial frente a inflación hasta {benchmark.period}</h4>
    <p className="finance-muted">La comparación usa la variación de cada sueldo; el promedio mensual se muestra arriba como importe.</p>
    <div className="finance-salary-inflation__cards">
      <SalaryInflationCard title="Sueldo en pesos" ipcDifference={benchmark.arsVsIpcPercentagePoints} annualDifference={benchmark.arsVsAnnualPercentagePoints} />
      <SalaryInflationCard title="Sueldo en dólares" ipcDifference={benchmark.usdVsIpcPercentagePoints} annualDifference={benchmark.usdVsAnnualPercentagePoints} />
    </div>
  </section>
}

function SalaryInflationCard({ title, ipcDifference, annualDifference }: { title: string; ipcDifference: number; annualDifference: number }) {
  const winsBoth = ipcDifference >= 0 && annualDifference >= 0
  return <section className="finance-salary-inflation__card">
    <h5>{title}</h5>
    <strong className={winsBoth ? 'finance-success' : 'finance-warning'}>{winsBoth ? 'Le gana a la inflación' : 'No le gana a la inflación'}</strong>
    <small>Vs. IPC acumulado: {formatPercentagePoints(ipcDifference)}</small>
    <small>Vs. inflación interanual: {formatPercentagePoints(annualDifference)}</small>
  </section>
}

function SalaryLineChart({ points, monthlyInflation, currency, field, title }: { points: SalaryChartPoint[]; monthlyInflation: ArgentinaInflationIndex[]; currency: 'ARS' | 'USD'; field: 'ars' | 'usd'; title: string }) {
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null)
  const scale = buildSalaryChartScale(points.map((point) => point[field]))
  const chartWidth = salaryChartWidth(points.length)
  const chartBottom = CHART_HEIGHT - CHART_PADDING.bottom
  const width = chartWidth - CHART_PADDING.left - CHART_PADDING.right
  const height = chartBottom - CHART_PADDING.top
  const lineClass = field === 'ars' ? 'finance-salary-chart__line--ars' : 'finance-salary-chart__line--usd'
  const coordinates = points.map((point, index) => ({
    x: CHART_PADDING.left + (points.length === 1 ? width / 2 : (width * index) / (points.length - 1)),
    y: CHART_PADDING.top + height - (point[field] / scale.maximum) * height,
  }))
  const activePoint = activePointIndex === null ? null : points[activePointIndex]
  const activeCoordinates = activePointIndex === null ? null : coordinates[activePointIndex]
  const activeComparison = activePointIndex === null ? null : compareSalaryPointToPrevious(points, activePointIndex, field, monthlyInflation)
  const tooltipWidth = 250
  const tooltipHeight = activeComparison ? 82 : 46
  const tooltipCenterX = activeCoordinates
    ? Math.min(chartWidth - CHART_PADDING.right - tooltipWidth / 2, Math.max(CHART_PADDING.left + tooltipWidth / 2, activeCoordinates.x))
    : 0
  const tooltipY = activeCoordinates
    ? activeCoordinates.y < CHART_PADDING.top + tooltipHeight + 10 ? activeCoordinates.y + 12 : activeCoordinates.y - tooltipHeight - 10
    : 0
  const activateNearestPoint = (event: ReactPointerEvent<SVGPathElement>) => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const bounds = svg.getBoundingClientRect()
    if (bounds.width === 0) return
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * chartWidth
    const nearestIndex = coordinates.reduce((nearest, coordinate, index) => (
      Math.abs(coordinate.x - pointerX) < Math.abs(coordinates[nearest].x - pointerX) ? index : nearest
    ), 0)
    setActivePointIndex(nearestIndex)
  }

  return <figure className="finance-salary-chart-panel">
    <figcaption>{title}</figcaption>
    <div className="finance-chart-scroll"><svg className="finance-salary-chart" width={chartWidth} viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`} role="img" aria-label={title}>
      {scale.ticks.map((tick) => {
        const y = CHART_PADDING.top + height - (tick / scale.maximum) * height
        return <g key={tick}>
          <line x1={CHART_PADDING.left} y1={y} x2={chartWidth - CHART_PADDING.right} y2={y} className="finance-salary-chart__grid" />
          <text x={CHART_PADDING.left - 10} y={y + 4} textAnchor="end" className="finance-salary-chart__label finance-salary-chart__y-label">{formatCurrency(tick, currency)}</text>
        </g>
      })}
      <line x1={CHART_PADDING.left} y1={chartBottom} x2={chartWidth - CHART_PADDING.right} y2={chartBottom} className="finance-salary-chart__axis" />
      <line x1={CHART_PADDING.left} y1={CHART_PADDING.top} x2={CHART_PADDING.left} y2={chartBottom} className="finance-salary-chart__axis" />
      <path d={linePath(points, field, scale.maximum, chartWidth)} className={`finance-salary-chart__line ${lineClass}`} />
      <path
        d={linePath(points, field, scale.maximum, chartWidth)}
        className="finance-salary-chart__line-target"
        pointerEvents="stroke"
        onPointerEnter={activateNearestPoint}
        onPointerMove={activateNearestPoint}
        onPointerLeave={(event) => { if (event.pointerType !== 'touch') setActivePointIndex(null) }}
        onPointerDown={activateNearestPoint}
      />
      {points.map((point, index) => {
        const { x, y } = coordinates[index]
        const exactValue = formatExactCurrency(point[field], currency)
        return <g key={point.period}>
          <text x={x} y={CHART_HEIGHT - 12} textAnchor="middle" className="finance-salary-chart__label">{point.period}</text>
          <circle cx={x} cy={y} r="4" className={`finance-salary-chart__point ${lineClass}`} aria-hidden="true" />
          <circle
            cx={x}
            cy={y}
            r="14"
            className="finance-salary-chart__point-target"
            role="img"
            tabIndex={0}
            aria-label={`${point.period}: ${exactValue}`}
            onPointerEnter={() => setActivePointIndex(index)}
            onPointerLeave={(event) => { if (event.pointerType !== 'touch') setActivePointIndex(null) }}
            onPointerDown={() => setActivePointIndex(index)}
            onFocus={() => setActivePointIndex(index)}
            onBlur={() => setActivePointIndex(null)}
          />
        </g>
      })}
      {activePoint && activeCoordinates && <g className="finance-salary-chart__tooltip" aria-hidden="true" pointerEvents="none">
        <line x1={activeCoordinates.x} y1={CHART_PADDING.top} x2={activeCoordinates.x} y2={chartBottom} className="finance-salary-chart__crosshair" />
        <rect x={tooltipCenterX - tooltipWidth / 2} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="4" />
        <text x={tooltipCenterX} y={tooltipY + 17} textAnchor="middle" className="finance-salary-chart__tooltip-period">{activePoint.period}</text>
        <text x={tooltipCenterX} y={tooltipY + 35} textAnchor="middle" className="finance-salary-chart__tooltip-value">{formatExactCurrency(activePoint[field], currency)}</text>
        {activeComparison && <>
          <text x={tooltipCenterX} y={tooltipY + 53} textAnchor="middle">{activeComparison.salaryChangePercent >= 0 ? 'Aumentó' : 'Bajó'} {formatPercent(activeComparison.salaryChangePercent)} vs. período anterior</text>
          <text x={tooltipCenterX} y={tooltipY + 70} textAnchor="middle">{activeComparison.ipcDifferencePercentagePoints === null ? 'IPC no disponible para ese período' : activeComparison.ipcDifferencePercentagePoints >= 0 ? `Superó el IPC por ${formatPercentagePoints(activeComparison.ipcDifferencePercentagePoints)}` : `Quedó por debajo del IPC ${formatPercentagePoints(activeComparison.ipcDifferencePercentagePoints)}`}</text>
        </>}
      </g>}
    </svg></div>
  </figure>
}
