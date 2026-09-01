import { buildCreditCardChartData } from '../engines/creditCardEvolutionChartEngine'
import type { FinanceAccount, FinanceCreditCardStatement } from '../types/financeTypes'

interface CreditCardEvolutionChartProps {
  accounts: FinanceAccount[]
  statements: FinanceCreditCardStatement[]
}

const CHART_WIDTH = 960
const CHART_HEIGHT = 140
const CHART_PADDING = { top: 20, right: 24, bottom: 30, left: 76 }

function formatArs(value: number): string {
  return value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
}

function seriesPath(values: Array<number | null>, maximum: number): string {
  const width = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
  const height = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
  let started = false
  return values.map((value, index) => {
    if (value === null) {
      started = false
      return ''
    }
    const x = CHART_PADDING.left + (values.length === 1 ? width / 2 : (width * index) / (values.length - 1))
    const y = CHART_PADDING.top + height - (value / maximum) * height
    const command = started ? 'L' : 'M'
    started = true
    return `${command}${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

export function CreditCardEvolutionChart({ accounts, statements }: CreditCardEvolutionChartProps) {
  const data = buildCreditCardChartData(accounts, statements)
  const maximum = Math.max(1, ...data.series.flatMap((series) => series.values.filter((value): value is number => value !== null)))
  const chartBottom = CHART_HEIGHT - CHART_PADDING.bottom
  const chartWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right

  return <article className="finance-card finance-credit-card-chart-card" aria-labelledby="finance-credit-card-chart-title">
    <div className="finance-section-heading">
      <div>
        <h3 id="finance-credit-card-chart-title">Evolución de tarjetas</h3>
        <p className="finance-muted">Total a pagar por período para cada cuenta de tarjeta.</p>
      </div>
      <div className="finance-card-chart-legend" aria-label="Tarjetas incluidas">{data.series.map((series, index) => <span key={series.accountId}><i className={`finance-card-chart__line--${index % 4}`} />{series.name}</span>)}</div>
    </div>
    {data.series.length === 0 ? <p className="finance-muted">Cargá resúmenes de tarjeta para ver la evolución de cada cuenta.</p> : <div className="finance-chart-scroll"><svg className="finance-credit-card-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label="Evolución de los totales a pagar de tarjetas">
      <line x1={CHART_PADDING.left} y1={chartBottom} x2={CHART_WIDTH - CHART_PADDING.right} y2={chartBottom} className="finance-salary-chart__axis" />
      <line x1={CHART_PADDING.left} y1={CHART_PADDING.top} x2={CHART_PADDING.left} y2={chartBottom} className="finance-salary-chart__axis" />
      <text x={CHART_PADDING.left} y="16" className="finance-salary-chart__label">{formatArs(maximum)}</text>
      {data.series.map((series, index) => <path key={series.accountId} d={seriesPath(series.values, maximum)} className={`finance-credit-card-chart__line finance-card-chart__line--${index % 4}`} />)}
      {data.periods.map((period, index) => {
        const x = CHART_PADDING.left + (data.periods.length === 1 ? chartWidth / 2 : (chartWidth * index) / (data.periods.length - 1))
        return <text key={period} x={x} y={CHART_HEIGHT - 12} textAnchor="middle" className="finance-salary-chart__label">{period}</text>
      })}
    </svg></div>}
  </article>
}
