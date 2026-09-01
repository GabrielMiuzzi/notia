import { buildDebtRatioChartData } from '../engines/debtRatioEvolutionChartEngine'
import type { FinanceDebtRatioHistoryPoint } from '../types/financeTypes'

interface DebtRatioEvolutionChartProps {
  history: FinanceDebtRatioHistoryPoint[]
}

const CHART_WIDTH = 960
const CHART_HEIGHT = 140
const CHART_PADDING = { top: 20, right: 24, bottom: 30, left: 58 }

function linePath(values: Array<number | null>, maximum: number): string {
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

export function DebtRatioEvolutionChart({ history }: DebtRatioEvolutionChartProps) {
  const data = buildDebtRatioChartData(history)
  const maximum = Math.max(1, ...data.series.flatMap((series) => series.values.filter((value): value is number => value !== null)))
  const chartBottom = CHART_HEIGHT - CHART_PADDING.bottom
  const chartWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right

  return <article className="finance-card finance-credit-card-chart-card" aria-labelledby="finance-debt-ratio-chart-title">
    <div className="finance-section-heading">
      <div>
        <h3 id="finance-debt-ratio-chart-title">Deuda respecto del sueldo</h3>
        <p className="finance-muted">Porcentaje histórico de tarjetas y deudas registradas sobre el sueldo de cada período.</p>
      </div>
      {data.series.length > 1 && <div className="finance-card-chart-legend" aria-label="Monedas incluidas">{data.series.map((series, index) => <span key={series.currency}><i className={`finance-card-chart__line--${index % 4}`} />{series.currency}</span>)}</div>}
    </div>
    {data.series.length === 0 ? <p className="finance-muted">Cargá sueldos y deudas para ver su evolución.</p> : <div className="finance-chart-scroll"><svg className="finance-credit-card-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label="Histórico del porcentaje de deuda respecto del sueldo">
      <line x1={CHART_PADDING.left} y1={chartBottom} x2={CHART_WIDTH - CHART_PADDING.right} y2={chartBottom} className="finance-salary-chart__axis" />
      <line x1={CHART_PADDING.left} y1={CHART_PADDING.top} x2={CHART_PADDING.left} y2={chartBottom} className="finance-salary-chart__axis" />
      <text x={CHART_PADDING.left} y="16" className="finance-salary-chart__label">{maximum.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%</text>
      {data.series.map((series, index) => <path key={series.currency} d={linePath(series.values, maximum)} className={`finance-credit-card-chart__line finance-card-chart__line--${index % 4}`} />)}
      {data.periods.map((period, index) => {
        const x = CHART_PADDING.left + (data.periods.length === 1 ? chartWidth / 2 : (chartWidth * index) / (data.periods.length - 1))
        return <text key={period} x={x} y={CHART_HEIGHT - 12} textAnchor="middle" className="finance-salary-chart__label">{period}</text>
      })}
    </svg></div>}
  </article>
}
