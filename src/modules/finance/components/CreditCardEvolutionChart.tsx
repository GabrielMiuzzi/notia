import { buildCreditCardChartData } from '../engines/creditCardEvolutionChartEngine'
import type { FinanceAccount, FinanceCreditCardStatement } from '../types/financeTypes'

interface CreditCardEvolutionChartProps {
  accounts: FinanceAccount[]
  statements: FinanceCreditCardStatement[]
}

const CHART_WIDTH = 960
const CHART_HEIGHT = 140
const CHART_PADDING = { top: 20, right: 24, bottom: 30, left: 76 }

function formatAmount(value: number, currency?: string): string {
  const amount = value.toLocaleString('es-AR', { maximumFractionDigits: 0 })
  return currency ? `${currency} ${amount}` : amount
}

function pointX(index: number, count: number): number {
  const width = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
  return CHART_PADDING.left + (count === 1 ? width / 2 : (width * index) / (count - 1))
}

function pointY(value: number, maximum: number): number {
  const height = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
  return CHART_PADDING.top + height - (value / maximum) * height
}

function seriesPath(values: Array<number | null>, maximum: number): string {
  let started = false
  return values.map((value, index) => {
    if (value === null) {
      started = false
      return ''
    }
    const command = started ? 'L' : 'M'
    started = true
    return `${command}${pointX(index, values.length).toFixed(2)},${pointY(value, maximum).toFixed(2)}`
  }).join(' ')
}

export function CreditCardEvolutionChart({ accounts, statements }: CreditCardEvolutionChartProps) {
  const data = buildCreditCardChartData(accounts, statements)
  const maximum = Math.max(1, ...data.series.flatMap((series) => series.values.filter((value): value is number => value !== null)))
  const chartBottom = CHART_HEIGHT - CHART_PADDING.bottom
  const singleCurrency = new Set(data.series.map((series) => series.currency)).size === 1 ? data.series[0]?.currency : undefined

  return <article className="finance-card finance-credit-card-chart-card" aria-labelledby="finance-credit-card-chart-title">
    <div className="finance-section-heading">
      <div>
        <h3 id="finance-credit-card-chart-title">Pagado por tarjeta</h3>
        <p className="finance-muted">Total de cada resumen, en el mes en que vence.</p>
      </div>
      <div className="finance-card-chart-legend" aria-label="Tarjetas incluidas">{data.series.map((series, index) => <span key={series.key}><i className={`finance-card-chart__line--${index % 4}`} />{series.name}</span>)}</div>
    </div>
    {data.series.length === 0 ? <p className="finance-muted">Cargá resúmenes de tarjeta para ver cuánto pagaste de cada una.</p> : <div className="finance-chart-scroll"><svg className="finance-credit-card-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label="Pagado por tarjeta en cada mes">
      <line x1={CHART_PADDING.left} y1={chartBottom} x2={CHART_WIDTH - CHART_PADDING.right} y2={chartBottom} className="finance-salary-chart__axis" />
      <line x1={CHART_PADDING.left} y1={CHART_PADDING.top} x2={CHART_PADDING.left} y2={chartBottom} className="finance-salary-chart__axis" />
      <text x={CHART_PADDING.left} y="16" className="finance-salary-chart__label">{formatAmount(maximum, singleCurrency)}</text>
      {data.series.map((series, index) => <g key={series.key}>
        <path d={seriesPath(series.values, maximum)} className={`finance-credit-card-chart__line finance-card-chart__line--${index % 4}`} />
        {series.values.map((value, pointIndex) => value === null ? null : <circle key={data.periods[pointIndex]} cx={pointX(pointIndex, series.values.length)} cy={pointY(value, maximum)} r="4" className={`finance-chart-point finance-card-chart__line--${index % 4}`}><title>{`${series.name} · ${data.periods[pointIndex]}: ${formatAmount(value, series.currency)}`}</title></circle>)}
      </g>)}
      {data.periods.map((period, index) => <text key={period} x={pointX(index, data.periods.length)} y={CHART_HEIGHT - 12} textAnchor="middle" className="finance-salary-chart__label">{period}</text>)}
    </svg></div>}
  </article>
}
