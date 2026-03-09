import {
  DEFAULT_POMODORO_LONG_BREAK_MINUTES,
  DEFAULT_POMODORO_SHORT_BREAK_MINUTES,
  DEFAULT_POMODORO_WORK_MINUTES,
  POMODORO_WORK_CYCLES_BEFORE_LONG_BREAK,
} from '../constants/taskManagerConstants'
import type { PomodoroDurations, PomodoroPhase, PomodoroRunState, PomodoroState } from '../types/taskManagerTypes'
import { isRecord } from '../utils/guards'

const MIN_DURATION_MINUTES = 1
const MAX_DURATION_MINUTES = 180

export function createDefaultPomodoroState(): PomodoroState {
  const durations = createDefaultPomodoroDurations()
  return {
    phase: 'work',
    runState: 'idle',
    remainingSeconds: getPhaseDurationSeconds(durations, 'work'),
    endTimestamp: null,
    completedWorkCycles: 0,
    selectedTaskPath: null,
    isDeviationActive: false,
    deviationStartedAt: null,
    deviationBaseRemainingSeconds: 0,
    phaseDeviationSeconds: 0,
    durations,
  }
}

export function createDefaultPomodoroDurations(): PomodoroDurations {
  return {
    workMinutes: DEFAULT_POMODORO_WORK_MINUTES,
    shortBreakMinutes: DEFAULT_POMODORO_SHORT_BREAK_MINUTES,
    longBreakMinutes: DEFAULT_POMODORO_LONG_BREAK_MINUTES,
  }
}

export function normalizePomodoroState(rawValue: unknown): PomodoroState {
  const fallback = createDefaultPomodoroState()
  if (!isRecord(rawValue)) {
    return fallback
  }

  const durations = normalizePomodoroDurations(rawValue.durations)
  const phase = normalizePomodoroPhase(rawValue.phase)
  const runState = normalizePomodoroRunState(rawValue.runState)
  const defaultRemaining = getPhaseDurationSeconds(durations, phase)
  const remainingSeconds = normalizeSeconds(rawValue.remainingSeconds, defaultRemaining)
  const endTimestamp = typeof rawValue.endTimestamp === 'number' && Number.isFinite(rawValue.endTimestamp)
    ? rawValue.endTimestamp
    : null
  const completedWorkCycles = typeof rawValue.completedWorkCycles === 'number' && Number.isFinite(rawValue.completedWorkCycles)
    ? Math.max(0, Math.floor(rawValue.completedWorkCycles))
    : 0
  const selectedTaskPath = typeof rawValue.selectedTaskPath === 'string' && rawValue.selectedTaskPath.trim().length > 0
    ? rawValue.selectedTaskPath
    : null
  const isDeviationActive = Boolean(rawValue.isDeviationActive)
  const deviationStartedAt = typeof rawValue.deviationStartedAt === 'number' && Number.isFinite(rawValue.deviationStartedAt)
    ? rawValue.deviationStartedAt
    : null
  const deviationBaseRemainingSeconds = normalizeSeconds(rawValue.deviationBaseRemainingSeconds, 0)
  const phaseDeviationSeconds = normalizeSeconds(rawValue.phaseDeviationSeconds, 0)

  return {
    phase,
    runState,
    remainingSeconds,
    endTimestamp,
    completedWorkCycles,
    selectedTaskPath,
    isDeviationActive,
    deviationStartedAt: isDeviationActive ? deviationStartedAt : null,
    deviationBaseRemainingSeconds: isDeviationActive ? deviationBaseRemainingSeconds : 0,
    phaseDeviationSeconds,
    durations,
  }
}

export function normalizePomodoroDurations(rawValue: unknown): PomodoroDurations {
  const fallback = createDefaultPomodoroDurations()
  if (!isRecord(rawValue)) {
    return fallback
  }

  return {
    workMinutes: clampMinutes(rawValue.workMinutes, fallback.workMinutes),
    shortBreakMinutes: clampMinutes(rawValue.shortBreakMinutes, fallback.shortBreakMinutes),
    longBreakMinutes: clampMinutes(rawValue.longBreakMinutes, fallback.longBreakMinutes),
  }
}

