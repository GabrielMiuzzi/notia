import { useId, useState, type CSSProperties } from 'react'
import { Flame, Layers } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { HomeCard, HomeHabit, HomeRoutine } from '../../../../services/home/homeTypes'
import { applyRoutineMutation, routineErrorMessage } from '../../../../modules/routine/services/routineService'
import { HomeCardShell, HomeMoreButton } from './HomeCardShell'
import { countLabel, percentLabel } from './homeDisplay'

interface HomeRoutineCardProps {
  card: HomeCard<HomeRoutine>
  library: NotiaLibrary
  onOpenRoutine: () => void
  /** Reads the dashboard again after a habit changed. */
  onChanged: () => Promise<void>
}

/** Today's habits of each routine and how the week and the month went. */
export function HomeRoutineCard({ card, library, onOpenRoutine, onChanged }: HomeRoutineCardProps) {
  const routine = card.data
  const baseId = useId()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingHabitId, setPendingHabitId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const groups = routine?.routines ?? []
  const selected = groups.find((group) => group.id === selectedId) ?? groups[0] ?? null

  const toggleHabit = async (habit: HomeHabit) => {
    if (!routine || pendingHabitId) return
    setPendingHabitId(habit.id)
    setError(null)
    try {
      await applyRoutineMutation(library, { type: 'setCompletion', taskId: habit.id, date: routine.today, completed: !habit.done })
      await onChanged()
    } catch (reason) {
      setError(routineErrorMessage(reason))
    } finally {
      setPendingHabitId(null)
    }
  }

  return (
    <HomeCardShell
      id="home-routine-title"
      title="Rutinas"
      icon={<Layers size={15} strokeWidth={1.75} />}
      className="home-card--routine"
      error={card.error}
      action={(
        <div className="home-card__actions">
          {routine ? (
            <span className="home-card__sub home-routine__month">
              <b className="home-accent">{percentLabel(routine.monthPct)}</b> completado en {routine.monthLabel}
            </span>
          ) : null}
          <HomeMoreButton label="Abrir" ariaLabel="Abrir Rutinas" onClick={onOpenRoutine} />
        </div>
      )}
    >
      {routine ? (
        <>
          <div className="home-week">
            <div className="home-week__days">
              {routine.week.map((day) => (
                <div
                  key={day.label}
                  role="img"
                  aria-label={day.label}
                  title={day.label}
                  className={`home-wday${day.isToday ? ' home-wday--today' : ''}${day.isFuture ? ' home-wday--future' : ''}`}
                >
                  <span className="home-ring" style={{ '--home-ring-pct': `${day.pct ?? 0}%` } as CSSProperties}>
                    <span className="home-mono">{day.done}/{day.total}</span>
                  </span>
                  <span className="home-wday__letter">{day.letter}</span>
                </div>
              ))}
            </div>
            <div className="home-week__divider" />
            <div className="home-week__summary">
              <div className="home-week__row">
                <span className="home-card__sub">Semana</span>
                <span className="home-mono home-week__pct">{percentLabel(routine.weekPct)}</span>
              </div>
              <div className="home-bar"><div className="home-bar__fill" style={{ width: `${routine.weekPct ?? 0}%` }} /></div>
              <div className="home-card__sub">Mejor racha <b className="home-strong">{countLabel(routine.bestStreak, 'día', 'días')}</b></div>
            </div>
          </div>
          {groups.length === 0 ? (
            <p className="home-empty">Todavía no armaste rutinas. Creálas desde Rutina.</p>
          ) : (
            <>
              <div className="home-rtabs" role="group" aria-label="Rutinas">
                {groups.map((group) => {
                  const isSelected = group.id === selected?.id
                  return (
                    <button
                      key={group.id}
                      type="button"
                      className={`home-rtab${isSelected ? ' home-rtab--selected' : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedId(group.id)}
                    >
                      <span>{group.name}</span>
                      <span className="home-mono home-rtab__count">{group.done}/{group.total}</span>
                    </button>
                  )
                })}
              </div>
              {error ? <p className="home-card__error" role="alert">{error}</p> : null}
              <div className="home-scroll home-checklist home-checklist--habits">
                {selected && selected.habits.length === 0 ? <p className="home-empty">Esta rutina no tiene hábitos para hoy.</p> : null}
                {selected?.habits.map((habit, index) => {
                  const inputId = `${baseId}-habit-${index}`
                  return (
                    <div key={habit.id} className="home-check-row">
                      <input
                        type="checkbox"
                        id={inputId}
                        checked={habit.done}
                        disabled={pendingHabitId !== null}
                        onChange={() => void toggleHabit(habit)}
                      />
                      <label htmlFor={inputId} className={`home-habit${habit.done ? ' is-done' : ''}`}>
                        <span>{habit.name}</span>
                        {habit.category ? <span className="home-habit__meta">{habit.category}</span> : null}
                      </label>
                      <span className={`home-streak${habit.streak > 0 ? '' : ' home-streak--off'}`} title="Racha actual">
                        <Flame size={12} strokeWidth={2} aria-hidden="true" />
                        {habit.streak > 0 ? `${habit.streak} d` : 'sin racha'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      ) : null}
    </HomeCardShell>
  )
}
