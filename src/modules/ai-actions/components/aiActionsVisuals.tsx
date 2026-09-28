import type { AiActionKind, StatusChip } from '../types/aiActionsTypes'
import { KIND_VISUALS } from './aiActionsKinds'

export function StatusBadge({ status }: { status: StatusChip }) {
  return (
    <span className="aia-chip" data-tone={status.tone}>
      <span className="aia-chip__dot" aria-hidden="true" />
      {status.label}
    </span>
  )
}

export function KindMark({ kind }: { kind: AiActionKind }) {
  return <span className="aia-kind-mark" data-accent={KIND_VISUALS[kind].accent} aria-hidden="true" />
}
