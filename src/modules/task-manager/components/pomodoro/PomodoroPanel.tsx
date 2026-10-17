import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject, ReactNode } from 'react'
import {
  formatPomodoroCountdown,
  getPhaseDurationSeconds,
  getPomodoroPhaseLabel,
  getPomodoroRemainingSeconds,
} from '../../utils/pomodoroDisplay'
import type { PomodoroAction, PomodoroPreset, PomodoroToday } from '../../services/taskManagerService'
import type { Board, PomodoroDurations, PomodoroPhase, PomodoroState, TaskItem } from '../../types/taskManagerTypes'
import '../../styles/taskManagerTokens.css'
import '../../styles/taskPomodoro.css'

export interface PomodoroPanelProps {
  state: PomodoroState
  presets: PomodoroPreset[]
  today: PomodoroToday | null
  boards: Board[]
  /** Open tasks of every board (root tasks and subtasks) from the snapshot. */
  tasks: TaskItem[]
  onAction: (action: PomodoroAction) => Promise<void>
  onNotify: (message: string | null) => void
}

const PHASES: PomodoroPhase[] = ['work', 'short-break', 'long-break']
const RING_RADIUS = 130
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

/** Stepper limits of the design; Rust clamps the values again. */
const STEPPERS: Array<{ key: keyof PomodoroDurations; label: string; step: number; min: number; max: number; unit: string }> = [
  { key: 'workMinutes', label: 'Trabajo', step: 5, min: 5, max: 90, unit: 'min' },
  { key: 'shortBreakMinutes', label: 'Descanso corto', step: 1, min: 1, max: 30, unit: 'min' },
  { key: 'longBreakMinutes', label: 'Descanso largo', step: 5, min: 5, max: 60, unit: 'min' },
  { key: 'cycles', label: 'Ciclos', step: 1, min: 2, max: 8, unit: 'por serie' },
]

const PRIORITY_TONE: Record<string, string> = {
  Atrasado: 'overdue',
  Urgente: 'urgent',
  Alta: 'high',
  Media: 'medium',
  Baja: 'low',
}

type Popover = 'board' | 'preset' | null

