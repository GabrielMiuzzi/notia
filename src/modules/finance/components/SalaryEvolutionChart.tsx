import { useEffect, useState } from 'react'
import { financeErrorMessage } from '../engines/financeError'
import { buildSalaryChartPoints, type SalaryChartPoint } from '../engines/salaryEvolutionChartEngine'
import { getOfficialHistoricalDollarQuotes } from '../services/argentinaDollarHistoryService'
import type { FinanceSalaryEvolution } from '../types/financeTypes'

interface SalaryEvolutionChartProps {
  salaries: FinanceSalaryEvolution[]
}

const CHART_WIDTH = 480
const CHART_HEIGHT = 140
const CHART_PADDING = { top: 20, right: 72, bottom: 30, left: 72 }

function formatCurrency(value: number, currency: 'ARS' | 'USD'): string {
  return value.toLocaleString('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 })
}

function linePath(points: SalaryChartPoint[], field: 'ars' | 'usd', maximum: number): string {
  const width = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
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
    {points.length > 0 && <div className="finance-salary-charts"><SalaryLineChart points={points} currency="ARS" field="ars" title="Sueldo neto en pesos" /><SalaryLineChart points={points} currency="USD" field="usd" title="Sueldo neto en dólares" /></div>}
  </article>
}

function SalaryLineChart({ points, currency, field, title }: { points: SalaryChartPoint[]; currency: 'ARS' | 'USD'; field: 'ars' | 'usd'; title: string }) {
  const maximum = Math.max(1, ...points.map((point) => point[field]))
  const chartBottom = CHART_HEIGHT - CHART_PADDING.bottom
  const width = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
  const lineClass = field === 'ars' ? 'finance-salary-chart__line--ars' : 'finance-salary-chart__line--usd'

  return <figure className="finance-salary-chart-panel">
    <figcaption>{title}</figcaption>
    <div className="finance-chart-scroll"><svg className="finance-salary-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={title}>
      <line x1={CHART_PADDING.left} y1={chartBottom} x2={CHART_WIDTH - CHART_PADDING.right} y2={chartBottom} className="finance-salary-chart__axis" />
      <line x1={CHART_PADDING.left} y1={CHART_PADDING.top} x2={CHART_PADDING.left} y2={chartBottom} className="finance-salary-chart__axis" />
      <text x={CHART_PADDING.left} y="16" className="finance-salary-chart__label">{formatCurrency(maximum, currency)}</text>
      <path d={linePath(points, field, maximum)} className={`finance-salary-chart__line ${lineClass}`} />
      {points.map((point, index) => {
        const x = CHART_PADDING.left + (points.length === 1 ? width / 2 : (width * index) / (points.length - 1))
        return <text key={point.period} x={x} y={CHART_HEIGHT - 12} textAnchor="middle" className="finance-salary-chart__label">{point.period}</text>
      })}
    </svg></div>
  </figure>
}
