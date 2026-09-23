import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { RoutineDashboard, RoutineMutation } from '../types/routineTypes'

const DAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function Legend({ currentFirst = true }: { currentFirst?: boolean }) {
  const current = <span className="routine-legend__item"><i className="routine-legend__swatch" />Este mes</span>
  const previous = <span className="routine-legend__item"><i className="routine-legend__swatch routine-legend__swatch--dashed" />Mes pasado</span>
  return <div className="routine-legend">{currentFirst ? <>{current}{previous}</> : <>{previous}{current}</>}</div>
}

export function RoutineHeatmap({ heatmap }: { heatmap: RoutineDashboard['heatmap'] }) {
  if (heatmap.rows.length === 0) return <p className="routine-empty">Agregá tareas para ver tu racha del mes.</p>
  const days = Array.from({ length: heatmap.daysInMonth }, (_, index) => index + 1)
  return (
    <div className="routine-scroll-x">
      <table className="routine-heatmap">
        <caption className="routine-visually-hidden">Cumplimiento diario de cada tarea este mes</caption>
        <thead>
          <tr>
            <th scope="col"><span className="routine-visually-hidden">Tarea</span></th>
            {days.map((day) => <th key={day} scope="col" className="routine-heatmap__day">{day === 1 || day % 5 === 0 ? day : ''}</th>)}
          </tr>
        </thead>
        <tbody>
          {heatmap.rows.map((row) => (
            <tr key={row.taskId}>
              <th scope="row" className="routine-heatmap__label">
                <span className="routine-dot" data-color={row.color} aria-hidden="true" />
                <span className="routine-heatmap__name">{row.name}</span>
                {row.streak > 0 ? <span className="routine-heatmap__streak" aria-label={`racha de ${row.streak} días`}>🔥{row.streak}</span> : null}
              </th>
              {row.cells.map((cell) => (
                <td key={cell.day}>
                  <span
                    className={`routine-heatmap__cell routine-heatmap__cell--${cell.state}${cell.isToday ? ' routine-heatmap__cell--today' : ''}`}
                    data-color={row.color}
                    title={`Día ${cell.day}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function RoutineCalendar({ calendar }: { calendar: RoutineDashboard['calendar'] }) {
  return (
    <>
      <div className="routine-calendar" role="grid" aria-label="Cumplimiento por día del mes">
        {DAY_SHORT.map((label) => <span key={label} className="routine-calendar__dow" role="columnheader">{label}</span>)}
        {Array.from({ length: calendar.leadingBlanks }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
        {calendar.days.map((day) => (
          <div
            key={day.day}
            role="gridcell"
            className={`routine-calendar__cell${day.isToday ? ' routine-calendar__cell--today' : ''}`}
            data-level={day.level ?? undefined}
            aria-label={day.pct === null ? `Día ${day.day}` : `Día ${day.day}: ${day.pct}%`}
          >
            <span className="routine-calendar__num">{day.day}</span>
            {day.pct !== null ? <span className="routine-calendar__pct">{day.pct}%</span> : null}
          </div>
        ))}
      </div>
      <div className="routine-calendar-legend" aria-hidden="true">
        <span>Menos</span>
        {[1, 2, 3, 4, 5].map((level) => <i key={level} data-level={level} />)}
        <span>Más</span>
      </div>
    </>
  )
}

export function RoutineEvolution({ evolution, hasTasks }: { evolution: RoutineDashboard['evolution']; hasTasks: boolean }) {
  const gradientId = useId()
  if (!hasTasks) return <p className="routine-empty">Agregá tareas para ver la evolución del mes.</p>
  const { current, previous, bestDay } = evolution
  const padL = 30, padR = 14, padT = 14, padB = 22, perDay = 26, height = 150
  const points = Math.max(current.length, previous.length)
  const width = Math.max(560, padL + padR + (points - 1) * perDay)
  const chartW = width - padL - padR
  const chartH = height - padT - padB
  const stepX = points > 1 ? chartW / (points - 1) : 0
  const x = (index: number) => padL + index * stepX
  const y = (pct: number) => padT + chartH - (pct / 100) * chartH
  const polyline = (values: typeof current) => values.map((value, index) => `${x(index)},${y(value.pct)}`).join(' ')
  const area = current.length > 0
    ? `M ${x(0)} ${padT + chartH} L ${current.map((value, index) => `${x(index)} ${y(value.pct)}`).join(' L ')} L ${x(current.length - 1)} ${padT + chartH} Z`
    : ''

  return (
    <>
      <div className="routine-scroll-x">
        <svg className="routine-line-chart" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width }} role="img" aria-label="Porcentaje diario de la rutina, este mes y el mes pasado">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--routine-teal)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--routine-teal)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 50, 100].map((value) => (
            <g key={value}>
              <line x1={padL} y1={y(value)} x2={width - padR} y2={y(value)} className="routine-chart-grid" />
              <text x={padL - 8} y={y(value) + 3} textAnchor="end" className="routine-chart-label">{value}</text>
            </g>
          ))}
          {area ? <path d={area} fill={`url(#${gradientId})`} /> : null}
          <polyline points={polyline(previous)} className="routine-chart-previous" />
          <polyline points={polyline(current)} className="routine-chart-current" />
          {current.map((value, index) => {
            const isBest = bestDay?.day === value.day
            return <circle key={value.day} cx={x(index)} cy={y(value.pct)} r={isBest ? 4.5 : 3} className={isBest ? 'routine-chart-dot routine-chart-dot--best' : 'routine-chart-dot'} />
          })}
          {current.map((value, index) => (value.day === 1 || value.day % 5 === 0 || index === current.length - 1) ? (
            <text key={value.day} x={x(index)} y={height - 4} textAnchor="middle" className="routine-chart-label">{value.day}</text>
          ) : null)}
        </svg>
      </div>
      <Legend />
      <p className="routine-caption">
        {bestDay
          ? <>Tu mejor día fue el <b>{bestDay.day}</b>, con <b>{bestDay.pct}%</b> de la rutina completa.</>
          : 'Todavía no marcaste tareas este mes.'}
      </p>
    </>
  )
}

export function RoutineWeekly({ weekly, hasTasks }: { weekly: RoutineDashboard['weekly']; hasTasks: boolean }) {
  if (!hasTasks) return <p className="routine-empty">Agregá tareas a la rutina para ver el progreso semanal.</p>
  return (
    <>
      <div className="routine-stats">
        <div className="routine-stat"><strong>{weekly.bestStreak}</strong><span>mejor racha (días)</span></div>
        <div className="routine-stat"><strong>{weekly.monthDone}</strong><span>tareas completadas este mes</span></div>
        <div className="routine-stat"><strong>{weekly.monthPct === null ? '—' : `${weekly.monthPct}%`}</strong><span>completado del mes</span></div>
      </div>
      <div className="routine-bars" role="img" aria-label="Porcentaje completado por semana, este mes y el mes pasado">
        {weekly.weeks.map((week) => (
          <div key={week.label} className={`routine-bars__col${week.isCurrentWeek ? ' routine-bars__col--current' : ''}`}>
            <span className="routine-bars__pct">{week.currentPct === null ? '—' : `${week.currentPct}%`}</span>
            <div className="routine-bars__pair">
              <div className="routine-bars__track"><div className="routine-bars__fill routine-bars__fill--previous" style={{ height: `${week.previousPct ?? 0}%` }} /></div>
              <div className="routine-bars__track"><div className="routine-bars__fill" style={{ height: `${week.currentPct ?? 0}%` }} /></div>
            </div>
            <span className="routine-bars__label">{week.label}</span>
          </div>
        ))}
      </div>
      <Legend currentFirst={false} />
    </>
  )
}

function wheelPoint(cx: number, cy: number, radius: number, value: number, axis: number, total: number) {
  const angle = ((-90 + axis * (360 / total)) * Math.PI) / 180
  return { x: cx + Math.cos(angle) * (value / 10) * radius, y: cy + Math.sin(angle) * (value / 10) * radius }
}

function WheelSvg({ axes }: { axes: RoutineDashboard['wheel']['axes'] }) {
  const cx = 160, cy = 148, radius = 92, total = axes.length
  const polygon = (values: number[]) => values.map((value, index) => {
    const point = wheelPoint(cx, cy, radius, value, index, total)
    return `${point.x},${point.y}`
  }).join(' ')
  return (
    <svg className="routine-wheel" viewBox="0 0 320 300" role="img" aria-label="Rueda de la vida: puntaje de 0 a 10 por categoría, este mes y el mes pasado">
      {[2, 4, 6, 8, 10].map((level) => <polygon key={level} points={polygon(axes.map(() => level))} className="routine-chart-grid" fill="none" />)}
      {axes.map((axis, index) => {
        const end = wheelPoint(cx, cy, radius, 10, index, total)
        return <line key={axis.category} x1={cx} y1={cy} x2={end.x} y2={end.y} className="routine-chart-grid" />
      })}
      <polygon points={polygon(axes.map((axis) => axis.previous))} className="routine-chart-previous" fill="none" />
      <polygon points={polygon(axes.map((axis) => axis.current))} className="routine-wheel__current" />
      {axes.map((axis, index) => {
        const point = wheelPoint(cx, cy, radius, axis.current, index, total)
        return <circle key={axis.category} cx={point.x} cy={point.y} r={3.5} className="routine-chart-dot" />
      })}
      {axes.map((axis, index) => {
        const point = wheelPoint(cx, cy, radius + 26, 10, index, total)
        const unitX = Math.cos(((-90 + index * (360 / total)) * Math.PI) / 180)
        const anchor = unitX > 0.35 ? 'start' : unitX < -0.35 ? 'end' : 'middle'
        const [first, second] = axis.category.includes(' y ') ? axis.category.split(' y ') : [axis.category, '']
        return (
          <text key={axis.category} x={point.x} y={second ? point.y - 5 : point.y} textAnchor={anchor} className="routine-chart-label routine-wheel__label">
            <tspan x={point.x} dy="0">{first}</tspan>
            {second ? <tspan x={point.x} dy="11">y {second}</tspan> : null}
          </text>
        )
      })}
    </svg>
  )
}

function GoalInput({ category, goal, disabled, onCommit }: { category: string; goal: number; disabled: boolean; onCommit: (goal: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const value = Number(draft)
    setDraft(null)
    if (Number.isInteger(value) && value !== goal) onCommit(value)
  }
  return (
    <input
      className="routine-goal-input"
      type="number"
      inputMode="numeric"
      min={1}
      max={10}
      value={draft ?? String(goal)}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      aria-label={`Meta de ${category} (1 a 10)`}
    />
  )
}

export function RoutineLifeWheel({ wheel, disabled, onMutate, onError }: {
  wheel: RoutineDashboard['wheel']
  disabled: boolean
  onMutate: (mutation: RoutineMutation) => Promise<unknown>
  onError: (message: string) => void
}) {
  const [goalsOpen, setGoalsOpen] = useState(true)
  const goalsId = useId()
  const setGoal = async (category: string, goal: number) => {
    try {
      await onMutate({ type: 'setGoal', category, goal })
    } catch (reason) {
      onError((reason as Error).message)
    }
  }
  return (
    <>
      <div className="routine-wheel-wrap"><WheelSvg axes={wheel.axes} /></div>
      <Legend />
      <button type="button" className="routine-goals-toggle" aria-expanded={goalsOpen} aria-controls={goalsId} onClick={() => setGoalsOpen((open) => !open)}>
        <span>Metas por categoría</span>
        <ChevronDown size={16} className={goalsOpen ? '' : 'routine-goals-toggle__icon--collapsed'} />
      </button>
      <div id={goalsId} className="routine-goals" hidden={!goalsOpen}>
        {wheel.axes.map((axis) => (
          <div key={axis.category} className="routine-goal">
            <span className="routine-goal__name">{axis.category} · {axis.current}/10</span>
            <div className="routine-goal__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={axis.goalPct} aria-label={`Avance hacia la meta de ${axis.category}`}>
              <div className="routine-goal__fill" style={{ width: `${axis.goalPct}%` }} />
            </div>
            <GoalInput category={axis.category} goal={axis.goal} disabled={disabled} onCommit={(goal) => void setGoal(axis.category, goal)} />
          </div>
        ))}
      </div>
    </>
  )
}
