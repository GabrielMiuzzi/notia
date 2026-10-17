import { RING_CIRCUMFERENCE, type TimeSummary } from './taskDisplay'

interface TimeRingProps {
  summary: TimeSummary
  /** Delay of the fill animation, with the card's entry. */
  delayMs?: number
}

/** Dedicated over estimated: teal fill, coral when over, dashed «–» without an estimate. */
export function TimeRing({ summary, delayMs = 0 }: TimeRingProps) {
  const tone = summary.over ? ' is-over' : summary.hasEstimate ? ' is-estimated' : ''
  return (
    <span className={`tm-ring${tone}`} aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 28 28">
        <circle className={`tm-ring-track${summary.hasEstimate ? '' : ' is-dashed'}`} cx="14" cy="14" r="11" />
        <circle
          className="tm-ring-fill"
          cx="14"
          cy="14"
          r="11"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={summary.ringOffset.toFixed(2)}
          style={{ opacity: summary.ringVisible ? 1 : 0, animationDelay: `${delayMs}ms` }}
        />
      </svg>
      <span className="tm-ring-label">{summary.percentText}</span>
    </span>
  )
}
