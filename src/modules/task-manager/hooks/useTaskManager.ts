import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_BOARD_NAME,
  DEFAULT_BOARDS,
  TASKS_ROOT_FOLDER,
  TASK_PRIORITIES,
  TASK_STATES,
} from '../constants/taskManagerConstants'
import {
  advancePomodoroState,
  applyPomodoroDurations,
  enterPomodoroDeviation,
  exitPomodoroDeviation,
  getDeviationElapsedSeconds,
  getPhaseDurationSeconds,
  getPomodoroPhaseLabel,
  getPomodoroRemainingSeconds,
  pausePomodoro,
  resetPomodoro,
  resumePomodoro,
  startPomodoro,
} from '../engines/pomodoroEngine'
import type { Board, Group, PomodoroDurations, TaskFormData, TaskItem, TaskManagerSettings, TaskPriority, TaskState } from '../types/taskManagerTypes'
import type { TaskManagerVaultRef } from '../types/taskManagerTypes'
import { sanitizeFilename } from '../utils/sanitizeFilename'
import { loadTaskManagerSettings, saveTaskManagerSettings } from '../services/taskManagerStorage'
import {
  appendPomodoroEntry,
  cleanupEmptyWorkspaceBoards,
  createTask,
  deletePomodoroEntry,
  deleteTask,
  ensureBoardWorkspace,
  ensureTaskWorkspace,
  loadTaskManagerSnapshot,
  moveTaskByState,
  readPomodoroEntries,
  removeBoardWorkspace,
  readTaskMarkdownSource,
  renameBoardWorkspace,
  setTaskManagerRuntimeRootPolicy,
  syncTaskIndexesAndMetadata,
  updateTaskBody,
  updateTaskFrontmatter,
  writeTaskMarkdownSource,
  type TaskManagerSnapshot,
} from '../services/taskManagerService'
import {
  flushPendingTaskManagerLibraryTreeChanges,
  pickVaultDirectory,
  setActiveTaskManagerVaultContext,
} from '../services/vaultRuntime'
import { getRuntimeDevice } from '../../../utils/platform/getRuntimeDevice'
import { readTaskManagerVaultCache, writeTaskManagerVaultCache } from '../services/taskManagerVaultCache'

interface TaskDialogState {
  open: boolean
  mode: 'create' | 'edit'
  task: TaskItem | null
}

interface BoardDialogState {
  open: boolean
  mode: 'create' | 'edit'
  board: Board | null
}

interface GroupDialogState {
  open: boolean
  mode: 'create' | 'edit'
  group: Group | null
}

export interface UseTaskManagerResult {
  settings: TaskManagerSettings
  snapshot: TaskManagerSnapshot
  isLoading: boolean
  isSyncing: boolean
  error: string | null
  infoMessage: string | null
  taskDialog: TaskDialogState
  taskCreateDefaults: {
    parentTaskName?: string
    group?: string
  }
  boardDialog: BoardDialogState
  groupDialog: GroupDialogState
  taskStates: readonly TaskState[]
  taskPriorities: readonly TaskPriority[]
  setError: (value: string | null) => void
  setInfoMessage: (value: string | null) => void
  setActiveTab: (tab: string) => void
  setActiveVaultPath: (vault: TaskManagerVaultRef | null) => Promise<void>
  selectVault: () => Promise<void>
  reload: () => Promise<void>
  openTaskCreateDialog: (defaults?: { parentTaskName?: string; group?: string }) => void
  openTaskEditDialog: (task: TaskItem) => void
  closeTaskDialog: () => void
  submitTaskDialog: (formData: TaskFormData) => Promise<void>
  updateTaskState: (task: TaskItem, nextState: string) => Promise<void>
  updateTaskPriority: (task: TaskItem, nextPriority: TaskPriority) => Promise<void>
  updateTaskDedicatedHours: (task: TaskItem, nextDedicatedHours: number) => Promise<void>
  markTaskAsUrgent: (task: TaskItem) => Promise<void>
  toggleSubtaskDone: (task: TaskItem, done: boolean) => Promise<void>
  addTaskComment: (task: TaskItem, comment: string) => Promise<void>
  loadTaskSource: (taskPath: string) => Promise<string>
  saveTaskSource: (taskPath: string, content: string) => Promise<void>
  deleteTaskItem: (task: TaskItem) => Promise<void>
  openBoardCreateDialog: () => void
  openBoardEditDialog: (board: Board) => void
  closeBoardDialog: () => void
  submitBoardDialog: (payload: { name: string; color: string; activityHoursPerDay: number }) => Promise<void>
  removeBoard: (boardName: string) => Promise<void>
  openGroupCreateDialog: () => void
  openGroupEditDialog: (group: Group) => void
  closeGroupDialog: () => void
  submitGroupDialog: (payload: { name: string; color: string; board: string }) => Promise<void>
  removeGroup: (groupName: string, board: string) => Promise<void>
  reorderGroupsInBoard: (board: string, orderedGroupNames: string[]) => Promise<void>
  applyTaskArrangement: (updates: Array<{ taskPath: string; order: number; group?: string; parentTaskName?: string }>) => Promise<void>
  selectPomodoroTask: (taskPath: string | null) => void
  startPomodoroCycle: () => Promise<void>
  pausePomodoroCycle: () => void
  resumePomodoroCycle: () => void
  resetPomodoroCycle: () => void
  enterPomodoroDeviationMode: () => void
  exitPomodoroDeviationMode: () => Promise<void>
  setPomodoroDurations: (durations: PomodoroDurations) => void
  deletePomodoroLogEntry: (entryId: string) => Promise<void>
  isVaultExternallyControlled: boolean
}

const EMPTY_SNAPSHOT: TaskManagerSnapshot = {
  documents: [],
  tasks: [],
  pomodoroEntries: [],
}

const AUTO_COLOR_PALETTE = ['#2e6db0', '#00b894', '#7c5ce7', '#e17055', '#fd79a8', '#d97a1e', '#4caf50', '#636e72']
const FINISHED_TAB_ID = '__finished__'
const CANCELLED_TAB_ID = '__cancelled__'
const POMODORO_TAB_ID = '__pomodoro__'
const NON_BOARD_TABS = new Set([FINISHED_TAB_ID, CANCELLED_TAB_ID, POMODORO_TAB_ID])

function normalizeBoardCandidate(name: string): string | null {
  const normalized = name.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  if (normalized === 'finished' || normalized === 'cancelled') {
    return null
  }

  if (normalized.endsWith('.md')) {
    return null
  }

  if (normalized.includes('/') || normalized.includes('\\')) {
    return null
  }

  return normalized
}

