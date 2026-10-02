import type { ColdPassHealth } from '../../../../types/coldpass'
import { HEALTH_LABELS } from './coldPassFormat'

/** The health of a password, as the backend decided it. */
export function ColdPassHealthChip({ health }: { health: ColdPassHealth }) {
  return (
    <span className="cp-health" data-health={health}>
      <span className="cp-health__dot" aria-hidden="true" />
      {HEALTH_LABELS[health]}
    </span>
  )
}
