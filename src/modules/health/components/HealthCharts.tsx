import { useState } from 'react'
import type { RangeBar, WeightChart } from '../types/healthTypes'

/** Barra de rangos (IMC y composición): Rust da los tramos y las marcas. */
export function RangeBarView({ bar, height = 6 }: { bar: RangeBar; height?: number }) {
  return (
    <div className={`hl-range${bar.ticks.length ? ' hl-range--ticks' : ''}`} style={{ ['--hl-bar' as string]: `${height}px` }}>
      <div className="hl-range__track">
        {bar.segments.map((segment) => (
          <div key={segment.label} className="hl-range__segment" data-tone={segment.tone} data-active={segment.active} title={segment.label} style={{ flex: `${segment.flex} 1 0` }} />
        ))}
      </div>
      {bar.markers.map((marker) => (
        <span key={marker.kind} className="hl-range__marker" data-kind={marker.kind} aria-hidden="true" style={{ left: `${marker.position}%` }} />
      ))}
      {bar.ticks.map((tick) => (
        <span key={tick.label} className="hl-range__tick" style={{ left: `${tick.position}%` }}>{tick.label}</span>
      ))}
    </div>
  )
}

/**
 * Gráfico del peso. Rust manda los puntos ya ubicados (0 a 1); las líneas se
 * estiran con el panel y los textos quedan en HTML para que no se deformen.
 * Tocar o enfocar un punto muestra su valor.
 */
export function WeightChartView({ chart }: { chart: WeightChart }) {
  const [active, setActive] = useState<number | null>(null)
  const line = chart.points.map((point) => `${(point.x * 100).toFixed(2)},${((1 - point.y) * 100).toFixed(2)}`).join(' ')
  const shown = active === null ? null : chart.points[active]
  return (
    <div className="hl-chart">
      <div className="hl-chart__y" aria-hidden="true">
        {chart.yTicks.map((tick) => <span key={tick.label} style={{ bottom: `${tick.at * 100}%` }}>{tick.label}</span>)}
      </div>
      <div className="hl-chart__plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {chart.yTicks.map((tick) => <line key={tick.label} className="hl-chart__grid" x1="0" x2="100" y1={(1 - tick.at) * 100} y2={(1 - tick.at) * 100} vectorEffect="non-scaling-stroke" />)}
          {chart.goal && <line className="hl-chart__goal" x1="0" x2="100" y1={(1 - chart.goal.at) * 100} y2={(1 - chart.goal.at) * 100} vectorEffect="non-scaling-stroke" />}
          <polyline className="hl-chart__line" points={line} vectorEffect="non-scaling-stroke" />
        </svg>
        {chart.goal && <span className="hl-chart__goal-label" style={{ bottom: `${chart.goal.at * 100}%` }}>{chart.goal.label}</span>}
        {chart.points.map((point, index) => (
          <button
            key={`${point.label}-${index}`}
            type="button"
            className="hl-chart__point"
            data-active={active === index}
            style={{ left: `${point.x * 100}%`, bottom: `${point.y * 100}%` }}
            aria-label={`${point.label}: ${point.valueLabel}`}
            onFocus={() => setActive(index)}
            onBlur={() => setActive((current) => (current === index ? null : current))}
            onPointerEnter={() => setActive(index)}
            onPointerLeave={(event) => { if (event.pointerType === 'mouse') setActive(null) }}
            onClick={() => setActive(index)}
          />
        ))}
        {shown && (
          <div className="hl-chart__tip" role="status" style={{ left: `${shown.x * 100}%`, bottom: `${shown.y * 100}%` }}>
            <span>{shown.label}</span>
            <strong>{shown.valueLabel}</strong>
          </div>
        )}
      </div>
      <div className="hl-chart__x" aria-hidden="true">
        {chart.xTicks.map((tick) => <span key={`${tick.label}-${tick.at}`} style={{ left: `${tick.at * 100}%` }}>{tick.label}</span>)}
      </div>
    </div>
  )
}