function resolveBootstrapBoardsFromSnapshot(snapshot: TaskManagerSnapshot): Board[] {
  const boardsByName = new Map<string, Board>()

  for (const defaultBoard of DEFAULT_BOARDS) {
    if (!boardsByName.has(defaultBoard.name)) {
      boardsByName.set(defaultBoard.name, defaultBoard)
    }
  }

  for (const document of snapshot.documents) {
    const segments = document.path.split('/').filter(Boolean)
    if (segments.length < 2 || segments[0] !== TASKS_ROOT_FOLDER) {
      continue
    }

    const boardName = normalizeBoardCandidate(segments[1] ?? '')
    if (!boardName || boardsByName.has(boardName)) {
      continue
    }

    boardsByName.set(boardName, {
      name: boardName,
      color: AUTO_COLOR_PALETTE[boardsByName.size % AUTO_COLOR_PALETTE.length],
      activityHoursPerDay: 24,
    })
  }

  for (const task of snapshot.tasks) {
    const boardName = normalizeBoardCandidate(task.board) ?? DEFAULT_BOARD_NAME
    if (boardsByName.has(boardName)) {
      continue
    }

    boardsByName.set(boardName, {
      name: boardName,
      color: AUTO_COLOR_PALETTE[boardsByName.size % AUTO_COLOR_PALETTE.length],
      activityHoursPerDay: 24,
    })
  }

  return Array.from(boardsByName.values())
}

function resolveCleanupBoardCandidates(snapshot: TaskManagerSnapshot, extraBoardNames: string[] = []): string[] {
  const candidates = new Set<string>()

  for (const task of snapshot.tasks) {
    const boardName = normalizeBoardCandidate(task.board)
    if (boardName) {
      candidates.add(boardName)
    }
  }

  for (const document of snapshot.documents) {
    const segments = document.path.split('/').filter(Boolean)
    if (segments.length < 2 || segments[0] !== TASKS_ROOT_FOLDER) {
      continue
    }

    const boardName = normalizeBoardCandidate(segments[1] ?? '')
    if (boardName) {
      candidates.add(boardName)
    }
  }

  for (const boardName of extraBoardNames) {
    const normalized = normalizeBoardCandidate(boardName)
    if (normalized) {
      candidates.add(normalized)
    }
  }

  return Array.from(candidates)
}

function roundHours(value: number): number {
  return Number(value.toFixed(2))
}

function normalizeBoardActivityHours(value: number): number {
  if (!Number.isFinite(value)) {
    return 24
  }

  return Math.min(24, Math.max(0, Number(value.toFixed(2))))
}

function resolvePomodoroDurationChoice(durations: PomodoroDurations): string {
  return `${durations.workMinutes}/${durations.shortBreakMinutes}/${durations.longBreakMinutes}`
}

function resolveSettingsForEmptySnapshot(previousSettings: TaskManagerSettings): TaskManagerSettings {
  const nextActiveTab = NON_BOARD_TABS.has(previousSettings.activeTab)
    ? previousSettings.activeTab
    : previousSettings.boards.some((board) => board.name === previousSettings.activeTab)
      ? previousSettings.activeTab
      : previousSettings.boards[0]?.name ?? DEFAULT_BOARD_NAME

  return {
    ...previousSettings,
    activeTab: nextActiveTab,
  }
}

function areSameVaultRef(left: TaskManagerVaultRef | null, right: TaskManagerVaultRef | null): boolean {
  return (left?.path ?? '') === (right?.path ?? '')
    && (left?.androidTreeUri ?? '') === (right?.androidTreeUri ?? '')
}

function resolveCachedViewStateActiveTab(
  activeTab: string,
  boards: Board[],
): string {
  if (NON_BOARD_TABS.has(activeTab)) {
    return activeTab
  }

  return boards.some((board) => board.name === activeTab)
    ? activeTab
    : boards[0]?.name ?? DEFAULT_BOARD_NAME
}