export function getPhaseDurationSeconds(durations: PomodoroDurations, phase: PomodoroPhase): number {
  if (phase === 'short-break') {
    return durations.shortBreakMinutes * 60
  }

  if (phase === 'long-break') {
    return durations.longBreakMinutes * 60
  }

  return durations.workMinutes * 60
}

export function getPomodoroRemainingSeconds(state: PomodoroState, nowMs: number): number {
  if (state.runState !== 'running' || state.endTimestamp === null) {
    return state.remainingSeconds
  }

  return Math.max(0, Math.ceil((state.endTimestamp - nowMs) / 1000))
}

export function startPomodoro(state: PomodoroState, nowMs: number): PomodoroState {
  if (state.runState === 'running' || state.isDeviationActive) {
    return state
  }

  const remainingSeconds = state.runState === 'paused'
    ? state.remainingSeconds
    : getPhaseDurationSeconds(state.durations, state.phase)

  return {
    ...state,
    runState: 'running',
    remainingSeconds,
    endTimestamp: nowMs + remainingSeconds * 1000,
  }
}

export function pausePomodoro(state: PomodoroState, nowMs: number): PomodoroState {
  if (state.runState !== 'running' || state.isDeviationActive) {
    return state
  }

  return {
    ...state,
    runState: 'paused',
    remainingSeconds: getPomodoroRemainingSeconds(state, nowMs),
    endTimestamp: null,
  }
}

export function resumePomodoro(state: PomodoroState, nowMs: number): PomodoroState {
  if (state.runState !== 'paused' || state.isDeviationActive) {
    return state
  }

  return {
    ...state,
    runState: 'running',
    endTimestamp: nowMs + state.remainingSeconds * 1000,
  }
}

export function resetPomodoro(state: PomodoroState): PomodoroState {
  return {
    ...state,
    runState: 'idle',
    remainingSeconds: getPhaseDurationSeconds(state.durations, state.phase),
    endTimestamp: null,
    isDeviationActive: false,
    deviationStartedAt: null,
    deviationBaseRemainingSeconds: 0,
    phaseDeviationSeconds: 0,
  }
}

export function applyPomodoroDurations(state: PomodoroState, durations: PomodoroDurations): PomodoroState {
  if (state.runState !== 'idle') {
    return { ...state, durations: { ...durations } }
  }

  return {
    ...state,
    durations: { ...durations },
    remainingSeconds: getPhaseDurationSeconds(durations, state.phase),
    endTimestamp: null,
  }
}

export function advancePomodoroState(
  state: PomodoroState,
  nowMs: number,
): { state: PomodoroState; completedPhases: PomodoroPhase[]; transitioned: boolean } {
  if (state.isDeviationActive || state.runState !== 'running' || state.endTimestamp === null) {
    return { state, completedPhases: [], transitioned: false }
  }

  let nextState = { ...state, durations: { ...state.durations } }
  const completedPhases: PomodoroPhase[] = []
  let transitioned = false

  while (nextState.endTimestamp !== null && nextState.endTimestamp <= nowMs) {
    completedPhases.push(nextState.phase)
    transitioned = true

    if (nextState.phase === 'work') {
      const completedWorkCycles = nextState.completedWorkCycles + 1
      const nextPhase: PomodoroPhase = completedWorkCycles % POMODORO_WORK_CYCLES_BEFORE_LONG_BREAK === 0
        ? 'long-break'
        : 'short-break'
      const nextDuration = getPhaseDurationSeconds(nextState.durations, nextPhase)
      nextState = {
        ...nextState,
        phase: nextPhase,
        completedWorkCycles,
        runState: 'running',
        remainingSeconds: nextDuration,
        endTimestamp: (nextState.endTimestamp ?? nowMs) + nextDuration * 1000,
      }
      continue
    }

    const nextDuration = getPhaseDurationSeconds(nextState.durations, 'work')
    nextState = {
      ...nextState,
      phase: 'work',
      runState: 'running',
      remainingSeconds: nextDuration,
      endTimestamp: (nextState.endTimestamp ?? nowMs) + nextDuration * 1000,
    }
  }

  const remainingSeconds = getPomodoroRemainingSeconds(nextState, nowMs)
  if (remainingSeconds !== nextState.remainingSeconds) {
    nextState = { ...nextState, remainingSeconds }
  }

  return { state: nextState, completedPhases, transitioned }
}