export function PomodoroPanel({ state, presets, today, boards, tasks, onAction, onNotify }: PomodoroPanelProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [popover, setPopover] = useState<Popover>(null)
  const [pickedBoard, setPickedBoard] = useState<string | null>(null)
  const [boardSwaps, setBoardSwaps] = useState(0)
  const previousRef = useRef<{ phase: PomodoroPhase; runState: PomodoroState['runState'] } | null>(null)
  const tickSentForRef = useRef<number | null>(null)
  const lastBreathSecondRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const boardButtonRef = useRef<HTMLButtonElement | null>(null)
  const presetButtonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  const run = useCallback((action: PomodoroAction) => {
    onAction(action).catch((error: unknown) => {
      onNotify(error instanceof Error ? error.message : 'No se pudo actualizar el pomodoro.')
    })
  }, [onAction, onNotify])

  // The countdown is drawn from the backend's end timestamp, once a second.
  useEffect(() => {
    setNowMs(Date.now())
    if (state.runState !== 'running') return undefined
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [state.runState, state.endTimestamp])

  const totalSeconds = Math.max(1, getPhaseDurationSeconds(state.durations, state.phase))
  const remainingSeconds = Math.min(totalSeconds, getPomodoroRemainingSeconds(state, nowMs))
  const isRunning = state.runState === 'running'

  // At zero the backend closes the phase; asked once per countdown.
  useEffect(() => {
    if (!isRunning || state.endTimestamp === null || remainingSeconds > 0) return
    if (tickSentForRef.current === state.endTimestamp) return
    tickSentForRef.current = state.endTimestamp
    run({ kind: 'tick' })
  }, [isRunning, remainingSeconds, run, state.endTimestamp])

  useEffect(() => {
    const previous = previousRef.current
    if (previous && previous.phase !== state.phase) {
      playPomodoroAlarmShort(audioContextRef)
      if (previous.runState === 'running') {
        const next = getPomodoroPhaseLabel(state.phase).toLowerCase()
        onNotify(previous.phase === 'work' ? `Pomodoro finalizado. Sigue ${next}.` : `Descanso finalizado. Sigue ${next}.`)
      }
    }
    previousRef.current = { phase: state.phase, runState: state.runState }
  }, [onNotify, state.phase, state.runState])

  useEffect(() => {
    if (!isRunning || remainingSeconds <= 0 || remainingSeconds > 4) {
      lastBreathSecondRef.current = null
      return
    }
    if (lastBreathSecondRef.current === remainingSeconds) return
    lastBreathSecondRef.current = remainingSeconds
    playPomodoroBreathTick(audioContextRef)
  }, [isRunning, remainingSeconds])

  useEffect(() => () => {
    const context = audioContextRef.current
    if (context && context.state !== 'closed') void context.close().catch(() => {})
    audioContextRef.current = null
  }, [])

  const togglePlay = useCallback(() => {
    if (state.runState === 'running') run({ kind: 'pause' })
    else if (state.runState === 'paused') run({ kind: 'resume' })
    else run({ kind: 'start' })
  }, [run, state.runState])

  const reset = useCallback(() => run({ kind: 'reset' }), [run])

  // Space and R work anywhere in the view except while typing or in a menu.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (popover !== null || isEditableTarget(event.target)) return
      if (event.key === ' ' || event.code === 'Space') {
        if (isActivatableTarget(event.target)) return
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        reset()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [popover, reset, togglePlay])

  // Focus goes to the current item when a menu opens.
  useEffect(() => {
    if (popover === null) return
    const current = popoverRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')
      ?? popoverRef.current?.querySelector<HTMLElement>('button')
    current?.focus()
  }, [popover])

  const closePopover = (restoreFocus: boolean) => {
    const opener = popover === 'board' ? boardButtonRef.current : presetButtonRef.current
    setPopover(null)
    if (restoreFocus) opener?.focus()
  }

  const onPopoverKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closePopover(true)
    }
  }

  const linkedTask = state.selectedTaskPath
    ? tasks.find((task) => task.filePath === state.selectedTaskPath) ?? null
    : null
  const activeBoard = boards.find((board) => board.name === pickedBoard)
    ?? boards.find((board) => board.name === linkedTask?.board)
    ?? boards[0]
    ?? null
  const boardTasks = activeBoard ? tasks.filter((task) => task.board === activeBoard.name) : []
  const candidateGroups = [
    { label: 'En progreso', items: boardTasks.filter((task) => task.state === 'En progreso') },
    { label: 'Pendientes', items: boardTasks.filter((task) => task.state === 'Pendiente') },
  ].filter((group) => group.items.length > 0)

  const pickBoard = (name: string) => {
    if (name !== activeBoard?.name) setBoardSwaps((count) => count + 1)
    setPickedBoard(name)
    closePopover(true)
  }

  const activePreset = presets.find((preset) => preset.active) ?? null
  const cycles = Math.max(1, state.durations.cycles)
  const cyclesInSet = state.completedWorkCycles % cycles
  const dashOffset = RING_CIRCUMFERENCE * (1 - remainingSeconds / totalSeconds)
  const statusLabel = state.runState === 'running'
    ? state.phase === 'work' ? 'En foco' : 'Descansando'
    : state.runState === 'paused' ? 'En pausa' : 'Preparado'

  const step = (key: keyof PomodoroDurations, delta: number, min: number, max: number) => {
    const value = Math.max(min, Math.min(max, state.durations[key] + delta))
    if (value === state.durations[key]) return
    run({ kind: 'set-durations', durations: { ...state.durations, [key]: value } })
  }

  return (
    <div className="tm-pomodoro">
      <div className="tm-pomodoro-columns">
        <section className="tm-pomodoro-card tm-pomodoro-timer" aria-label="Temporizador">
          <div className="tm-pomodoro-timer-top">
            <div className="tm-pomodoro-modes" role="group" aria-label="Modo">
              {PHASES.map((phase) => (
                <button
                  key={phase}
                  type="button"
                  className="tm-pomodoro-mode"
                  aria-pressed={state.phase === phase}
                  onClick={() => run({ kind: 'select-phase', phase })}
                >
                  {getPomodoroPhaseLabel(phase)}
                </button>
              ))}
            </div>
            <span className="tm-pomodoro-cycle">
              Ciclo
              <span className="tm-pomodoro-cycle-dots" aria-hidden="true">
                {Array.from({ length: cycles }, (_, index) => (
                  <span key={index} className={`tm-pomodoro-cycle-dot${index < cyclesInSet ? ' is-done' : ''}`} />
                ))}
              </span>
              <span className="tm-pomodoro-cycle-label">{cyclesInSet} / {cycles}</span>
            </span>
          </div>

          <div className="tm-pomodoro-ring">
            <svg role="img" aria-label="Progreso del temporizador" viewBox="0 0 300 300" className="tm-pomodoro-ring-svg">
              <circle cx="150" cy="150" r={RING_RADIUS} className="tm-pomodoro-ring-track" />
              <circle
                cx="150"
                cy="150"
                r={RING_RADIUS}
                className="tm-pomodoro-ring-progress"
                strokeDasharray={RING_CIRCUMFERENCE.toFixed(2)}
                strokeDashoffset={dashOffset.toFixed(2)}
              />
            </svg>
            <div className="tm-pomodoro-ring-center">
              <span className="tm-pomodoro-ring-mode">{getPomodoroPhaseLabel(state.phase)}</span>
              <span className="tm-pomodoro-clock" role="timer" aria-label={`Tiempo restante ${formatPomodoroCountdown(remainingSeconds)}`}>
                {formatPomodoroCountdown(remainingSeconds)}
              </span>
              <span className="tm-pomodoro-status" aria-live="polite">{statusLabel}</span>
            </div>
          </div>

          <div className="tm-pomodoro-controls">
            <button type="button" className="tm-pomodoro-round" aria-label="Reiniciar" title="Reiniciar" onClick={reset}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5" /></svg>
            </button>
            <button
              type="button"
              className="tm-pomodoro-play"
              aria-label={isRunning ? 'Pausar' : 'Iniciar'}
              title={isRunning ? 'Pausar' : 'Iniciar'}
              onClick={togglePlay}
            >
              {isRunning ? (
                <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.2" /><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" /></svg>
              ) : (
                <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="currentColor" className="tm-pomodoro-play-icon"><path d="M7.5 4.8v14.4L19 12z" /></svg>
              )}
            </button>
            <button type="button" className="tm-pomodoro-round" aria-label="Saltar al siguiente" title="Saltar al siguiente" onClick={() => run({ kind: 'skip' })}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5l10 7-10 7zM19 5v14" /></svg>
            </button>
          </div>
          <span className="tm-pomodoro-hint">Espacio para iniciar o pausar · R para reiniciar</span>
        </section>

        <div className="tm-pomodoro-side">
          <section className="tm-pomodoro-card tm-pomodoro-linked" aria-label="Tarea vinculada">
            <div className="tm-pomodoro-card-head">
              <h2 className="tm-pomodoro-card-title">Tarea vinculada</h2>
              <div className={`tm-pomodoro-anchor${popover === 'board' ? ' is-open' : ''}`}>
                <button
                  ref={boardButtonRef}
                  type="button"
                  className="tm-pomodoro-board-btn"
                  aria-haspopup="dialog"
                  aria-expanded={popover === 'board'}
                  aria-label={`Tablero: ${activeBoard?.name ?? 'ninguno'}. Cambiar`}
                  disabled={boards.length === 0}
                  onClick={() => setPopover(popover === 'board' ? null : 'board')}
                >
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" className="tm-pomodoro-muted-icon"><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M9.5 4v16M15 4v16" /></svg>
                  <span className="tm-pomodoro-board-btn-label">Tablero</span>
                  <span className="tm-pomodoro-board-btn-name">{activeBoard?.name ?? '—'}</span>
                  <Chevron />
                </button>
                {popover === 'board' ? (
                  <div ref={popoverRef} className="tm-pomodoro-menu tm-pomodoro-board-menu" role="dialog" aria-label="Elegir tablero" onKeyDown={onPopoverKeyDown}>
                    <span className="tm-pomodoro-menu-title">Operar sobre</span>
                    <div role="radiogroup" aria-label="Tableros" className="tm-pomodoro-menu-list">
                      {boards.map((board) => {
                        const checked = board.name === activeBoard?.name
                        const active = board.counts.inProgress + board.counts.pending
                        return (
                          <button
                            key={board.name}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            className="tm-pomodoro-menu-item"
                            onClick={() => pickBoard(board.name)}
                          >
                            <span className="tm-pomodoro-board-initial" aria-hidden="true">{board.name.slice(0, 1)}</span>
                            <span className="tm-pomodoro-menu-text">
                              <span className="tm-pomodoro-menu-name">{board.name}</span>
                              <span className="tm-pomodoro-menu-sub">
                                {active > 0 ? `${board.counts.inProgress} en progreso · ${board.counts.pending} pendientes` : 'Sin tareas activas'}
                              </span>
                            </span>
                            {checked ? <CheckIcon /> : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {linkedTask ? (
              <div className="tm-pomodoro-linked-task">
                <span className="tm-pomodoro-linked-meta">
                  {linkedTask.priority ? <PriorityChip priority={linkedTask.priority} /> : null}
                  {linkedTask.board} · {linkedTask.group || 'Sin grupo'}
                </span>
                <span className="tm-pomodoro-linked-title">{linkedTask.title}</span>
                <span className="tm-pomodoro-linked-foot">
                  <span>El foco de esta sesión se registra en esta tarea.</span>
                  <button type="button" className="tm-pomodoro-unlink" onClick={() => run({ kind: 'select-task', taskPath: null })}>
                    Desvincular
                  </button>
                </span>
              </div>
            ) : (
              <div className="tm-pomodoro-unlinked">
                <span className="tm-pomodoro-unlinked-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
                </span>
                <span className="tm-pomodoro-unlinked-text">
                  <span className="tm-pomodoro-unlinked-title">Ninguna tarea vinculada</span>
                  <span className="tm-pomodoro-unlinked-hint">Elegí una de las que tenés en progreso.</span>
                </span>
              </div>
            )}

            <div key={`${activeBoard?.name ?? ''}:${boardSwaps}`} className={`tm-pomodoro-candidates${boardSwaps > 0 ? ' is-swapped' : ''}`}>
              {candidateGroups.map((group) => (
                <div key={group.label} className="tm-pomodoro-candidate-group">
                  <span className="tm-pomodoro-candidate-label">{group.label}</span>
                  <div className="tm-pomodoro-candidate-list">
                    {group.items.map((task) => {
                      const isLinked = task.filePath === state.selectedTaskPath
                      return (
                        <button
                          key={task.filePath}
                          type="button"
                          className={`tm-pomodoro-pick${isLinked ? ' is-linked' : ''}`}
                          aria-pressed={isLinked}
                          onClick={() => {
                            if (!isLinked) run({ kind: 'select-task', taskPath: task.filePath })
                          }}
                        >
                          <span className="tm-pomodoro-pick-dot" data-priority={PRIORITY_TONE[task.priority] ?? 'none'} aria-hidden="true" />
                          <span className="tm-pomodoro-pick-text">
                            <span className="tm-pomodoro-pick-title">{task.title}</span>
                            <span className="tm-pomodoro-pick-group">{task.group || 'Sin grupo'}</span>
                          </span>
                          <span className="tm-pomodoro-pick-action">{isLinked ? 'Vinculada' : 'Vincular'}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {activeBoard && candidateGroups.length === 0 ? (
                <div className="tm-pomodoro-no-candidates">
                  <span className="tm-pomodoro-no-candidates-title">Sin tareas activas en «{activeBoard.name}»</span>
                  <span className="tm-pomodoro-no-candidates-hint">Elegí otro tablero o creá una tarea en este.</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="tm-pomodoro-card tm-pomodoro-durations" aria-label="Duraciones">
            <div className="tm-pomodoro-card-head">
              <h2 className="tm-pomodoro-card-title">Duraciones</h2>
              <div className={`tm-pomodoro-anchor${popover === 'preset' ? ' is-open' : ''}`}>
                <button
                  ref={presetButtonRef}
                  type="button"
                  className="tm-pomodoro-preset-btn"
                  aria-haspopup="menu"
                  aria-expanded={popover === 'preset'}
                  disabled={presets.length === 0}
                  onClick={() => setPopover(popover === 'preset' ? null : 'preset')}
                >
                  <StarIcon />
                  {activePreset?.label ?? 'Personalizado'}
                  <Chevron />
                </button>
                {popover === 'preset' ? (
                  <div ref={popoverRef} className="tm-pomodoro-menu tm-pomodoro-preset-menu" role="menu" aria-label="Elegir duraciones" onKeyDown={onPopoverKeyDown}>
                    {presets.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        role="menuitemradio"
                        aria-checked={preset.active}
                        className="tm-pomodoro-menu-item tm-pomodoro-preset-item"
                        onClick={() => {
                          run({ kind: 'set-durations', durations: preset.durations })
                          closePopover(true)
                        }}
                      >
                        <span className="tm-pomodoro-menu-text">
                          <span className="tm-pomodoro-menu-name">{preset.label}</span>
                          <span className="tm-pomodoro-menu-sub">{preset.description}</span>
                        </span>
                        {preset.active ? <CheckIcon /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            {activePreset ? <p className="tm-pomodoro-preset-description">{activePreset.description}</p> : null}
            <div className="tm-pomodoro-steppers">
              {STEPPERS.map((stepper) => {
                const value = state.durations[stepper.key]
                return (
                  <div key={stepper.key} className="tm-pomodoro-stepper">
                    <span className="tm-pomodoro-stepper-text">
                      <span className="tm-pomodoro-stepper-label">{stepper.label}</span>
                      <span className="tm-pomodoro-stepper-value">
                        {value}
                        <span className="tm-pomodoro-stepper-unit">{stepper.unit}</span>
                      </span>
                    </span>
                    <button
                      type="button"
                      className="tm-pomodoro-step-btn"
                      aria-label={`Restar ${stepper.label}`}
                      disabled={value <= stepper.min}
                      onClick={() => step(stepper.key, -stepper.step, stepper.min, stepper.max)}
                    >
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M5 12h14" /></svg>
                    </button>
                    <button
                      type="button"
                      className="tm-pomodoro-step-btn"
                      aria-label={`Sumar ${stepper.label}`}
                      disabled={value >= stepper.max}
                      onClick={() => step(stepper.key, stepper.step, stepper.min, stepper.max)}
                    >
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>

      <section className="tm-pomodoro-card tm-pomodoro-log" aria-label="Registros del día">
        {today ? (
          <>
            <div className="tm-pomodoro-log-head">
              <h2 className="tm-pomodoro-card-title">Registros del día</h2>
              <span className="tm-pomodoro-log-stat"><span className="tm-pomodoro-log-number">{today.count}</span>pomodoros</span>
              <span className="tm-pomodoro-log-stat"><span className="tm-pomodoro-log-number">{today.focusMinutes}</span>min de foco</span>
              <span className="tm-pomodoro-spacer" />
              <span className="tm-pomodoro-legend" aria-hidden="true">
                Menos
                <span className="tm-pomodoro-legend-cell" data-level="0" />
                <span className="tm-pomodoro-legend-cell" data-level="1" />
                <span className="tm-pomodoro-legend-cell" data-level="2" />
                <span className="tm-pomodoro-legend-cell" data-level="3" />
                Más
              </span>
            </div>
            <div className="tm-pomodoro-heatmap">
              <span className="tm-pomodoro-heatmap-title">Por hora · Trabajo</span>
              <div className="tm-pomodoro-heatmap-grid" role="list" aria-label="Pomodoros por hora">
                {HOURS.map((hour) => {
                  const count = today.byHour[hour] ?? 0
                  const tip = `${padHour(hour)}:00 · ${count} ${count === 1 ? 'pomodoro' : 'pomodoros'}`
                  return (
                    <span
                      key={hour}
                      role="listitem"
                      aria-label={tip}
                      title={tip}
                      data-count={count}
                      data-level={heatLevel(count)}
                      className={`tm-pomodoro-heat-cell${hour === today.currentHour ? ' is-now' : ''}`}
                    />
                  )
                })}
              </div>
              <div className="tm-pomodoro-heatmap-hours" aria-hidden="true">
                {HOURS.map((hour) => (
                  <span key={hour} className={hour === today.currentHour ? 'is-now' : undefined}>
                    {hour % 3 === 0 ? padHour(hour) : ''}
                  </span>
                ))}
              </div>
            </div>
            {today.count === 0 ? (
              <LogNote>Todavía no registraste pomodoros hoy. Cuando completes uno aparece acá, con la tarea vinculada.</LogNote>
            ) : null}
          </>
        ) : (
          <>
            <div className="tm-pomodoro-log-head">
              <h2 className="tm-pomodoro-card-title">Registros del día</h2>
            </div>
            <LogNote>Los registros del día no se muestran en el tablero publicado.</LogNote>
          </>
        )}
      </section>

      {popover !== null ? <div className="tm-pomodoro-backdrop" aria-hidden="true" onClick={() => closePopover(false)} /> : null}
    </div>
  )
}

function heatLevel(count: number): number {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count < 4) return 2
  return 3
}

function padHour(hour: number): string {
  return String(hour).padStart(2, '0')
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

/** Space already presses a focused button or link; the shortcut stays out. */
function isActivatableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('button, a[href], [role="button"], [role="menuitem"], [role="radio"]') !== null
}

function PriorityChip({ priority }: { priority: string }) {
  return (
    <span className="tm-pomodoro-priority" data-priority={PRIORITY_TONE[priority] ?? 'none'}>
      <span className="tm-pomodoro-priority-dot" aria-hidden="true" />
      {priority}
    </span>
  )
}

function LogNote({ children }: { children: ReactNode }) {
  return (
    <div className="tm-pomodoro-log-note">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M10 2.5h4" /></svg>
      {children}
    </div>
  )
}

function Chevron() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="tm-pomodoro-chevron"><path d="M6 9l6 6 6-6" /></svg>
  )
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="tm-pomodoro-check"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
  )
}

function StarIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" className="tm-pomodoro-star"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" /></svg>
  )
}

function ensureAudioContext(audioContextRef: MutableRefObject<AudioContext | null>): AudioContext | null {
  if (audioContextRef.current && audioContextRef.current.state !== 'closed') return audioContextRef.current
  const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return null
  try {
    audioContextRef.current = new AudioContextCtor()
  } catch {
    audioContextRef.current = null
  }
  return audioContextRef.current
}

function playTone(
  audioContextRef: MutableRefObject<AudioContext | null>,
  shape: (context: AudioContext, oscillator: OscillatorNode, gain: GainNode, now: number) => number,
): void {
  const audioContext = ensureAudioContext(audioContextRef)
  if (!audioContext) return
  const play = () => {
    try {
      const now = audioContext.currentTime
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      const stopAt = shape(audioContext, oscillator, gain, now)
      oscillator.connect(gain)
      gain.connect(audioContext.destination)
      oscillator.start(now)
      oscillator.stop(stopAt)
    } catch {
      // Autoplay or audio errors leave the timer silent.
    }
  }
  if (audioContext.state === 'suspended') {
    void audioContext.resume().then(play).catch(() => {})
    return
  }
  play()
}

/** Soft tick of the last four seconds. */
function playPomodoroBreathTick(audioContextRef: MutableRefObject<AudioContext | null>): void {
  playTone(audioContextRef, (_context, oscillator, gain, now) => {
    oscillator.type = 'sine'
    oscillator.frequency.value = 660
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    return now + 0.16
  })
}

/** Short alarm when the phase changes. */
function playPomodoroAlarmShort(audioContextRef: MutableRefObject<AudioContext | null>): void {
  playTone(audioContextRef, (_context, oscillator, gain, now) => {
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(988, now)
    oscillator.frequency.exponentialRampToValueAtTime(784, now + 0.24)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28)
    return now + 0.3
  })
}
