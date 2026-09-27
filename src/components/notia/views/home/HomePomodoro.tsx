import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { HomeFocus } from '../../../../services/home/homeTypes'
import { homeErrorMessage } from '../../../../services/home/homeService'
import { runPomodoroAction, type PomodoroAction } from '../../../../modules/task-manager/services/taskManagerService'
import { clearLegacyPomodoroState, loadLegacyPomodoroState } from '../../../../modules/task-manager/services/taskManagerStorage'
import { TASK_MANAGER_LOCAL_LIBRARY_USER_ID, type PomodoroState } from '../../../../modules/task-manager/types/taskManagerTypes'
import {
  formatPomodoroCountdown,
  getPhaseDurationSeconds,
  getPomodoroPhaseLabel,
  getPomodoroRemainingSeconds,
} from '../../../../modules/task-manager/utils/pomodoroDisplay'

interface HomePomodoroProps {
  library: NotiaLibrary
  /** Ticket to work on, chosen by Rust. */
  focus: HomeFocus | null
}

/**
 * The owner's Pomodoro timer, the same the Task Manager shows. The backend
 * keeps it and advances its phases; this panel shows the countdown and sends
 * the actions. Starting with no ticket chosen works on the focus ticket.
 */
export function HomePomodoro({ library, focus }: HomePomodoroProps) {
  const context = useMemo(() => ({ libraryId: library.id, libraryUserId: TASK_MANAGER_LOCAL_LIBRARY_USER_ID }), [library.id])
  const [timer, setTimer] = useState<PomodoroState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const timerRef = useRef<PomodoroState | null>(null)
  const busyRef = useRef(false)

  const run = useCallback(async (actions: PomodoroAction[]) => {
    if (busyRef.current) return
    busyRef.current = true
    setIsBusy(true)
    try {
      for (const action of actions) {
        const isRead = action.kind === 'read'
        const result = await runPomodoroAction(context, action, isRead ? loadLegacyPomodoroState() : undefined)
        if (isRead) clearLegacyPomodoroState()
        timerRef.current = result.state
        setTimer(result.state)
        setNowMs(Date.now())
        setError(result.recordError ?? null)
      }
    } catch (reason) {
      setError(homeErrorMessage(reason, 'No se pudo usar el pomodoro.'))
    } finally {
      busyRef.current = false
      setIsBusy(false)
    }
  }, [context])

  useEffect(() => {
    void run([{ kind: 'read' }])
  }, [run])

  // The countdown moves every second; at zero the backend advances the phase.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const current = timerRef.current
      if (current?.runState !== 'running') return
      setNowMs(Date.now())
      const isDue = !current.isDeviationActive && current.endTimestamp !== null && current.endTimestamp <= Date.now()
      if (isDue) void run([{ kind: 'tick' }])
    }, 1000)
    return () => window.clearInterval(interval)
  }, [run])

  const runState = timer?.runState ?? 'idle'
  const phase = timer?.phase ?? 'work'
  const remaining = timer ? getPomodoroRemainingSeconds(timer, nowMs) : 25 * 60
  const breakMinutes = timer ? Math.round(getPhaseDurationSeconds(timer.durations, phase) / 60) : 0
  const label = phase === 'work'
    ? focus ? `Foco: ${focus.title}` : 'Sin tareas abiertas para enfocarte.'
    : `${getPomodoroPhaseLabel(phase)}. Tomate ${breakMinutes} minutos.`

  const toggle = () => {
    if (runState === 'running') {
      void run([{ kind: 'pause' }])
      return
    }
    if (runState === 'paused') {
      void run([{ kind: 'resume' }])
      return
    }
    const chooseFocus = phase === 'work' && focus && !focus.selected && timer?.selectedTaskPath !== focus.filePath
    void run(chooseFocus ? [{ kind: 'select-task', taskPath: focus.filePath }, { kind: 'start' }] : [{ kind: 'start' }])
  }

  return (
    <div className="home-pomodoro">
      <div className="home-pomodoro__text">
        <span className="home-label home-label--small">Pomodoro</span>
        <span className="home-pomodoro__focus">{error ?? label}</span>
      </div>
      <span className={`home-pomodoro__time${runState === 'running' ? ' is-running' : ''}`} aria-live="off">
        {formatPomodoroCountdown(remaining)}
      </span>
      <button type="button" className="home-icon-button" aria-label="Reiniciar pomodoro" disabled={!timer || isBusy} onClick={() => void run([{ kind: 'reset' }])}>
        <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button type="button" className="home-button home-button--primary home-pomodoro__toggle" disabled={!timer || isBusy} onClick={toggle}>
        {runState === 'running' ? 'Pausar' : runState === 'paused' ? 'Seguir' : 'Iniciar'}
      </button>
    </div>
  )
}
