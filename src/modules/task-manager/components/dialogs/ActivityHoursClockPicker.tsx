import { useMemo } from 'react'
import { NotiaButton } from '../../../../components/common/NotiaButton'

interface ActivityHoursClockPickerProps {
  value: number
  onChange: (value: number) => void
}

const PRIMARY_HOURS = Array.from({ length: 12 }, (_, index) => index * 2)
const INTERMEDIATE_HOURS = Array.from({ length: 12 }, (_, index) => (index * 2) + 1)

export function ActivityHoursClockPicker({ value, onChange }: ActivityHoursClockPickerProps) {
  const selectedValue = Number.isFinite(value) ? Math.max(0, Math.min(24, Math.round(value))) : 24
  const dialHour = selectedValue === 24 ? 0 : selectedValue
  const handRotation = useMemo(() => ((dialHour / 24) * 360) - 90, [dialHour])

  return (
    <div className="tareas-activity-clock" aria-label="Selector de horas de actividad por dia">
      <div className="tareas-activity-clock-hand-wrap">
        <div className="tareas-activity-clock-hand" style={{ transform: `rotate(${handRotation}deg)` }} />
      </div>

      {PRIMARY_HOURS.map((hour) => {
        const angle = ((hour / 24) * 360) - 90
        const { x, y } = resolveRingPosition(angle, 95)
        const isSelected = hour === 0 ? (selectedValue === 0 || selectedValue === 24) : selectedValue === hour

        return (
          <NotiaButton
            key={`activity-hour-primary-${hour}`}
            className={`tareas-activity-clock-hour is-primary${isSelected ? ' is-selected' : ''}`}
            style={{ transform: `translate(${x}px, ${y}px)` }}
            onClick={() => {
              if (hour === 0) {
                onChange(selectedValue === 0 ? 24 : 0)
                return
              }
              onChange(hour)
            }}
            title={hour === 0 ? '0h / 24h' : `${hour}h`}
            aria-label={hour === 0 ? '0 horas o 24 horas' : `${hour} horas`}
          >
            {hour === 0 ? '0' : hour}
          </NotiaButton>
        )
      })}

      {INTERMEDIATE_HOURS.map((hour) => {
        const angle = ((hour / 24) * 360) - 90
        const { x, y } = resolveRingPosition(angle, 95)
        const isSelected = selectedValue === hour

        return (
          <div key={`activity-hour-mid-${hour}`}>
            <div
              className={`tareas-activity-clock-mark${isSelected ? ' is-selected' : ''}`}
              style={{ transform: `translate(${x}px, ${y}px) rotate(${angle + 90}deg)` }}
            />
            <NotiaButton
              className={`tareas-activity-clock-hour is-intermediate-hit${isSelected ? ' is-selected' : ''}`}
              style={{ transform: `translate(${x}px, ${y}px)` }}
              onClick={() => onChange(hour)}
              title={`${hour}h`}
              aria-label={`${hour} horas`}
            >
              <span className="tareas-activity-clock-hit-dot" />
            </NotiaButton>
          </div>
        )
      })}

      <div className="tareas-activity-clock-center">{selectedValue}h</div>
    </div>
  )
}

function resolveRingPosition(angle: number, radius: number): { x: number; y: number } {
  return {
    x: Math.cos((angle * Math.PI) / 180) * radius,
    y: Math.sin((angle * Math.PI) / 180) * radius,
  }
}
