import { useState } from 'react'
import type { RoutineDashboard, RoutineMutation } from '../types/routineTypes'

const ALL_ROUTINES = 'all'

interface RoutineWeekSectionProps {
  dashboard: RoutineDashboard
  disabled: boolean
  onMutate: (mutation: RoutineMutation) => Promise<unknown>
  onError: (message: string) => void
}

export function RoutineWeekSection({ dashboard, disabled, onMutate, onError }: RoutineWeekSectionProps) {
  const [selectedId, setSelectedId] = useState<string>(ALL_ROUTINES)
  const routines = dashboard.routines
  const activeId = selectedId === ALL_ROUTINES || routines.some((routine) => routine.id === selectedId) ? selectedId : ALL_ROUTINES
  const showingAll = activeId === ALL_ROUTINES
  const week = showingAll
    ? dashboard.currentWeek.all
    : dashboard.currentWeek.routines.find((entry) => entry.routineId === activeId)
  const routineById = new Map(routines.map((routine) => [routine.id, routine]))

  const toggle = async (taskId: string, date: string, completed: boolean) => {
    try {
      await onMutate({ type: 'setCompletion', taskId, date, completed })
    } catch (reason) {
      onError((reason as Error).message)
    }
  }

  return (
    <>
      <div className="routine-tabs" role="tablist" aria-label="Rutina de la semana">
        <button
          type="button"
          role="tab"
          className="routine-tab"
          data-accent="teal"
          aria-selected={showingAll}
          onClick={() => setSelectedId(ALL_ROUTINES)}
        >
          Todos
        </button>
        {routines.map((routine) => (
          <button
            key={routine.id}
            type="button"
            role="tab"
            className="routine-tab"
            data-accent={routine.accent}
            aria-selected={routine.id === activeId}
            onClick={() => setSelectedId(routine.id)}
          >
            {routine.name}
          </button>
        ))}
      </div>
      <div className="routine-week-summary">
        <div className="routine-progress"><div className="routine-progress__fill" style={{ width: `${week?.pct ?? 0}%` }} /></div>
        <span className="routine-week-summary__pct">{week?.pct === null || week?.pct === undefined ? '—' : `${week.pct}%`}</span>
      </div>
      <div className="routine-days" role="tabpanel">
        {week?.days.map((day) => (
          <section
            key={day.date}
            className={`routine-day${day.isToday ? ' routine-day--today' : ''}${day.isWeekend ? ' routine-day--weekend' : ''}`}
            aria-label={`${day.dayName} ${day.dateLabel}`}
          >
            <header className="routine-day__head">
              <div>
                <div className="routine-day__name">{day.dayName}</div>
                <div className="routine-day__date">{day.dateLabel}</div>
              </div>
              <div className="routine-ring" style={{ ['--routine-ring-pct' as string]: `${day.pct ?? 0}%` }} data-empty={day.total === 0}>
                {day.total > 0 ? <span>{day.done}/{day.total}</span> : null}
              </div>
            </header>
            {day.tasks.length === 0 ? <p className="routine-day__empty">Sin tareas</p> : null}
            {day.tasks.map((task) => {
              const routine = routineById.get(task.routineId)
              return (
                <label key={task.taskId} className={`routine-check${task.completed ? ' routine-check--done' : ''}`}>
                  <input
                    type="checkbox"
                    checked={task.completed}
                    disabled={disabled || !day.isEditable}
                    onChange={(event) => void toggle(task.taskId, day.date, event.target.checked)}
                  />
                  <span className="routine-check__text">
                    <span>{task.name}</span>
                    {showingAll && routine ? (
                      <span className="routine-check__routine" data-accent={routine.accent}>{routine.name}</span>
                    ) : null}
                  </span>
                </label>
              )
            })}
          </section>
        ))}
      </div>
    </>
  )
}
