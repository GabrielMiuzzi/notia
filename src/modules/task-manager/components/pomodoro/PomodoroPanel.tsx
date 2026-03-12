import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import {
  formatPomodoroCountdown,
  getDeviationElapsedSeconds,
  getPhaseDurationSeconds,
  getPomodoroPhaseLabel,
  getPomodoroRemainingSeconds,
} from '../../engines/pomodoroEngine'
import { getEntriesByDate, toLocalDateText } from '../../engines/pomodoroLogEngine'
import { TASK_ICON_NAME, TaskManagerIcon } from '../../engines/taskIconEngine'
import type { PomodoroDurations, PomodoroLogEntry, PomodoroState, TaskItem } from '../../types/taskManagerTypes'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { NotiaCard } from '../../../../components/common/NotiaCard'
import { TaskManagerModal } from '../common/TaskManagerModal'

interface PomodoroPanelProps {
  state: PomodoroState
  tasks: TaskItem[]
  entries: PomodoroLogEntry[]
  onSelectTask: (taskPath: string | null) => void
  onStart: () => Promise<void>
  onPause: () => void
  onResume: () => void
  onReset: () => void
  onEnterDeviation: () => void
  onExitDeviation: () => Promise<void>
  onSetDurations: (durations: PomodoroDurations) => void
  onDeleteEntry: (entryId: string) => Promise<void>
  onNotify: (message: string | null) => void
}

const BREAK_MESSAGES = [
  'Respira profundo y estira cuello y hombros.',
  'Tomá agua y alejate un minuto de la pantalla.',
  'Un descanso corto mantiene el ritmo.',
  'Pausa breve, mente fresca.',
]

const POMODORO_PRESETS: Array<{ title: string; usage: string; durations: PomodoroDurations }> = [
  {
    title: '⭐ Estándar - 25/5',
    usage: 'tareas moderadas, programación, estudio, mantener ritmo constante sin quemarse.',
    durations: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
  },
  {
    title: '⚡ Sprint - 50/10',
    usage: 'trabajo profundo con bloques largos y pausas más amplias.',
    durations: { workMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20 },
  },
  {
    title: '🧠 Ligero - 15/3',
    usage: 'inicio de jornada, tareas livianas o cuando cuesta arrancar.',
    durations: { workMinutes: 15, shortBreakMinutes: 3, longBreakMinutes: 10 },
  },
  {
    title: '🏋 Intenso - 45/7',
    usage: 'foco sostenido con pausas cortas de recuperación.',
    durations: { workMinutes: 45, shortBreakMinutes: 7, longBreakMinutes: 18 },
  },
]

