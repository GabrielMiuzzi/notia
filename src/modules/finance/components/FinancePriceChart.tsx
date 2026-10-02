import { formatAmount, formatShortDate } from '../engines/financeFormat'
import type { ProductDetail } from '../types/financeScreen'

const CHART_WIDTH = 840
const CHART_LABELS = 6

interface Props {
  detail: ProductDetail
  /** Height of the plot in pixels: 200 on the wide layout, 150 on a phone. */
  height?: number
  /** Phone board: the legend under the title and no price scale. */
  phone?: boolean
}

/** Price of the product at each merchant over time. */
export function FinancePriceChart({ detail, height = 200, phone = false }: Props) {
  const points = detail.series.flatMap((series) => series.points)
  const times = points.map((point) => Date.parse(point.date))
  const prices = points.map((point) => Number(point.price))
  const [first, last] = [Math.min(...times), Math.max(...times)]
  const low = Math.min(...prices) * 0.97
  const high = Math.max(...prices) * 1.03
  const x = (date: string) => 12 + (last === first ? 0.5 : (Date.parse(date) - first) / (last - first)) * (CHART_WIDTH - 24)
  const y = (price: string) => height - ((Number(price) - low) / (high - low || 1)) * (height - 20) - 10
  const dates = [...new Set(points.map((point) => point.date))].sort()
  const labels = dates.length <= CHART_LABELS ? dates : Array.from({ length: CHART_LABELS }, (_, index) => dates[Math.round((index * (dates.length - 1)) / (CHART_LABELS - 1))])
  return <div className={`finance-price-chart${phone ? ' finance-price-chart--phone' : ''}`}>
    <div className="finance-split-row">
      <h3>Precio por comercio</h3>
      <div className="finance-price-chart__legend">{detail.series.map((series, index) => <span key={series.merchant}><i className={`finance-swatch finance-swatch--round finance-series--${index % 6}`} aria-hidden="true" />{series.merchant}</span>)}</div>
    </div>
    <div className="finance-price-chart__plot" style={{ height }}>
      {phone ? null : <>
        <span className="finance-price-chart__y finance-price-chart__y--top">{formatAmount(high, detail.currency, 0)}</span>
        <span className="finance-price-chart__y finance-price-chart__y--bottom">{formatAmount(low, detail.currency, 0)}</span>
      </>}
      <svg viewBox={`0 0 ${CHART_WIDTH} ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={detail.series.map((series) => `${series.merchant}: ${series.points.map((point) => `${formatShortDate(point.date)} ${formatAmount(point.price, detail.currency, 0)}`).join(', ')}`).join('; ')}>
        {phone ? null : <>
          <line x1="0" x2={CHART_WIDTH} y1="1" y2="1" className="finance-price-chart__grid" />
          <line x1="0" x2={CHART_WIDTH} y1={height / 2} y2={height / 2} className="finance-price-chart__grid" />
        </>}
        {detail.series.map((series, index) => <polyline key={series.merchant} points={series.points.map((point) => `${x(point.date).toFixed(1)},${y(point.price).toFixed(1)}`).join(' ')} className={`finance-price-chart__line finance-series--${index % 6}`} />)}
      </svg>
      {/* Dots are HTML so they stay round when the plot stretches. */}
      {detail.series.flatMap((series, index) => series.points.map((point, pointIndex) => <span
        key={`${series.merchant}-${pointIndex}`}
        className={`finance-price-chart__dot finance-series--${index % 6}`}
        style={{ left: `${(x(point.date) / CHART_WIDTH) * 100}%`, top: `${y(point.price)}px` }}
        title={`${series.merchant} · ${formatShortDate(point.date)} · ${formatAmount(point.price, detail.currency, 0)}`}
      />))}
    </div>
    <div className="finance-split-row finance-card__sub finance-small">{labels.map((date) => <span key={date}>{formatShortDate(date)}</span>)}</div>
  </div>
}
