import type { PomodoroDurations, PomodoroPhase, PomodoroState } from '../types/taskManagerTypes'

/*
 * What the Pomodoro panel shows of the timer the backend keeps
 * (`backend-core::pomodoro`): the countdown at the current time, the phase
 * name and the time format.
 */

export function getPhaseDurationSeconds(durations: PomodoroDurations, phase: PomodoroPhase): number {
  if (phase === 'short-break') return durations.shortBreakMinutes * 60
  if (phase === 'long-break') return durations.longBreakMinutes * 60
  return durations.workMinutes * 60
}

export function getPomodoroRemainingSeconds(state: PomodoroState, nowMs: number): number {
  if (state.runState !== 'running' || state.endTimestamp === null) {
    return state.remainingSeconds
  }
  return Math.max(0, Math.ceil((state.endTimestamp - nowMs) / 1000))
}

export function getDeviationElapsedSeconds(state: PomodoroState, nowMs: number): number {
  if (!state.isDeviationActive || state.deviationStartedAt === null) {
    return 0
  }
  return Math.max(0, Math.floor((nowMs - state.deviationStartedAt) / 1000))
}

export function getPomodoroPhaseLabel(phase: PomodoroPhase): string {
  if (phase === 'short-break') return 'Descanso corto'
  if (phase === 'long-break') return 'Descanso largo'
  return 'Trabajo'
}

export function formatPomodoroCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