export function PomodoroPanel({
  state,
  tasks,
  entries,
  onSelectTask,
  onStart,
  onPause,
  onResume,
  onReset,
  onEnterDeviation,
  onExitDeviation,
  onSetDurations,
  onDeleteEntry,
  onNotify,
}: PomodoroPanelProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false)
  const previousVisualStateRef = useRef<{ phase: PomodoroState['phase']; runState: PomodoroState['runState']; isDeviationActive: boolean } | null>(null)
  const lastBreathSecondRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)
  const timeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [])

  const elapsedDeviationSeconds = getDeviationElapsedSeconds(state, nowMs)
  const remainingSeconds = getPomodoroRemainingSeconds(state, nowMs)
  const displayedSeconds = state.isDeviationActive ? elapsedDeviationSeconds : remainingSeconds

  const totalSeconds = Math.max(
    1,
    state.isDeviationActive
      ? Math.max(1, state.deviationBaseRemainingSeconds)
      : getPhaseDurationSeconds(state.durations, state.phase),
  )

  const elapsedSeconds = state.isDeviationActive
    ? elapsedDeviationSeconds
    : Math.max(0, totalSeconds - remainingSeconds)

  const progressPercent = Math.min(100, (elapsedSeconds / totalSeconds) * 100)
  const visualMode = resolveVisualMode(state)
  const runGlyph = state.runState === 'running'
    ? null
    : state.runState === 'paused'
      ? <TaskManagerIcon name={TASK_ICON_NAME.pause} size={12} />
      : <TaskManagerIcon name={TASK_ICON_NAME.stop} size={10} />
  const runStateLabel = resolveRunStateLabel(state)
  const breakMessage = resolveBreakMessage(state)

  const selectedTask = tasks.find((task) => task.filePath === state.selectedTaskPath) ?? null
  const todayEntries = getEntriesByDate(entries, toLocalDateText(new Date()))
  const hourlyCounts = buildHourlyCounts(todayEntries)
  const cycleValue = state.completedWorkCycles > 0
    ? state.completedWorkCycles % 4 === 0
      ? 4
      : state.completedWorkCycles % 4
    : 0

  useEffect(() => {
    const previous = previousVisualStateRef.current
    if (previous) {
      const phaseChanged = previous.phase !== state.phase || previous.isDeviationActive !== state.isDeviationActive
      const runStateChanged = previous.runState !== state.runState

      if (phaseChanged) {
        triggerTransientClass(ringRef.current, 'is-phase-shift', 520)
        triggerTransientClass(timeRef.current, 'is-phase-shift-time', 520)
        triggerTransientClass(panelRef.current, 'tareas-pomodoro-panel-flash', 900)
        playPomodoroAlarmShort(audioContextRef)
      }

      if (runStateChanged) {
        triggerTransientClass(ringRef.current, 'is-runstate-shift', 520)
      }

      if (phaseChanged && previous.runState === 'running') {
        if (previous.phase === 'work') {
          onNotify(`Pomodoro finalizado. Iniciando ${getPomodoroPhaseLabel(state.phase).toLowerCase()}.`)
        } else {
          onNotify(`Descanso finalizado. Iniciando ${getPomodoroPhaseLabel(state.phase).toLowerCase()}.`)
        }
      }
    }

    previousVisualStateRef.current = {
      phase: state.phase,
      runState: state.runState,
      isDeviationActive: state.isDeviationActive,
    }
  }, [onNotify, state.isDeviationActive, state.phase, state.runState])

  useEffect(() => {
    const shouldPlayBreath = state.runState === 'running'
      && !state.isDeviationActive
      && remainingSeconds > 0
      && remainingSeconds <= 4

    if (!shouldPlayBreath) {
      lastBreathSecondRef.current = null
      return
    }

    if (lastBreathSecondRef.current === remainingSeconds) {
      return
    }

    lastBreathSecondRef.current = remainingSeconds
    playPomodoroBreathTick(audioContextRef)
  }, [remainingSeconds, state.isDeviationActive, state.runState])

  useEffect(() => () => {
    const context = audioContextRef.current
    if (context && context.state !== 'closed') {
      void context.close().catch(() => {})
    }
    audioContextRef.current = null
  }, [])

  return (
    <div className="tareas-pomodoro-panel" ref={panelRef}>
      <div className="tareas-pomodoro-top">
        <h2 className="tareas-pomodoro-phase">{getPomodoroPhaseLabel(state.phase)}</h2>
        <span className="tareas-pomodoro-cycles-badge">{cycleValue} / 4</span>
      </div>

      <div className="tareas-pomodoro-timer-wrap">
        <div
          className="tareas-pomodoro-progress"
          ref={ringRef}
          data-mode={visualMode}
          data-run-state={state.runState}
          style={{ ['--tareas-pomodoro-progress' as string]: `${progressPercent}%` }}
        >
          <div className="tareas-pomodoro-progress-inner">
            <div className={`tareas-pomodoro-time${state.isDeviationActive ? ' is-deviation' : ''}`} ref={timeRef}>
              {formatPomodoroCountdown(displayedSeconds)}
            </div>
            {runGlyph ? <div className="tareas-pomodoro-run-glyph">{runGlyph}</div> : null}
          </div>
        </div>
      </div>

      <p className="tareas-pomodoro-break-message">{breakMessage}</p>

      <div className="tareas-pomodoro-controls">
        <div className="tareas-pomodoro-controls-icons">
          {state.runState === 'running' ? (
            <NotiaButton className="tareas-pomodoro-btn tareas-pomodoro-btn-icon" onClick={onPause} title="Pausar">
              <TaskManagerIcon name={TASK_ICON_NAME.pause} size={14} />
            </NotiaButton>
          ) : (
            <NotiaButton
              className="tareas-pomodoro-btn tareas-pomodoro-btn-icon"
              onClick={() => {
                if (state.runState === 'paused') {
                  onResume()
                } else {
                  void onStart()
                }
              }}
              title={state.runState === 'paused' ? 'Reanudar' : 'Iniciar'}
            >
              <TaskManagerIcon name={TASK_ICON_NAME.play} size={14} />
            </NotiaButton>
          )}

          <NotiaButton className="tareas-pomodoro-btn tareas-pomodoro-btn-icon" onClick={onReset} title="Reiniciar">
            <TaskManagerIcon name={TASK_ICON_NAME.reset} size={14} />
          </NotiaButton>

          <NotiaButton
            className={`tareas-pomodoro-btn tareas-pomodoro-btn-icon${state.isDeviationActive ? ' is-deviation-active' : ''}`}
            onClick={() => {
              if (state.isDeviationActive) {
                void onExitDeviation()
              } else {
                onEnterDeviation()
              }
            }}
            title={state.isDeviationActive ? 'Finalizar desvío' : 'Iniciar desvío'}
            disabled={!state.isDeviationActive && state.runState !== 'running'}
          >
            <TaskManagerIcon name={TASK_ICON_NAME.clock} size={14} />
          </NotiaButton>
        </div>
      </div>

      <div className="tareas-pomodoro-state-bar" data-state={state.isDeviationActive ? 'deviation' : state.runState}>{runStateLabel}</div>

      <div className="tareas-pomodoro-config">
        <h3>Duraciones (min)</h3>
        <div
          className="tareas-pomodoro-config-card"
          role="button"
          tabIndex={0}
          onDoubleClick={() => setIsPresetModalOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setIsPresetModalOpen(true)
            }
          }}
        >
          <h4 className="tareas-pomodoro-config-card-title">⭐ Estándar - {state.durations.workMinutes}/{state.durations.shortBreakMinutes}</h4>
          <div className="tareas-pomodoro-config-card-divider" />
          <p className="tareas-pomodoro-config-card-label">Uso</p>
          <p className="tareas-pomodoro-config-card-text">tareas moderadas, programación, estudio, mantener ritmo constante sin quemarse.</p>
          <div className="tareas-pomodoro-config-card-divider" />
          <p className="tareas-pomodoro-config-card-text">Trabajo: {state.durations.workMinutes} min</p>
          <p className="tareas-pomodoro-config-card-text">Descanso corto: {state.durations.shortBreakMinutes} min</p>
          <p className="tareas-pomodoro-config-card-text">Descanso largo: {state.durations.longBreakMinutes} min</p>
          <p className="tareas-pomodoro-config-card-text">Ciclos: 4</p>
          <p className="tareas-pomodoro-config-card-hint">Doble click para cambiar duración</p>
        </div>
      </div>

      <TaskManagerModal open={isPresetModalOpen} onClose={() => setIsPresetModalOpen(false)} size="lg" >
        <div className="tareas-dialog-header">
          <h2>Elegir duración Pomodoro</h2>
        </div>
        <div className="tareas-dialog-body">
          <div className="tareas-pomodoro-preset-grid">
            {POMODORO_PRESETS.map((preset) => {
              const isSelected = preset.durations.workMinutes === state.durations.workMinutes
                && preset.durations.shortBreakMinutes === state.durations.shortBreakMinutes
                && preset.durations.longBreakMinutes === state.durations.longBreakMinutes

              return (
                <NotiaCard
                  key={preset.title}
                  className="tareas-pomodoro-config-card tareas-pomodoro-preset-card"
                  selected={isSelected}
                  interactive
                  onClick={() => {
                    onSetDurations(preset.durations)
                    setIsPresetModalOpen(false)
                  }}
                >
                  <h4 className="tareas-pomodoro-config-card-title">{preset.title}</h4>
                  <div className="tareas-pomodoro-config-card-divider" />
                  <p className="tareas-pomodoro-config-card-label">Uso</p>
                  <p className="tareas-pomodoro-config-card-text">{preset.usage}</p>
                  <div className="tareas-pomodoro-config-card-divider" />
                  <p className="tareas-pomodoro-config-card-text">Trabajo: {preset.durations.workMinutes} min</p>
                  <p className="tareas-pomodoro-config-card-text">Descanso corto: {preset.durations.shortBreakMinutes} min</p>
                  <p className="tareas-pomodoro-config-card-text">Descanso largo: {preset.durations.longBreakMinutes} min</p>
                </NotiaCard>
              )
            })}
          </div>
        </div>
        <div className="tareas-dialog-actions">
          <NotiaButton onClick={() => setIsPresetModalOpen(false)}>Cerrar</NotiaButton>
        </div>
      </TaskManagerModal>

      <div className="tareas-pomodoro-task-section">
        <h3>Tarea vinculada</h3>

        {selectedTask ? (
          <div className="tareas-card-list tareas-pomodoro-task-card-list">
            <div className="tareas-task-card">
              <div className="tareas-card-title-row">
                <span className="tareas-task-card-title">{selectedTask.title}</span>
              </div>
              {selectedTask.preview ? <p className="tareas-card-preview">{selectedTask.preview}</p> : null}
              <div className="tareas-card-progress-row">
                <div className="tareas-card-progress-band">
                  <div className="tareas-card-progress-band-fill" style={{ width: `${taskProgress(selectedTask)}%` }} />
                  <div className="tareas-card-progress-band-text">
                    {formatHours(selectedTask.dedicatedHours)}/{formatHours(selectedTask.estimatedHours)} +-&gt; {formatHours(selectedTask.deviationHours)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="tareas-pomodoro-task-card">
            <p className="tareas-pomodoro-task-card-meta">No hay tarea seleccionada</p>
            <p className="tareas-pomodoro-task-card-hint">Seleccioná una tarea con el botón</p>
          </div>
        )}

        <NotiaButton
          className="tareas-pomodoro-btn tareas-pomodoro-task-change-btn"
          onClick={() => pickLinkedTask(tasks, state.selectedTaskPath, onSelectTask)}
          disabled={state.runState === 'running'}
          title={state.runState === 'running' ? 'No se puede cambiar la tarea mientras corre el contador' : 'Cambiar tarea vinculada'}
        >
          Cambiar tarea vinculada
        </NotiaButton>
      </div>

      <div className="tareas-pomodoro-log-section">
        <h3>Registros del dia</h3>

        {todayEntries.length === 0 ? (
          <p className="tareas-pomodoro-log-empty">todavia no se registran pomodoros en el dia</p>
        ) : (
          <div className="tareas-pomodoro-log-table-wrap">
            <table className="tareas-pomodoro-log-table">
              <thead>
                <tr>
                  <th>Horario</th>
                  <th>Tipo de pomodoro</th>
                  <th>Duración elegida</th>
                  <th>Tarea</th>
                  <th>Tiempo</th>
                  <th>Desvío</th>
                  <th>Finalización</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {todayEntries.map((entry) => (
                  <tr key={`${entry.id}-${entry.time}`}>
                    <td>{entry.time}</td>
                    <td>{entry.type}</td>
                    <td>{entry.durationChoice}</td>
                    <td>{entry.task}</td>
                    <td>{formatHours(entry.durationMinutes)} min</td>
                    <td>{formatHours(entry.deviationHours)} h</td>
                    <td>{entry.finalized ? 'true' : 'false'}</td>
                    <td className="tareas-pomodoro-log-actions">
                      <NotiaButton className="tareas-pomodoro-log-delete-btn" onClick={() => void onDeleteEntry(entry.id)} title="Eliminar registro">
                        <TaskManagerIcon name={TASK_ICON_NAME.trash} size={12} />
                      </NotiaButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="tareas-pomodoro-heatmap">
          <h4>Heatmap horario (trabajo)</h4>
          <div className="tareas-pomodoro-heatmap-grid">
            {hourlyCounts.map((count, hour) => {
              const maxCount = Math.max(1, ...hourlyCounts)
              const level = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxCount) * 4))

              return (
                <div key={hour} className={`tareas-pomodoro-heatmap-cell is-level-${level}`}>
                  <span className="tareas-pomodoro-heatmap-hour">{String(hour).padStart(2, '0')}</span>
                  <span className="tareas-pomodoro-heatmap-count">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function resolveVisualMode(state: PomodoroState):
  | 'prepared'
  | 'work'
  | 'short-break'
  | 'long-break'
  | 'paused-work'
  | 'paused-short-break'
  | 'paused-long-break'
  | 'deviation' {
  if (state.isDeviationActive) {
    return 'deviation'
  }

  if (state.runState === 'idle') {
    return 'prepared'
  }

  if (state.runState === 'paused') {
    if (state.phase === 'short-break') {
      return 'paused-short-break'
    }

    if (state.phase === 'long-break') {
      return 'paused-long-break'
    }

    return 'paused-work'
  }

  if (state.phase === 'short-break') {
    return 'short-break'
  }

  if (state.phase === 'long-break') {
    return 'long-break'
  }

  return 'work'
}

function resolveRunStateLabel(state: PomodoroState): string {
  if (state.runState === 'idle') {
    return 'Preparado'
  }

  if (state.runState === 'paused') {
    return 'Pausado...'
  }

  if (state.isDeviationActive) {
    return 'Desvío activo...'
  }

  if (state.phase === 'work') {
    return 'Trabajando...'
  }

  if (state.phase === 'short-break') {
    return 'Descanso corto...'
  }

  if (state.phase === 'long-break') {
    return 'Descanso largo...'
  }

  return 'Listo'
}

function resolveBreakMessage(state: PomodoroState): string {
  if (state.phase !== 'short-break' && state.phase !== 'long-break') {
    return ''
  }

  const seed = state.completedWorkCycles + (state.phase === 'long-break' ? 7 : 3)
  return BREAK_MESSAGES[seed % BREAK_MESSAGES.length]
}

function formatHours(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

function taskProgress(task: TaskItem): number {
  if (task.estimatedHours <= 0) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round((task.dedicatedHours / task.estimatedHours) * 100)))
}

function buildHourlyCounts(entries: PomodoroLogEntry[]): number[] {
  const workEntries = entries.filter((entry) => entry.type.toLowerCase().includes('trabajo'))
  const counts = Array.from({ length: 24 }, () => 0)

  for (const entry of workEntries) {
    const hour = Number.parseInt(entry.time.slice(0, 2), 10)
    if (Number.isNaN(hour) || hour < 0 || hour > 23) {
      continue
    }

    counts[hour] += 1
  }

  return counts
}

function pickLinkedTask(tasks: TaskItem[], selectedTaskPath: string | null, onSelectTask: (taskPath: string | null) => void): void {
  const topLevelTasks = tasks
    .filter((task) => !task.parentTaskName.trim())
    .filter((task) => task.state === 'En progreso')

  if (topLevelTasks.length === 0) {
    window.alert('No hay tareas en progreso para vincular.')
    return
  }

  const currentIndex = topLevelTasks.findIndex((task) => task.filePath === selectedTaskPath)
  const options = ['0. Sin tarea', ...topLevelTasks.map((task, index) => `${index + 1}. ${task.title}`)].join('\n')
  const rawValue = window.prompt(`Selecciona una tarea:\n${options}`, currentIndex >= 0 ? String(currentIndex + 1) : '1')

  if (rawValue === null) {
    return
  }

  const selectedIndex = Number.parseInt(rawValue, 10)
  if (Number.isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex > topLevelTasks.length) {
    return
  }

  if (selectedIndex === 0) {
    onSelectTask(null)
    return
  }

  onSelectTask(topLevelTasks[selectedIndex - 1].filePath)
}

function ensureAudioContext(audioContextRef: MutableRefObject<AudioContext | null>): AudioContext | null {
  if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
    return audioContextRef.current
  }

  const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) {
    return null
  }

  try {
    audioContextRef.current = new AudioContextCtor()
  } catch {
    audioContextRef.current = null
  }

  return audioContextRef.current
}

function playPomodoroBreathTick(audioContextRef: MutableRefObject<AudioContext | null>): void {
  const audioContext = ensureAudioContext(audioContextRef)
  if (!audioContext) {
    return
  }

  const playTick = () => {
    try {
      const now = audioContext.currentTime
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.value = 660

      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)

      oscillator.connect(gain)
      gain.connect(audioContext.destination)

      oscillator.start(now)
      oscillator.stop(now + 0.16)
    } catch {
      // Ignore browser autoplay/audio errors.
    }
  }

  if (audioContext.state === 'suspended') {
    void audioContext.resume().then(playTick).catch(() => {})
    return
  }

  playTick()
}

function playPomodoroAlarmShort(audioContextRef: MutableRefObject<AudioContext | null>): void {
  const audioContext = ensureAudioContext(audioContextRef)
  if (!audioContext) {
    return
  }

  const playAlarm = () => {
    try {
      const now = audioContext.currentTime
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()

      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(988, now)
      oscillator.frequency.exponentialRampToValueAtTime(784, now + 0.24)

      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.11, now + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28)

      oscillator.connect(gain)
      gain.connect(audioContext.destination)

      oscillator.start(now)
      oscillator.stop(now + 0.3)
    } catch {
      // Ignore browser autoplay/audio errors.
    }
  }

  if (audioContext.state === 'suspended') {
    void audioContext.resume().then(playAlarm).catch(() => {})
    return
  }

  playAlarm()
}

function triggerTransientClass(element: HTMLElement | null, className: string, durationMs: number): void {
  if (!element) {
    return
  }

  element.classList.remove(className)
  void element.offsetWidth
  element.classList.add(className)

  window.setTimeout(() => {
    element.classList.remove(className)
  }, durationMs)
}
