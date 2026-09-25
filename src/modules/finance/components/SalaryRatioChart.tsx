import type { FinanceDebtRatioSeries } from '../services/financeService'

interface SalaryRatioChartProps {
  id: string
  title: string
  description: string
  emptyText: string
  /** Monthly amount over the salary that paid it, computed by the backend. */
  data: FinanceDebtRatioSeries
}

const CHART_WIDTH = 960
const CHART_HEIGHT = 140
const CHART_PADDING = { top: 20, right: 24, bottom: 30, left: 58 }

function pointX(index: number, count: number): number {
  const width = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
  return CHART_PADDING.left + (count === 1 ? width / 2 : (width * index) / (count - 1))
}

function pointY(value: number, maximum: number): number {
  const height = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
  return CHART_PADDING.top + height - (value / maximum) * height
}

function linePath(values: Array<number | null>, maximum: number): string {
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

function percent(value: number): string {
  return `${value.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`
}

/** Percentage of the salary that went to something (cards, services) per month. */
export function SalaryRatioChart({ id, title, description, emptyText, data }: SalaryRatioChartProps) {
  const maximum = Math.max(1, ...data.series.flatMap((series) => series.values.filter((value): value is number => value !== null)))
  const chartBottom = CHART_HEIGHT - CHART_PADDING.bottom
  const titleId = `finance-${id}-chart-title`

  return <article className="finance-card finance-credit-card-chart-card" aria-labelledby={titleId}>
    <div className="finance-section-heading">
      <div>
        <h3 id={titleId}>{title}</h3>
        <p className="finance-muted">{description}</p>
      </div>
      {data.series.length > 1 && <div className="finance-card-chart-legend" aria-label="Monedas incluidas">{data.series.map((series, index) => <span key={series.currency}><i className={`finance-card-chart__line--${index % 4}`} />{series.currency}</span>)}</div>}
    </div>
    {data.series.length === 0 ? <p className="finance-muted">{emptyText}</p> : <div className="finance-chart-scroll"><svg className="finance-credit-card-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={`${title}: ${data.series.map((series) => `${series.currency} ${series.values.map((value, index) => value === null ? null : `${data.periods[index]} ${percent(value)}`).filter(Boolean).join(', ')}`).join('; ')}`}>
      <line x1={CHART_PADDING.left} y1={chartBottom} x2={CHART_WIDTH - CHART_PADDING.right} y2={chartBottom} className="finance-salary-chart__axis" />
      <line x1={CHART_PADDING.left} y1={CHART_PADDING.top} x2={CHART_PADDING.left} y2={chartBottom} className="finance-salary-chart__axis" />
      <text x={CHART_PADDING.left} y="16" className="finance-salary-chart__label">{percent(maximum)}</text>
      {data.series.map((series, index) => <g key={series.currency}>
        <path d={linePath(series.values, maximum)} className={`finance-credit-card-chart__line finance-card-chart__line--${index % 4}`} />
        {series.values.map((value, pointIndex) => value === null ? null : <circle key={data.periods[pointIndex]} cx={pointX(pointIndex, series.values.length)} cy={pointY(value, maximum)} r="4" className={`finance-chart-point finance-card-chart__line--${index % 4}`}><title>{`${data.periods[pointIndex]}: ${percent(value)}`}</title></circle>)}
      </g>)}
      {data.periods.map((period, index) => <text key={period} x={pointX(index, data.periods.length)} y={CHART_HEIGHT - 12} textAnchor="middle" className="finance-salary-chart__label">{period}</text>)}
    </svg></div>}
  </article>
}