export function useTaskManager(externalVault: TaskManagerVaultRef | null = null): UseTaskManagerResult {
  const activeVaultRef = useRef<TaskManagerVaultRef | null>(null)
  const isAndroidRuntime = useMemo(() => getRuntimeDevice() === 'Android', [])
  const [settings, setSettings] = useState<TaskManagerSettings>(() => loadTaskManagerSettings())
  const [snapshot, setSnapshot] = useState<TaskManagerSnapshot>(EMPTY_SNAPSHOT)
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)

  const [taskDialog, setTaskDialog] = useState<TaskDialogState>({
    open: false,
    mode: 'create',
    task: null,
  })
  const [taskCreateDefaults, setTaskCreateDefaults] = useState<{
    parentTaskName?: string
    group?: string
  }>({})
  const [boardDialog, setBoardDialog] = useState<BoardDialogState>({
    open: false,
    mode: 'create',
    board: null,
  })
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>({
    open: false,
    mode: 'create',
    group: null,
  })
  const isExternallyControlled = Boolean(externalVault?.path)

  useEffect(() => {
    if (!externalVault?.path) {
      return undefined
    }

    setTaskManagerRuntimeRootPolicy(externalVault.path, {
      forceInsideVault: true,
    })

    return () => {
      setTaskManagerRuntimeRootPolicy(externalVault.path, {
        forceInsideVault: false,
      })
    }
  }, [externalVault?.path])

  const updateSettings = useCallback((updater: (previous: TaskManagerSettings) => TaskManagerSettings) => {
    setSettings((previousSettings) => {
      const nextSettings = updater(previousSettings)
      saveTaskManagerSettings(
        isExternallyControlled
          ? {
            ...nextSettings,
            activeVaultPath: null,
          }
          : nextSettings,
      )
      return nextSettings
    })
  }, [isExternallyControlled])

  const hydrateSettingsFromSnapshot = useCallback((nextSnapshot: TaskManagerSnapshot) => {
    updateSettings((previousSettings) => {
      const previousBoardsByName = new Map(previousSettings.boards.map((board) => [board.name, board]))
      const previousGroupsByKey = new Map(
        previousSettings.groups.map((group) => [`${group.board ?? DEFAULT_BOARD_NAME}::${group.name}`, group]),
      )
      const boardsByName = new Map<string, Board>()

      for (const defaultBoard of DEFAULT_BOARDS) {
        boardsByName.set(defaultBoard.name, {
          ...defaultBoard,
          ...(previousBoardsByName.get(defaultBoard.name) ?? {}),
          activityHoursPerDay: normalizeBoardActivityHours(previousBoardsByName.get(defaultBoard.name)?.activityHoursPerDay ?? defaultBoard.activityHoursPerDay),
        })
      }

      for (const document of nextSnapshot.documents) {
        const segments = document.path.split('/').filter(Boolean)
        if (segments.length < 2 || segments[0] !== TASKS_ROOT_FOLDER) {
          continue
        }

        const boardName = normalizeBoardCandidate(segments[1] ?? '')
        if (!boardName || boardsByName.has(boardName)) {
          continue
        }

        const previousBoard = previousBoardsByName.get(boardName)
        boardsByName.set(boardName, {
          name: boardName,
          color: previousBoard?.color ?? AUTO_COLOR_PALETTE[boardsByName.size % AUTO_COLOR_PALETTE.length],
          activityHoursPerDay: normalizeBoardActivityHours(previousBoard?.activityHoursPerDay ?? 24),
        })
      }

      for (const task of nextSnapshot.tasks) {
        const boardName = normalizeBoardCandidate(task.board) ?? DEFAULT_BOARD_NAME
        if (!boardsByName.has(boardName)) {
          const previousBoard = previousBoardsByName.get(boardName)
          boardsByName.set(boardName, {
            name: boardName,
            color: previousBoard?.color ?? AUTO_COLOR_PALETTE[boardsByName.size % AUTO_COLOR_PALETTE.length],
            activityHoursPerDay: normalizeBoardActivityHours(previousBoard?.activityHoursPerDay ?? 24),
          })
        }
      }

      // Groups are user-managed settings. Tasks can reveal legacy groups that are
      // missing from settings, but an empty group must remain present after sync.
      const groupsByKey = new Map(previousGroupsByKey)
      for (const task of nextSnapshot.tasks) {
        if (task.state === 'Finalizada' || task.state === 'Cancelada') {
          continue
        }

        const boardName = normalizeBoardCandidate(task.board) ?? DEFAULT_BOARD_NAME

        const groupName = task.group.trim()
        if (!groupName) {
          continue
        }

        const key = `${boardName}::${groupName}`
        if (!groupsByKey.has(key)) {
          const previousGroup = previousGroupsByKey.get(key)
          groupsByKey.set(key, {
            name: groupName,
            color: previousGroup?.color ?? AUTO_COLOR_PALETTE[groupsByKey.size % AUTO_COLOR_PALETTE.length],
            board: boardName,
          })
        }
      }

      const nextBoards = Array.from(boardsByName.values())
      const nextGroups = Array.from(groupsByKey.values())
      const nextActiveTab = NON_BOARD_TABS.has(previousSettings.activeTab)
        ? previousSettings.activeTab
        : nextBoards.some((board) => board.name === previousSettings.activeTab)
          ? previousSettings.activeTab
          : nextBoards[0]?.name ?? DEFAULT_BOARD_NAME

      const sameBoards = nextBoards.length === previousSettings.boards.length
        && nextBoards.every((board, index) => (
          board.name === previousSettings.boards[index]?.name
          && board.color === previousSettings.boards[index]?.color
          && board.activityHoursPerDay === previousSettings.boards[index]?.activityHoursPerDay
        ))
      const sameGroups = nextGroups.length === previousSettings.groups.length
        && nextGroups.every((group, index) => (
          group.name === previousSettings.groups[index]?.name
          && group.color === previousSettings.groups[index]?.color
          && (group.board ?? DEFAULT_BOARD_NAME) === (previousSettings.groups[index]?.board ?? DEFAULT_BOARD_NAME)
        ))
      if (sameBoards && sameGroups && nextActiveTab === previousSettings.activeTab) {
        return previousSettings
      }

      return {
        ...previousSettings,
        boards: nextBoards,
        groups: nextGroups,
        activeTab: nextActiveTab,
      }
    })
  }, [updateSettings])

  const applySnapshotState = useCallback((nextSnapshot: TaskManagerSnapshot) => {
    startTransition(() => {
      setSnapshot(nextSnapshot)
      hydrateSettingsFromSnapshot(nextSnapshot)
    })
  }, [hydrateSettingsFromSnapshot])

  const applyCachedVaultState = useCallback((vault: TaskManagerVaultRef | null): boolean => {
    const cachedEntry = readTaskManagerVaultCache(vault)
    if (!cachedEntry) {
      return false
    }

    startTransition(() => {
      setSnapshot(cachedEntry.snapshot)
      updateSettings((previousSettings) => ({
        ...previousSettings,
        activeVaultPath: vault?.path ?? previousSettings.activeVaultPath,
        boards: cachedEntry.viewState.boards,
        groups: cachedEntry.viewState.groups,
        activeTab: resolveCachedViewStateActiveTab(cachedEntry.viewState.activeTab, cachedEntry.viewState.boards),
      }))
    })

    return true
  }, [updateSettings])

  useEffect(() => {
    if (!activeVaultRef.current?.path || !settings.activeVaultPath) {
      return
    }

    writeTaskManagerVaultCache(activeVaultRef.current, {
      snapshot,
      viewState: {
        boards: settings.boards,
        groups: settings.groups,
        activeTab: settings.activeTab,
      },
    })
  }, [settings.activeTab, settings.activeVaultPath, settings.boards, settings.groups, snapshot])

  const reload = useCallback(async () => {
    if (!settings.activeVaultPath) {
      applySnapshotState(EMPTY_SNAPSHOT)
      return
    }

    try {
      await syncTaskIndexesAndMetadata(
        settings.activeVaultPath,
        settings.boards.map((board) => board.name),
        settings.boards,
      )
    } catch (syncError) {
      console.warn('[task-manager] syncTaskIndexesAndMetadata failed on reload', syncError)
    }

    const nextSnapshot = await loadTaskManagerSnapshot(settings.activeVaultPath)
    applySnapshotState(nextSnapshot)
  }, [applySnapshotState, settings.activeVaultPath, settings.boards])

  const setActiveVaultPath = useCallback(async (vault: TaskManagerVaultRef | null) => {
    if (!vault?.path) {
      activeVaultRef.current = null
      setActiveTaskManagerVaultContext(null)
      updateSettings((previousSettings) => ({
        ...previousSettings,
        activeVaultPath: null,
      }))
      setSnapshot(EMPTY_SNAPSHOT)
      return
    }

    const normalizedVault: TaskManagerVaultRef = {
      path: vault.path,
      androidTreeUri: vault.androidTreeUri,
    }
    activeVaultRef.current = normalizedVault
    setActiveTaskManagerVaultContext(normalizedVault)
    applyCachedVaultState(normalizedVault)
    setIsLoading(true)
    try {
      const bootstrapSnapshot = await loadTaskManagerSnapshot(normalizedVault.path)
      if (bootstrapSnapshot.tasks.length === 0) {
        updateSettings((previousSettings) => resolveSettingsForEmptySnapshot(previousSettings))
        await cleanupEmptyWorkspaceBoards(
          normalizedVault.path,
          resolveCleanupBoardCandidates(bootstrapSnapshot),
        )
      }
      const bootstrapBoards = resolveBootstrapBoardsFromSnapshot(bootstrapSnapshot)
      await ensureTaskWorkspace(normalizedVault.path, bootstrapBoards)
      const nextSnapshot = await loadTaskManagerSnapshot(normalizedVault.path)
      applySnapshotState(nextSnapshot)
      updateSettings((previousSettings) => ({
        ...previousSettings,
        activeVaultPath: normalizedVault.path,
      }))
      setInfoMessage('Vault sincronizado.')
    } catch (runtimeError) {
      console.error(runtimeError)
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage
        ? `No se pudo inicializar el vault seleccionado: ${runtimeMessage}`
        : 'No se pudo inicializar el vault seleccionado.')
    } finally {
      setIsLoading(false)
    }
  }, [applyCachedVaultState, applySnapshotState, updateSettings])

  const selectVault = useCallback(async () => {
    const selected = await pickVaultDirectory()
    if (!selected) {
      return
    }

    await setActiveVaultPath(selected)
  }, [setActiveVaultPath])

  const bootstrapExternalVaultFast = useCallback(async (vault: TaskManagerVaultRef) => {
    const normalizedVault: TaskManagerVaultRef = {
      path: vault.path,
      androidTreeUri: vault.androidTreeUri,
    }

    activeVaultRef.current = normalizedVault
    setActiveTaskManagerVaultContext(normalizedVault)
    updateSettings((previousSettings) => ({
      ...previousSettings,
      activeVaultPath: normalizedVault.path,
    }))
    applyCachedVaultState(normalizedVault)
    setIsLoading(true)

    try {
      const bootstrapSnapshot = await loadTaskManagerSnapshot(normalizedVault.path)
      applySnapshotState(bootstrapSnapshot)
      setInfoMessage(null)

      void (async () => {
        try {
          if (bootstrapSnapshot.tasks.length === 0) {
            updateSettings((previousSettings) => resolveSettingsForEmptySnapshot(previousSettings))
            await cleanupEmptyWorkspaceBoards(
              normalizedVault.path,
              resolveCleanupBoardCandidates(bootstrapSnapshot),
            )
          }

          await ensureTaskWorkspace(
            normalizedVault.path,
            resolveBootstrapBoardsFromSnapshot(bootstrapSnapshot),
          )

          const refreshedSnapshot = await loadTaskManagerSnapshot(normalizedVault.path)
          applySnapshotState(refreshedSnapshot)
        } catch (runtimeError) {
          console.warn('[task-manager] Android fast bootstrap finalize failed', runtimeError)
        }
      })()
    } catch (runtimeError) {
      console.error(runtimeError)
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage
        ? `No se pudo inicializar el vault seleccionado: ${runtimeMessage}`
        : 'No se pudo inicializar el vault seleccionado.')
    } finally {
      setIsLoading(false)
    }
  }, [applyCachedVaultState, applySnapshotState, updateSettings])

  useEffect(() => {
    if (isExternallyControlled) {
      return
    }

    if (!settings.activeVaultPath) {
      activeVaultRef.current = null
      setActiveTaskManagerVaultContext(null)
      return
    }

    activeVaultRef.current = {
      path: settings.activeVaultPath,
    }
    setActiveTaskManagerVaultContext(activeVaultRef.current)
    applyCachedVaultState({
      path: settings.activeVaultPath,
    })
    setIsLoading(true)
    loadTaskManagerSnapshot(settings.activeVaultPath)
      .then(async (bootstrapSnapshot) => {
        if (bootstrapSnapshot.tasks.length === 0) {
          updateSettings((previousSettings) => resolveSettingsForEmptySnapshot(previousSettings))
          await cleanupEmptyWorkspaceBoards(
            settings.activeVaultPath as string,
            resolveCleanupBoardCandidates(bootstrapSnapshot),
          )
        }

        await ensureTaskWorkspace(
          settings.activeVaultPath as string,
          resolveBootstrapBoardsFromSnapshot(bootstrapSnapshot),
        )
      })
      .then(() => loadTaskManagerSnapshot(settings.activeVaultPath as string))
      .then((nextSnapshot) => {
        applySnapshotState(nextSnapshot)
      })
      .catch((runtimeError) => {
        console.error(runtimeError)
        const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
        setError(runtimeMessage
          ? `No se pudo cargar el estado del gestor de tareas: ${runtimeMessage}`
          : 'No se pudo cargar el estado del gestor de tareas.')
      })
      .finally(() => setIsLoading(false))
  }, [applyCachedVaultState, applySnapshotState, isExternallyControlled, settings.activeVaultPath, updateSettings])

  useEffect(() => {
    if (!externalVault?.path) {
      return
    }

    if (areSameVaultRef(externalVault, activeVaultRef.current)) {
      return
    }

    if (isAndroidRuntime) {
      void bootstrapExternalVaultFast(externalVault)
      return
    }

    void setActiveVaultPath(externalVault)
  }, [bootstrapExternalVaultFast, externalVault, isAndroidRuntime, setActiveVaultPath])

  useEffect(() => {
    if (!settings.activeVaultPath) {
      return
    }

    const interval = window.setInterval(() => {
      const now = Date.now()
      const completedPhases: string[] = []
      let didTransition = false

      setSettings((previousSettings) => {
        const transition = advancePomodoroState(previousSettings.pomodoro, now)
        didTransition = transition.transitioned
        completedPhases.push(...transition.completedPhases)

        const nextSettings = {
          ...previousSettings,
          pomodoro: transition.state,
        }
        saveTaskManagerSettings(nextSettings)
        return nextSettings
      })

      if (!didTransition || completedPhases.length === 0 || !settings.activeVaultPath) {
        return
      }

      const selectedTask = snapshot.tasks.find((task) => task.filePath === settings.pomodoro.selectedTaskPath)
      const completedWorkCycles = completedPhases.filter((phase) => phase === 'work').length
      const workedHours = roundHours((completedWorkCycles * settings.pomodoro.durations.workMinutes) / 60)
      const deviationHours = roundHours(settings.pomodoro.phaseDeviationSeconds / 3600)

      void (async () => {
        try {
          await Promise.all(completedPhases.map((phase, index) => appendPomodoroEntry(settings.activeVaultPath as string, {
            timestampMs: now,
            type: getPomodoroPhaseLabel(phase as 'work' | 'short-break' | 'long-break'),
            durationChoice: resolvePomodoroDurationChoice(settings.pomodoro.durations),
            task: selectedTask?.title ?? '-',
            durationMinutes: (phase === 'work' ? settings.pomodoro.durations.workMinutes : phase === 'short-break' ? settings.pomodoro.durations.shortBreakMinutes : settings.pomodoro.durations.longBreakMinutes),
            deviationHours: index === completedPhases.length - 1 ? deviationHours : 0,
            finalized: true,
          })))

          if (selectedTask && (workedHours > 0 || deviationHours > 0)) {
            await updateTaskFrontmatter(settings.activeVaultPath as string, selectedTask.filePath, {
              dedicado: roundHours(selectedTask.dedicatedHours + workedHours),
              desvio: roundHours(selectedTask.deviationHours + deviationHours),
            })
          }

          if (deviationHours > 0) {
            updateSettings((previousSettings) => ({
              ...previousSettings,
              pomodoro: {
                ...previousSettings.pomodoro,
                phaseDeviationSeconds: 0,
              },
            }))
          }

          const nextSnapshot = await loadTaskManagerSnapshot(settings.activeVaultPath as string)
          applySnapshotState(nextSnapshot)
        } catch (runtimeError) {
          console.error(runtimeError)
        }
      })()
    }, 1000)

    return () => window.clearInterval(interval)
  }, [applySnapshotState, settings.activeVaultPath, settings.pomodoro, snapshot.tasks, updateSettings])

  const runSync = useCallback(async (
    runner: () => Promise<void>,
    syncBoardsOverride?: Board[],
    options?: { syncStrategy?: 'full' | 'snapshot-only' },
  ) => {
    if (!settings.activeVaultPath) {
      throw new Error('No hay un vault activo.')
    }

    setIsSyncing(true)
    try {
      await runner()
      if ((options?.syncStrategy ?? 'full') === 'full') {
        try {
          await syncTaskIndexesAndMetadata(
            settings.activeVaultPath,
            (syncBoardsOverride ?? settings.boards).map((board) => board.name),
            syncBoardsOverride ?? settings.boards,
          )
        } catch (syncError) {
          console.warn('[task-manager] syncTaskIndexesAndMetadata failed after action', syncError)
        }
      }
      const nextSnapshot = await loadTaskManagerSnapshot(settings.activeVaultPath)
      applySnapshotState(nextSnapshot)
      flushPendingTaskManagerLibraryTreeChanges()
    } finally {
      setIsSyncing(false)
    }
  }, [applySnapshotState, settings.activeVaultPath, settings.boards])

  const openTaskCreateDialog = useCallback((defaults?: { parentTaskName?: string; group?: string }) => {
    setTaskCreateDefaults(defaults ?? {})
    setTaskDialog({ open: true, mode: 'create', task: null })
  }, [])

  const openTaskEditDialog = useCallback((task: TaskItem) => {
    setTaskDialog({ open: true, mode: 'edit', task })
  }, [])

  const closeTaskDialog = useCallback(() => {
    setTaskCreateDefaults({})
    setTaskDialog({ open: false, mode: 'create', task: null })
  }, [])

  const submitTaskDialog = useCallback(async (formData: TaskFormData) => {
    if (!settings.activeVaultPath) {
      setError('Seleccioná un vault antes de crear tareas.')
      return
    }

    try {
      await runSync(async () => {
        if (taskDialog.mode === 'create' || !taskDialog.task) {
          await createTask(settings.activeVaultPath as string, formData, snapshot.tasks)
          return
        }

        await updateTaskFrontmatter(settings.activeVaultPath as string, taskDialog.task.filePath, {
          tarea: formData.title,
          detalle: formData.detail,
          estado: formData.state,
          fechaFin: formData.endDate,
          fechaFinDinamica: formData.dynamicEndDate,
          equipo: formData.group,
          prioridad: formData.priority,
          estimacion: formData.estimatedHours,
          parent: formData.parentTaskName ? `[[${formData.parentTaskName}]]` : '',
        })
      })
      closeTaskDialog()
    } catch (runtimeError) {
      console.error(runtimeError)
      setError('No se pudo guardar la tarea.')
    }
  }, [closeTaskDialog, runSync, settings.activeVaultPath, snapshot.tasks, taskDialog.mode, taskDialog.task])

  const updateTaskState = useCallback(async (task: TaskItem, nextState: string) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        const existingPaths = new Set(snapshot.tasks.map((item) => item.filePath))
        await moveTaskByState(settings.activeVaultPath as string, task, nextState, existingPaths)
      })
    } catch (runtimeError) {
      console.error(runtimeError)
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage
        ? `No se pudo cambiar el estado de la tarea: ${runtimeMessage}`
        : 'No se pudo cambiar el estado de la tarea.')
    }
  }, [runSync, settings.activeVaultPath, snapshot.tasks])

  const updateTaskPriority = useCallback(async (task: TaskItem, nextPriority: TaskPriority) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        await updateTaskFrontmatter(settings.activeVaultPath as string, task.filePath, {
          prioridad: nextPriority,
        })
      }, undefined, { syncStrategy: 'snapshot-only' })
    } catch (runtimeError) {
      console.error(runtimeError)
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage
        ? `No se pudo cambiar la prioridad de la tarea: ${runtimeMessage}`
        : 'No se pudo cambiar la prioridad de la tarea.')
    }
  }, [runSync, settings.activeVaultPath])

  const updateTaskDedicatedHours = useCallback(async (task: TaskItem, nextDedicatedHours: number) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        await updateTaskFrontmatter(settings.activeVaultPath as string, task.filePath, {
          dedicado: roundHours(Math.max(0, nextDedicatedHours)),
        })
      }, undefined, { syncStrategy: 'snapshot-only' })
    } catch (runtimeError) {
      console.error(runtimeError)
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage
        ? `No se pudo actualizar horas dedicadas: ${runtimeMessage}`
        : 'No se pudo actualizar horas dedicadas.')
    }
  }, [runSync, settings.activeVaultPath])

  const markTaskAsUrgent = useCallback(async (task: TaskItem) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        await updateTaskFrontmatter(settings.activeVaultPath as string, task.filePath, {
          prioridad: 'Urgente',
          estado: task.state === 'Pendiente' ? 'En progreso' : task.state,
        })
      }, undefined, { syncStrategy: 'snapshot-only' })
    } catch (runtimeError) {
      console.error(runtimeError)
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage
        ? `No se pudo marcar la tarea como urgente: ${runtimeMessage}`
        : 'No se pudo marcar la tarea como urgente.')
    }
  }, [runSync, settings.activeVaultPath])

  const deleteTaskItem = useCallback(async (task: TaskItem) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(() => deleteTask(settings.activeVaultPath as string, task.filePath))
    } catch (runtimeError) {
      console.error(runtimeError)
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage
        ? `No se pudo eliminar la tarea: ${runtimeMessage}`
        : 'No se pudo eliminar la tarea.')
    }
  }, [runSync, settings.activeVaultPath])

  const toggleSubtaskDone = useCallback(async (task: TaskItem, done: boolean) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        await updateTaskFrontmatter(settings.activeVaultPath as string, task.filePath, {
          estado: done ? 'Finalizada' : 'Pendiente',
        })
      }, undefined, { syncStrategy: 'snapshot-only' })
    } catch (runtimeError) {
      console.error(runtimeError)
      setError('No se pudo actualizar la subtarea.')
    }
  }, [runSync, settings.activeVaultPath])

  const addTaskComment = useCallback(async (task: TaskItem, comment: string) => {
    if (!settings.activeVaultPath) {
      return
    }

    const normalizedComment = comment.trim()
    if (!normalizedComment) {
      return
    }

    try {
      await runSync(async () => {
        await updateTaskBody(settings.activeVaultPath as string, task.filePath, (currentContent) => {
          const timestamp = new Date().toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).replace(',', '')

          const commentLine = `## Comentario - ${timestamp}\n${normalizedComment}`
          const normalizedContent = currentContent.trimEnd()
          return `${normalizedContent}\n\n${commentLine}\n`
        })
      }, undefined, { syncStrategy: 'snapshot-only' })
    } catch (runtimeError) {
      console.error(runtimeError)
      setError('No se pudo agregar el comentario.')
    }
  }, [runSync, settings.activeVaultPath])

  const loadTaskSource = useCallback(async (taskPath: string): Promise<string> => {
    if (!settings.activeVaultPath) {
      throw new Error('No hay un vault activo.')
    }

    return readTaskMarkdownSource(settings.activeVaultPath, taskPath)
  }, [settings.activeVaultPath])

  const saveTaskSource = useCallback(async (taskPath: string, content: string) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        await writeTaskMarkdownSource(settings.activeVaultPath as string, taskPath, content)
      })
    } catch (runtimeError) {
      console.error(runtimeError)
      setError('No se pudo guardar el markdown de la tarea.')
    }
  }, [runSync, settings.activeVaultPath])

  const openBoardCreateDialog = useCallback(() => {
    setBoardDialog({ open: true, mode: 'create', board: null })
  }, [])

  const openBoardEditDialog = useCallback((board: Board) => {
    setBoardDialog({ open: true, mode: 'edit', board })
  }, [])

  const closeBoardDialog = useCallback(() => {
    setBoardDialog({ open: false, mode: 'create', board: null })
  }, [])

  const submitBoardDialog = useCallback(async (payload: { name: string; color: string; activityHoursPerDay: number }) => {
    const normalizedName = sanitizeFilename(payload.name).toLowerCase()
    if (!normalizedName) {
      setError('El tablero necesita un nombre válido.')
      return
    }

    const normalizedColor = payload.color || '#2e6db0'
    const normalizedActivityHoursPerDay = normalizeBoardActivityHours(payload.activityHoursPerDay)

    try {
      if (!settings.activeVaultPath) {
        return
      }

      if (boardDialog.mode === 'create') {
        if (settings.boards.some((board) => board.name === normalizedName)) {
          setError(`Ya existe un tablero llamado "${normalizedName}".`)
          return
        }

        const nextBoards = [...settings.boards, {
          name: normalizedName,
          color: normalizedColor,
          activityHoursPerDay: normalizedActivityHoursPerDay,
        }]
        updateSettings((previousSettings) => ({
          ...previousSettings,
          boards: nextBoards,
          activeTab: normalizedName,
        }))
        await ensureBoardWorkspace(settings.activeVaultPath, normalizedName)
        await runSync(async () => {}, nextBoards)
      } else if (boardDialog.board) {
        const previousName = boardDialog.board.name

        if (previousName !== normalizedName && settings.boards.some((board) => board.name === normalizedName)) {
          setError(`Ya existe un tablero llamado "${normalizedName}".`)
          return
        }

        const canRenameOrRecolor = previousName !== DEFAULT_BOARD_NAME
        const effectiveName = canRenameOrRecolor ? normalizedName : previousName
        const effectiveColor = canRenameOrRecolor ? normalizedColor : boardDialog.board.color

        if (canRenameOrRecolor && previousName !== effectiveName) {
          await renameBoardWorkspace(settings.activeVaultPath, previousName, effectiveName)
        }

        const nextBoards = settings.boards.map((board) => {
          if (board.name !== previousName) {
            return board
          }

          return {
            name: effectiveName,
            color: effectiveColor,
            activityHoursPerDay: normalizedActivityHoursPerDay,
          }
        })

        updateSettings((previousSettings) => ({
          ...previousSettings,
          boards: previousSettings.boards.map((board) => {
            if (board.name !== previousName) {
              return board
            }

            return {
              name: effectiveName,
              color: effectiveColor,
              activityHoursPerDay: normalizedActivityHoursPerDay,
            }
          }),
          groups: previousSettings.groups.map((group) => {
            if ((group.board ?? DEFAULT_BOARD_NAME) !== previousName) {
              return group
            }

            return {
              ...group,
              board: effectiveName,
            }
          }),
          activeTab: previousSettings.activeTab === previousName ? effectiveName : previousSettings.activeTab,
        }))
        await runSync(async () => {}, nextBoards)
      }
      closeBoardDialog()
    } catch (runtimeError) {
      console.error(runtimeError)
      setError('No se pudo guardar el tablero.')
    }
  }, [boardDialog.board, boardDialog.mode, closeBoardDialog, runSync, settings.activeVaultPath, settings.boards, updateSettings])

  const removeBoard = useCallback(async (boardName: string) => {
    if (!settings.activeVaultPath || boardName === DEFAULT_BOARD_NAME) {
      return
    }

    try {
      await removeBoardWorkspace(settings.activeVaultPath, boardName)
      const nextBoards = settings.boards.filter((board) => board.name !== boardName)
      updateSettings((previousSettings) => ({
        ...previousSettings,
        boards: previousSettings.boards.filter((board) => board.name !== boardName),
        groups: previousSettings.groups.filter((group) => (group.board ?? DEFAULT_BOARD_NAME) !== boardName),
        activeTab: previousSettings.activeTab === boardName ? DEFAULT_BOARD_NAME : previousSettings.activeTab,
      }))

      await runSync(async () => {}, nextBoards)
    } catch (runtimeError) {
      console.error(runtimeError)
      setError('No se pudo eliminar el tablero.')
    }
  }, [runSync, settings.activeVaultPath, settings.boards, updateSettings])

  const openGroupCreateDialog = useCallback(() => {
    setGroupDialog({ open: true, mode: 'create', group: null })
  }, [])

  const openGroupEditDialog = useCallback((group: Group) => {
    setGroupDialog({ open: true, mode: 'edit', group })
  }, [])

  const closeGroupDialog = useCallback(() => {
    setGroupDialog({ open: false, mode: 'create', group: null })
  }, [])

  const submitGroupDialog = useCallback(async (payload: { name: string; color: string; board: string }) => {
    const normalizedName = payload.name.trim()
    const normalizedBoard = payload.board.trim().toLowerCase() || DEFAULT_BOARD_NAME
    const normalizedColor = payload.color || '#2e6db0'

    if (!normalizedName) {
      setError('El grupo necesita un nombre válido.')
      return
    }

    if (!settings.boards.some((board) => board.name === normalizedBoard)) {
      setError(`No se encontró el tablero "${normalizedBoard}" para el grupo.`)
      return
    }

    if (groupDialog.mode === 'create') {
      const alreadyExists = settings.groups.some((group) => (
        group.name === normalizedName
        && (group.board ?? DEFAULT_BOARD_NAME) === normalizedBoard
      ))
      if (alreadyExists) {
        setError(`Ya existe un grupo llamado "${normalizedName}" en "${normalizedBoard}".`)
        return
      }
    } else if (groupDialog.group) {
      const originalBoard = groupDialog.group.board ?? DEFAULT_BOARD_NAME
      const originalName = groupDialog.group.name
      const collidesWithOtherGroup = settings.groups.some((group) => (
        group.name === normalizedName
        && (group.board ?? DEFAULT_BOARD_NAME) === normalizedBoard
        && !(group.name === originalName && (group.board ?? DEFAULT_BOARD_NAME) === originalBoard)
      ))
      if (collidesWithOtherGroup) {
        setError(`Ya existe un grupo llamado "${normalizedName}" en "${normalizedBoard}".`)
        return
      }
    }

    updateSettings((previousSettings) => {
      if (groupDialog.mode === 'create') {
        return {
          ...previousSettings,
          groups: [
            ...previousSettings.groups,
            {
              name: normalizedName,
              color: normalizedColor,
              board: normalizedBoard,
            },
          ],
        }
      }

      if (!groupDialog.group) {
        return previousSettings
      }

      return {
        ...previousSettings,
        groups: previousSettings.groups.map((group) => {
          if (group.name !== groupDialog.group?.name || (group.board ?? DEFAULT_BOARD_NAME) !== (groupDialog.group.board ?? DEFAULT_BOARD_NAME)) {
            return group
          }

          return {
            name: normalizedName,
            color: normalizedColor,
            board: normalizedBoard,
          }
        }),
      }
    })

    closeGroupDialog()
    setInfoMessage('Grupo actualizado.')
  }, [closeGroupDialog, groupDialog.group, groupDialog.mode, settings.boards, settings.groups, updateSettings])

  const removeGroup = useCallback(async (groupName: string, board: string) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        const candidateTasks = snapshot.tasks
          .filter((task) => task.board === board)
          .filter((task) => task.group === groupName)
          .filter((task) => task.state !== 'Finalizada' && task.state !== 'Cancelada')
        const candidateParentNames = new Set(
          candidateTasks.flatMap((task) => [task.title.trim().toLowerCase(), task.fileName.trim().toLowerCase()]).filter(Boolean),
        )
        const tasksToDismiss = candidateTasks.filter((task) => {
          const parentReference = task.parentTaskName.trim().toLowerCase()
          if (!parentReference) {
            return true
          }

          return !candidateParentNames.has(parentReference)
        })

        const existingPaths = new Set(snapshot.tasks.map((task) => task.filePath))
        for (const task of tasksToDismiss) {
          await moveTaskByState(settings.activeVaultPath as string, task, 'Cancelada', existingPaths)
        }

        updateSettings((previousSettings) => ({
          ...previousSettings,
          groups: previousSettings.groups.filter((group) => !(group.name === groupName && (group.board ?? DEFAULT_BOARD_NAME) === board)),
        }))
      })

      closeGroupDialog()
      setInfoMessage('Grupo eliminado.')
    } catch (runtimeError) {
      console.error(runtimeError)
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage
        ? `No se pudo eliminar el grupo: ${runtimeMessage}`
        : 'No se pudo eliminar el grupo.')
    }
  }, [closeGroupDialog, runSync, settings.activeVaultPath, snapshot.tasks, updateSettings])

  const reorderGroupsInBoard = useCallback(async (board: string, orderedGroupNames: string[]) => {
    const normalizedBoard = board.trim().toLowerCase() || DEFAULT_BOARD_NAME
    const uniqueNames = Array.from(new Set(orderedGroupNames.map((name) => name.trim()).filter(Boolean)))
    if (uniqueNames.length === 0) {
      return
    }

    updateSettings((previousSettings) => {
      const boardGroups = previousSettings.groups.filter((group) => (group.board ?? DEFAULT_BOARD_NAME) === normalizedBoard)
      if (boardGroups.length === 0) {
        return previousSettings
      }

      const byName = new Map(boardGroups.map((group) => [group.name, group]))
      const orderedBoardGroups: Group[] = []
      for (const name of uniqueNames) {
        const group = byName.get(name)
        if (group) {
          orderedBoardGroups.push(group)
          byName.delete(name)
        }
      }

      orderedBoardGroups.push(...Array.from(byName.values()))
      const boardGroupNameSet = new Set(boardGroups.map((group) => group.name))
      const outsideBoard = previousSettings.groups.filter((group) => !((group.board ?? DEFAULT_BOARD_NAME) === normalizedBoard && boardGroupNameSet.has(group.name)))

      return {
        ...previousSettings,
        groups: [...outsideBoard, ...orderedBoardGroups],
      }
    })
  }, [updateSettings])

  const applyTaskArrangement = useCallback(async (
    updates: Array<{ taskPath: string; order: number; group?: string; parentTaskName?: string }>,
  ) => {
    if (!settings.activeVaultPath || updates.length === 0) {
      return
    }

    const sanitizedUpdates = updates
      .map((update) => ({
        taskPath: update.taskPath,
        order: Number.isFinite(update.order) ? update.order : 999999,
        group: typeof update.group === 'string' ? update.group : undefined,
        parentTaskName: typeof update.parentTaskName === 'string' ? update.parentTaskName : undefined,
      }))
      .filter((update) => update.taskPath.trim().length > 0)

    if (sanitizedUpdates.length === 0) {
      return
    }

    try {
      await runSync(async () => {
        for (const update of sanitizedUpdates) {
          await updateTaskFrontmatter(settings.activeVaultPath as string, update.taskPath, {
            order: update.order,
            ...(typeof update.group === 'string' ? { equipo: update.group } : {}),
            ...(typeof update.parentTaskName === 'string'
              ? { parent: update.parentTaskName.trim() ? `[[${update.parentTaskName.trim()}]]` : '' }
              : {}),
          })
        }
      })
    } catch (runtimeError) {
      console.error(runtimeError)
      setError('No se pudo reordenar tareas/grupos.')
    }
  }, [runSync, settings.activeVaultPath])

  const selectPomodoroTask = useCallback((taskPath: string | null) => {
    updateSettings((previousSettings) => ({
      ...previousSettings,
      pomodoro: {
        ...previousSettings.pomodoro,
        selectedTaskPath: taskPath,
      },
    }))
  }, [updateSettings])

  const startPomodoroCycle = useCallback(async () => {
    updateSettings((previousSettings) => ({
      ...previousSettings,
      pomodoro: startPomodoro(previousSettings.pomodoro, Date.now()),
    }))
  }, [updateSettings])

  const pausePomodoroCycle = useCallback(() => {
    updateSettings((previousSettings) => ({
      ...previousSettings,
      pomodoro: pausePomodoro(previousSettings.pomodoro, Date.now()),
    }))
  }, [updateSettings])

  const resumePomodoroCycle = useCallback(() => {
    updateSettings((previousSettings) => ({
      ...previousSettings,
      pomodoro: resumePomodoro(previousSettings.pomodoro, Date.now()),
    }))
  }, [updateSettings])

  const resetPomodoroCycle = useCallback(() => {
    void (async () => {
      const now = Date.now()
      const currentPomodoro = settings.pomodoro
      const selectedTask = snapshot.tasks.find((task) => task.filePath === currentPomodoro.selectedTaskPath)

      const elapsedSeconds = currentPomodoro.isDeviationActive
        ? getDeviationElapsedSeconds(currentPomodoro, now)
        : Math.max(0, getPhaseDurationSeconds(currentPomodoro.durations, currentPomodoro.phase) - getPomodoroRemainingSeconds(currentPomodoro, now))

      const workedHours = currentPomodoro.phase === 'work' && !currentPomodoro.isDeviationActive
        ? roundHours(elapsedSeconds / 3600)
        : 0
      const deviationHours = roundHours((currentPomodoro.phaseDeviationSeconds + (currentPomodoro.isDeviationActive ? elapsedSeconds : 0)) / 3600)

      if (settings.activeVaultPath && (elapsedSeconds > 0 || deviationHours > 0)) {
        try {
          await appendPomodoroEntry(settings.activeVaultPath, {
            timestampMs: now,
            type: getPomodoroPhaseLabel(currentPomodoro.phase),
            durationChoice: resolvePomodoroDurationChoice(currentPomodoro.durations),
            task: selectedTask?.title ?? '-',
            durationMinutes: roundHours(elapsedSeconds / 60),
            deviationHours,
            finalized: false,
          })

          if (selectedTask && (workedHours > 0 || deviationHours > 0)) {
            await updateTaskFrontmatter(settings.activeVaultPath, selectedTask.filePath, {
              dedicado: roundHours(selectedTask.dedicatedHours + workedHours),
              desvio: roundHours(selectedTask.deviationHours + deviationHours),
            })
          }

          const nextSnapshot = await loadTaskManagerSnapshot(settings.activeVaultPath)
          applySnapshotState(nextSnapshot)
        } catch (runtimeError) {
          console.error(runtimeError)
        }
      }

      updateSettings((previousSettings) => ({
        ...previousSettings,
        pomodoro: resetPomodoro(previousSettings.pomodoro),
      }))
    })()
  }, [applySnapshotState, settings.activeVaultPath, settings.pomodoro, snapshot.tasks, updateSettings])

  const enterPomodoroDeviationMode = useCallback(() => {
    updateSettings((previousSettings) => ({
      ...previousSettings,
      pomodoro: enterPomodoroDeviation(previousSettings.pomodoro, Date.now()),
    }))
  }, [updateSettings])

  const exitPomodoroDeviationMode = useCallback(async () => {
    const now = Date.now()
    let elapsedSeconds = 0
    let completedWork = false
    let nextDurations: PomodoroDurations = settings.pomodoro.durations

    updateSettings((previousSettings) => {
      const result = exitPomodoroDeviation(previousSettings.pomodoro, now)
      elapsedSeconds = result.elapsedSeconds
      completedWork = result.completedWork
      nextDurations = result.state.durations
      return {
        ...previousSettings,
        pomodoro: result.state,
      }
    })

    if (!settings.activeVaultPath) {
      return
    }

    const selectedTask = snapshot.tasks.find((task) => task.filePath === settings.pomodoro.selectedTaskPath)
    const deviationHours = roundHours(elapsedSeconds / 3600)

    if (selectedTask && deviationHours > 0) {
      await updateTaskFrontmatter(settings.activeVaultPath, selectedTask.filePath, {
        desvio: roundHours(selectedTask.deviationHours + deviationHours),
      })
    }

    const durations = nextDurations
    if (completedWork) {
      if (selectedTask) {
        await updateTaskFrontmatter(settings.activeVaultPath, selectedTask.filePath, {
          dedicado: roundHours(selectedTask.dedicatedHours + roundHours(durations.workMinutes / 60)),
        })
      }

      await appendPomodoroEntry(settings.activeVaultPath, {
        timestampMs: now,
        type: getPomodoroPhaseLabel('work'),
        durationChoice: resolvePomodoroDurationChoice(durations),
        task: selectedTask?.title ?? '-',
        durationMinutes: durations.workMinutes,
        deviationHours,
        finalized: true,
      })
    } else {
      await appendPomodoroEntry(settings.activeVaultPath, {
        timestampMs: now,
        type: 'Desvío parcial',
        durationChoice: resolvePomodoroDurationChoice(durations),
        task: selectedTask?.title ?? '-',
        durationMinutes: roundHours(elapsedSeconds / 60),
        deviationHours,
        finalized: false,
      })
    }

    const nextSnapshot = await loadTaskManagerSnapshot(settings.activeVaultPath)
    applySnapshotState(nextSnapshot)
  }, [applySnapshotState, settings.activeVaultPath, settings.pomodoro.durations, settings.pomodoro.selectedTaskPath, snapshot.tasks, updateSettings])

  const setPomodoroDurations = useCallback((durations: PomodoroDurations) => {
    updateSettings((previousSettings) => ({
      ...previousSettings,
      pomodoro: applyPomodoroDurations(previousSettings.pomodoro, durations),
    }))
  }, [updateSettings])

  const deletePomodoroLogEntry = useCallback(async (entryId: string) => {
    if (!settings.activeVaultPath) {
      return
    }

    const deleted = await deletePomodoroEntry(settings.activeVaultPath, entryId)
    if (!deleted) {
      setError('No se pudo eliminar el registro de pomodoro.')
      return
    }

    const nextEntries = await readPomodoroEntries(settings.activeVaultPath)
    setSnapshot((previousSnapshot) => ({
      ...previousSnapshot,
      pomodoroEntries: nextEntries,
    }))
  }, [settings.activeVaultPath])

  const taskStates = useMemo(() => TASK_STATES, [])
  const taskPriorities = useMemo(() => TASK_PRIORITIES, [])

  return {
    settings,
    snapshot,
    isLoading,
    isSyncing,
    error,
    infoMessage,
    taskDialog,
    taskCreateDefaults,
    boardDialog,
    groupDialog,
    taskStates,
    taskPriorities,
    setError,
    setInfoMessage,
    setActiveTab: (tab: string) => updateSettings((previousSettings) => ({ ...previousSettings, activeTab: tab })),
    setActiveVaultPath,
    selectVault,
    reload,
    openTaskCreateDialog,
    openTaskEditDialog,
    closeTaskDialog,
    submitTaskDialog,
    updateTaskState,
    updateTaskPriority,
    updateTaskDedicatedHours,
    markTaskAsUrgent,
    toggleSubtaskDone,
    addTaskComment,
    loadTaskSource,
    saveTaskSource,
    deleteTaskItem,
    openBoardCreateDialog,
    openBoardEditDialog,
    closeBoardDialog,
    submitBoardDialog,
    removeBoard,
    openGroupCreateDialog,
    openGroupEditDialog,
    closeGroupDialog,
    submitGroupDialog,
    removeGroup,
    reorderGroupsInBoard,
    applyTaskArrangement,
    selectPomodoroTask,
    startPomodoroCycle,
    pausePomodoroCycle,
    resumePomodoroCycle,
    resetPomodoroCycle,
    enterPomodoroDeviationMode,
    exitPomodoroDeviationMode,
    setPomodoroDurations,
    deletePomodoroLogEntry,
    isVaultExternallyControlled: Boolean(externalVault?.path),
  }
}
