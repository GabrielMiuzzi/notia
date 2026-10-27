import type { TaskPersonChip } from '../../types/taskBoardTypes'
import type { TimeSummary } from '../card/taskDisplay'

/** Avatars of the people of a task, overlapped, up to three. */
export function PersonStack({ people, size }: { people: TaskPersonChip[]; size: number }) {
  return (
    <span className="tmp-avatars">
      {people.slice(0, 3).map((person) => (
        <span
          key={person.name}
          className="tmp-avatar"
          title={person.name}
          style={{ width: size, height: size, ['--tmp-person' as string]: person.color }}
        >
          {person.initials}
        </span>
      ))}
    </span>
  )
}

/** The time ring of a card or a row: dedicated over estimated, «–» without an estimate. */
export function TimeRing({ time, size, label = true }: { time: TimeSummary; size: number; label?: boolean }) {
  const stroke = size >= 32 ? 3 : 2.6
  const radius = size / 2 - stroke - 1
  const circumference = 2 * Math.PI * radius
  const offset = time.hasEstimate ? circumference * (1 - Math.min(1, time.ratio)) : circumference
  const tip = time.hasEstimate ? `${time.spentLabel} de ${time.estimateLabel}` : 'Sin estimar'
  return (
    <span className={`tmp-ring${time.over ? ' is-over' : ''}${time.hasEstimate ? '' : ' is-unestimated'}`} title={tip} style={{ width: size, height: size }}>
      <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="tmp-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <circle
          className="tmp-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference.toFixed(2)}
          strokeDashoffset={offset.toFixed(2)}
          style={{ opacity: time.ringVisible ? 1 : 0 }}
        />
      </svg>
      {label ? <span className="tmp-ring-text">{time.percentText}</span> : null}
    </span>
  )
}