export function getDeviationElapsedSeconds(state: PomodoroState, nowMs: number): number {
  if (!state.isDeviationActive || state.deviationStartedAt === null) {
    return 0
  }

  return Math.max(0, Math.floor((nowMs - state.deviationStartedAt) / 1000))
}

export function enterPomodoroDeviation(state: PomodoroState, nowMs: number): PomodoroState {
  if (state.isDeviationActive || state.runState !== 'running') {
    return state
  }

  const remainingSeconds = getPomodoroRemainingSeconds(state, nowMs)
  return {
    ...state,
    runState: 'paused',
    remainingSeconds,
    endTimestamp: null,
    isDeviationActive: true,
    deviationStartedAt: nowMs,
    deviationBaseRemainingSeconds: remainingSeconds,
  }
}

export function exitPomodoroDeviation(
  state: PomodoroState,
  nowMs: number,
): { state: PomodoroState; elapsedSeconds: number; completedWork: boolean; overtimeSeconds: number } {
  if (!state.isDeviationActive) {
    return { state, elapsedSeconds: 0, completedWork: false, overtimeSeconds: 0 }
  }

  const elapsedSeconds = getDeviationElapsedSeconds(state, nowMs)
  const baseRemaining = Math.max(0, state.deviationBaseRemainingSeconds)

  const clearDeviation = (nextState: PomodoroState): PomodoroState => ({
    ...nextState,
    isDeviationActive: false,
    deviationStartedAt: null,
    deviationBaseRemainingSeconds: 0,
    phaseDeviationSeconds: nextState.phaseDeviationSeconds + elapsedSeconds,
  })

  if (state.phase !== 'work') {
    const remainingSeconds = Math.max(0, baseRemaining - elapsedSeconds)
    return {
      state: clearDeviation({
        ...state,
        runState: 'running',
        remainingSeconds,
        endTimestamp: nowMs + remainingSeconds * 1000,
      }),
      elapsedSeconds,
      completedWork: false,
      overtimeSeconds: 0,
    }
  }

  if (elapsedSeconds < baseRemaining) {
    const remainingSeconds = Math.max(0, baseRemaining - elapsedSeconds)
    return {
      state: clearDeviation({
        ...state,
        runState: 'running',
        remainingSeconds,
        endTimestamp: nowMs + remainingSeconds * 1000,
      }),
      elapsedSeconds,
      completedWork: false,
      overtimeSeconds: 0,
    }
  }

  const overtimeSeconds = elapsedSeconds - baseRemaining
  const completedWorkCycles = state.completedWorkCycles + 1
  const nextPhase: PomodoroPhase = completedWorkCycles % POMODORO_WORK_CYCLES_BEFORE_LONG_BREAK === 0
    ? 'long-break'
    : 'short-break'
  const baseBreakSeconds = getPhaseDurationSeconds(state.durations, nextPhase)
  const workDurationSeconds = Math.max(1, getPhaseDurationSeconds(state.durations, 'work'))
  const extraBreakSeconds = Math.round((overtimeSeconds * baseBreakSeconds) / workDurationSeconds)
  const nextBreakSeconds = baseBreakSeconds + extraBreakSeconds

  return {
    state: clearDeviation({
      ...state,
      phase: nextPhase,
      runState: 'running',
      completedWorkCycles,
      remainingSeconds: nextBreakSeconds,
      endTimestamp: nowMs + nextBreakSeconds * 1000,
    }),
    elapsedSeconds,
    completedWork: true,
    overtimeSeconds,
  }
}

export function getPomodoroPhaseLabel(phase: PomodoroPhase): string {
  if (phase === 'short-break') {
    return 'Descanso corto'
  }

  if (phase === 'long-break') {
    return 'Descanso largo'
  }

  return 'Trabajo'
}

export function formatPomodoroCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function clampMinutes(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, Math.round(value)))
}

function normalizePomodoroPhase(value: unknown): PomodoroPhase {
  if (value === 'work' || value === 'short-break' || value === 'long-break') {
    return value
  }

  return 'work'
}

function normalizePomodoroRunState(value: unknown): PomodoroRunState {
  if (value === 'idle' || value === 'running' || value === 'paused') {
    return value
  }

  return 'idle'
}

function normalizeSeconds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(0, Math.floor(value))
}
