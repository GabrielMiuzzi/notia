import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  DEFAULT_BOARD_NAME,
  DEFAULT_BOARDS,
  TASK_MANAGER_SHARED_METADATA_FILE,
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
import { appendTaskComment } from '../engines/taskCommentEngine'
import {
  normalizeTaskArrangementUpdates,
  selectChangedTaskArrangementUpdates,
} from '../engines/orderEngine'
import type { Board, Group, PomodoroDurations, TaskFormData, TaskItem, TaskManagerSettings, TaskPriority, TaskState } from '../types/taskManagerTypes'
import type { TaskManagerVaultRef } from '../types/taskManagerTypes'
import { sanitizeFilename } from '../utils/sanitizeFilename'
import { loadTaskManagerSettings, saveTaskManagerSettings } from '../services/taskManagerStorage'
import { normalizeTaskManagerSettings } from '../utils/settings'
import {
  appendPomodoroEntry,
  cleanupEmptyWorkspaceBoards,
  createTask,
  deletePomodoroEntry,
  deleteTask,
  ensureBoardWorkspace,
  ensureTaskWorkspace,
  loadTaskManagerSnapshot,
  loadTaskManagerSnapshotForChangedPaths,
  moveTaskByState,
  readPomodoroEntries,
  removeBoardWorkspace,
  readTaskMarkdownSourceWithRevision,
  resolveTaskManagerSnapshotChangedPaths,
  resolveTaskManagerMutationJournalPath,
  renameBoardWorkspace,
  setTaskManagerRuntimeRootPolicy,
  syncTaskIndexesAndMetadata,
  updateTaskBody,
  updateTaskFrontmatter as updateTaskFrontmatterInSource,
  writeTaskMarkdownSource,
  type TaskManagerSnapshot,
} from '../services/taskManagerService'
import {
  mergeTaskManagerBoards,
  readTaskManagerSharedMetadata,
  writeTaskManagerSharedMetadata,
  type TaskManagerSharedMetadata,
} from '../services/taskManagerSharedMetadata'
import {
  flushPendingTaskManagerLibraryTreeChanges,
  pickVaultDirectory,
  setActiveTaskManagerVaultContext,
} from '../services/vaultRuntime'
import { getRuntimeDevice } from '../../../utils/platform/getRuntimeDevice'
import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'
import { readTaskManagerVaultCache, writeTaskManagerVaultCache } from '../services/taskManagerVaultCache'
import { dispatchTaskManagerMutation, subscribeTaskManagerMutations } from '../services/taskManagerMutationEvents'
import {
  beginTaskManagerPublicationBatch,
  endTaskManagerPublicationBatch,
  notifyTaskManagerPublicationChanged,
  setTaskManagerPublicationRecovery,
  syncTaskManagerPublicationSettings,
  withTaskManagerPublicationBatch,
  type TaskManagerPublicationCursor,
} from '../services/taskManagerPublicationRuntime'
import {
  subscribeTaskManagerPublicationChanges,
  invokeTaskManagerPublicationMutation,
  TaskManagerPublicationMutationError,
  type TaskManagerPublicationConflict,
} from '../services/taskManagerPublicationClient'
import { enqueueTaskManagerMutation, type TaskManagerMutationContext } from '../services/taskManagerMutationCoordinator'
import {
  drainTaskManagerReloadQueue,
  getTaskManagerReloadRetryDelay,
} from '../services/taskManagerReloadCoordinator'
import {
  beginTaskManagerMutationJournal,
  completeTaskManagerMutationJournal,
  recordTaskManagerMutationJournalChangedPaths,
} from '../services/taskManagerMutationJournal'

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
  publicationConflict: TaskManagerConflictDetails | null
  publicationCursor: TaskManagerPublicationCursor | null
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
  clearPublicationConflict: () => void
  reloadPublicationConflict: () => Promise<void>
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

type TaskManagerReloadRequest = (
  changedPaths?: string[],
  options?: { notifyExternalChange?: boolean; forceFullReload?: boolean },
) => Promise<void>

export interface TaskManagerConflictDetails {
  operationId: string
  command: string
  expectedRevision?: number
  currentRevision?: number
  actorId?: string
  conflictingOperationId?: string
}

function areTaskManagerSnapshotsEqual(
  leftSnapshot: TaskManagerSnapshot,
  rightSnapshot: TaskManagerSnapshot,
): boolean {
  if (leftSnapshot.documents.length !== rightSnapshot.documents.length) {
    return false
  }

  return leftSnapshot.documents.every((document, index) => {
    const rightDocument = rightSnapshot.documents[index]
    return rightDocument?.path === document.path && rightDocument.content === document.content
  })
}

function sharedTaskManagerSettingsFingerprint(settings: TaskManagerSettings): string {
  return JSON.stringify({ boards: settings.boards, groups: settings.groups })
}

function isSameOrNestedFilesystemPath(basePath: string, candidatePath: string): boolean {
  const normalizedBasePath = normalizeFilesystemPath(basePath).replace(/[\\/]+$/, '')
  const normalizedCandidatePath = normalizeFilesystemPath(candidatePath).replace(/[\\/]+$/, '')
  return normalizedCandidatePath === normalizedBasePath
    || normalizedCandidatePath.startsWith(`${normalizedBasePath}/`)
}

function reorderGroupsForBoard(
  groups: Group[],
  board: string,
  orderedGroupNames: string[],
): Group[] {
  const boardGroups = groups.filter((group) => (group.board ?? DEFAULT_BOARD_NAME) === board)
  if (boardGroups.length === 0) {
    return groups
  }

  const byName = new Map(boardGroups.map((group) => [group.name, group]))
  const orderedBoardGroups: Group[] = []
  for (const name of orderedGroupNames) {
    const group = byName.get(name)
    if (group) {
      orderedBoardGroups.push(group)
      byName.delete(name)
    }
  }

  orderedBoardGroups.push(...Array.from(byName.values()))
  const boardGroupNameSet = new Set(boardGroups.map((group) => group.name))
  const outsideBoard = groups.filter((group) => !(
    (group.board ?? DEFAULT_BOARD_NAME) === board
    && boardGroupNameSet.has(group.name)
  ))
  return [...outsideBoard, ...orderedBoardGroups]
}

export function useTaskManager(externalVault: TaskManagerVaultRef | null = null): UseTaskManagerResult {
  const activeVaultRef = useRef<TaskManagerVaultRef | null>(null)
  const taskSourceRevisionsRef = useRef(new Map<string, string>())
  const reloadStateRef = useRef<{
    inFlight: Promise<void> | null
    pending: boolean
    generation: number
    changedPaths: Set<string>
    forceFullReload: boolean
    notifyExternalChange: boolean
  }>({
    inFlight: null,
    pending: false,
    generation: 0,
    changedPaths: new Set(),
    forceFullReload: false,
    notifyExternalChange: false,
  })
  const reloadRequestRef = useRef<TaskManagerReloadRequest>(async () => undefined)
  const reloadRetryRef = useRef<{ timer: number | null; attempt: number }>({
    timer: null,
    attempt: 0,
  })
  const isAndroidRuntime = useMemo(() => getRuntimeDevice() === 'Android', [])
  const [settings, setSettings] = useState<TaskManagerSettings>(() => loadTaskManagerSettings())
  const [snapshot, setSnapshot] = useState<TaskManagerSnapshot>(EMPTY_SNAPSHOT)
  // Snapshot commits update this ref before scheduling React's transition.
  // An urgent render may still see older state and must not roll the ref back.
  const snapshotRef = useRef(snapshot)
  const localSyncInFlightRef = useRef(0)
  const [publicationCursor, setPublicationCursor] = useState<TaskManagerPublicationCursor | null>(null)
  const pendingExternalChangeRef = useRef<{
    fullReload: boolean
    paths: Set<string>
  }>({ fullReload: false, paths: new Set() })
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [publicationConflict, setPublicationConflict] = useState<TaskManagerConflictDetails | null>(null)

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

  const updateSettings = useCallback((
    updater: (previous: TaskManagerSettings) => TaskManagerSettings,
    options?: { syncPublication?: boolean },
  ) => {
    setSettings((previousSettings) => {
      const nextSettings = updater(previousSettings)
      saveTaskManagerSettings(
        isExternallyControlled
          ? {
            ...nextSettings,
            activeVaultPath: null,
          }
          : nextSettings,
        { syncPublication: options?.syncPublication === true },
      )
      return nextSettings
    })
  }, [isExternallyControlled])

  const hydrateSharedMetadata = useCallback(async (vaultPath: string): Promise<TaskManagerSharedMetadata | null> => {
    if (isExternallyControlled) {
      return null
    }

    const metadata = await readTaskManagerSharedMetadata(vaultPath)
    if (!metadata) {
      return null
    }

    updateSettings((previousSettings) => ({
      ...previousSettings,
      boards: metadata.boards,
      groups: metadata.groups,
    }), { syncPublication: false })
    return metadata
  }, [isExternallyControlled, updateSettings])

  const persistSharedMetadata = useCallback((vaultPath: string, nextSettings: Pick<TaskManagerSettings, 'boards' | 'groups'>, options?: { throwOnError?: boolean; enqueueMutation?: boolean }): Promise<void> => {
    if (isExternallyControlled) {
      return Promise.resolve()
    }

    const writeMetadata = () => writeTaskManagerSharedMetadata(vaultPath, nextSettings)
    const write = options?.enqueueMutation
      ? enqueueTaskManagerMutation(() => writeMetadata())
      : writeMetadata()
    return write.catch((metadataError: unknown) => {
      console.warn('[task-manager] no se pudo guardar la metadata compartida', metadataError)
      if (options?.throwOnError) {
        throw metadataError
      }
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
    snapshotRef.current = nextSnapshot
    startTransition(() => {
      setSnapshot(nextSnapshot)
      hydrateSettingsFromSnapshot(nextSnapshot)
    })
  }, [hydrateSettingsFromSnapshot])

  const resetReloadRetry = useCallback(() => {
    const retryState = reloadRetryRef.current
    if (retryState.timer !== null) {
      window.clearTimeout(retryState.timer)
      retryState.timer = null
    }
    retryState.attempt = 0
  }, [])

  const scheduleReloadRetry = useCallback(() => {
    const retryState = reloadRetryRef.current
    if (retryState.timer !== null) return
    const delay = getTaskManagerReloadRetryDelay(retryState.attempt)
    retryState.attempt += 1
    retryState.timer = window.setTimeout(() => {
      retryState.timer = null
      void reloadRequestRef.current([], { forceFullReload: true })
    }, delay)
  }, [])

  useEffect(() => {
    resetReloadRetry()
    return resetReloadRetry
  }, [resetReloadRetry, settings.activeVaultPath])

  const updateTaskFrontmatterCompat = useCallback(async (
    vaultPath: string,
    taskPath: string,
    updates: Record<string, unknown>,
  ): Promise<void> => {
    const normalizedTaskPath = normalizeFilesystemPath(taskPath).toLowerCase()
    const baseContent = snapshotRef.current.documents.find((document) => {
      const normalizedDocumentPath = normalizeFilesystemPath(document.path).toLowerCase()
      return normalizedDocumentPath === normalizedTaskPath || normalizedTaskPath.endsWith(`/${normalizedDocumentPath}`)
    })?.content
    await updateTaskFrontmatterInSource(vaultPath, taskPath, updates, { baseContent })
  }, [])

  const applyCachedVaultState = useCallback((vault: TaskManagerVaultRef | null): boolean => {
    const cachedEntry = readTaskManagerVaultCache(vault)
    if (!cachedEntry) {
      return false
    }

    snapshotRef.current = cachedEntry.snapshot
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

  const reload = useCallback(async (
    changedPaths: string[] = [],
    options?: { notifyExternalChange?: boolean; forceFullReload?: boolean },
  ) => {
    const reloadState = reloadStateRef.current
    if (options?.notifyExternalChange) {
      reloadState.notifyExternalChange = true
    }
    if (options?.forceFullReload) {
      reloadState.forceFullReload = true
    }
    for (const changedPath of changedPaths) {
      if (changedPath.trim()) {
        reloadState.changedPaths.add(changedPath)
      }
    }
    reloadState.generation += 1
    reloadState.pending = true
    await drainTaskManagerReloadQueue(reloadState, () => (
      // Accumulate watcher events before entering the FIFO so one read can
      // cover a burst without allowing reloads to race a mutation.
      enqueueTaskManagerMutation(async (mutationContext) => {
        while (reloadState.pending) {
          reloadState.pending = false
          const generation = reloadState.generation
          const pendingChangedPaths = Array.from(reloadState.changedPaths)
          reloadState.changedPaths.clear()
          const useTargetedReload = pendingChangedPaths.length > 0 && !reloadState.forceFullReload
          const shouldNotifyExternalChange = reloadState.notifyExternalChange
          reloadState.notifyExternalChange = false
          reloadState.forceFullReload = false
          if (!settings.activeVaultPath) {
            if (generation === reloadState.generation) applySnapshotState(EMPTY_SNAPSHOT)
            continue
          }

          try {
            const nextSnapshot = useTargetedReload
              ? await loadTaskManagerSnapshotForChangedPaths(
                settings.activeVaultPath,
                snapshotRef.current,
                pendingChangedPaths,
              )
              : await loadTaskManagerSnapshot(settings.activeVaultPath)
            if (generation === reloadState.generation) {
              if (
                shouldNotifyExternalChange
                && !window.__NOTIA_PUBLISHED_TASK_MANAGER__
                && !areTaskManagerSnapshotsEqual(snapshotRef.current, nextSnapshot)
              ) {
                try {
                  const publicationCursor = await notifyTaskManagerPublicationChanged(
                    settings.activeVaultPath,
                    loadTaskManagerSettings(),
                    resolveTaskManagerSnapshotChangedPaths(snapshotRef.current, nextSnapshot),
                    mutationContext,
                  )
                  setPublicationCursor(publicationCursor)
                } catch (publicationError) {
                  console.warn('[task-manager] external change publication notification failed', publicationError)
                }
              }
              applySnapshotState(nextSnapshot)
              resetReloadRetry()
            } else {
              reloadState.forceFullReload = true
              reloadState.notifyExternalChange ||= shouldNotifyExternalChange
            }
          } catch (reloadError) {
            console.warn('[task-manager] reload failed', reloadError)
            scheduleReloadRetry()
          }
        }
      })
    ))
  }, [applySnapshotState, resetReloadRetry, scheduleReloadRetry, settings.activeVaultPath])

  useEffect(() => {
    reloadRequestRef.current = reload
  }, [reload])

  useEffect(() => subscribeTaskManagerMutations((event) => {
    if (settings.activeVaultPath === event.vaultPath) {
      if (!window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
        setSettings(loadTaskManagerSettings())
      }
      void reload(event.changedPaths, { forceFullReload: event.forceFullReload === true })
    }
  }), [reload, settings.activeVaultPath])

  useEffect(() => {
    if (typeof window === 'undefined' || window.__NOTIA_PUBLISHED_TASK_MANAGER__ || !settings.activeVaultPath) {
      return undefined
    }

    const activeVaultPath = normalizeFilesystemPath(settings.activeVaultPath)
    const handleFilesystemChange = (event: Event) => {
      const detail = (event as CustomEvent<{ vaultPath?: string; pathHint?: string; source?: 'external' | 'internal' }>).detail
      if (detail?.source === 'internal') {
        return
      }
      const changedVaultPath = normalizeFilesystemPath(detail?.vaultPath ?? '')
      const changedPathHint = normalizeFilesystemPath(detail?.pathHint ?? '')
      const matchesVault = changedVaultPath
        ? changedVaultPath === activeVaultPath
        : changedPathHint
          ? isSameOrNestedFilesystemPath(activeVaultPath, changedPathHint)
          : true
      if (!matchesVault) {
        return
      }

      const targetedPath = changedPathHint.toLowerCase().endsWith('.md')
        ? [changedPathHint]
        : []
      if (localSyncInFlightRef.current > 0) {
        if (targetedPath.length === 0) {
          pendingExternalChangeRef.current.fullReload = true
        } else {
          targetedPath.forEach((path) => pendingExternalChangeRef.current.paths.add(path))
        }
        return
      }
      void reload(targetedPath, { notifyExternalChange: true })
    }

    window.addEventListener('notia:library-tree-changed', handleFilesystemChange)
    return () => window.removeEventListener('notia:library-tree-changed', handleFilesystemChange)
  }, [reload, settings.activeVaultPath])

  useEffect(() => {
    const vaultPath = settings.activeVaultPath
    if (!vaultPath || typeof window === 'undefined') {
      return undefined
    }

    if (window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
      return subscribeTaskManagerPublicationChanges((change) => {
        const sequence = change.sequence
        const revision = change.revision
        if (
          typeof change.publicationEpoch === 'string'
          && typeof sequence === 'number'
          && typeof revision === 'number'
          && Number.isSafeInteger(sequence)
          && Number.isSafeInteger(revision)
          && sequence >= 0
          && revision >= 0
        ) {
          setPublicationCursor({
            publicationEpoch: change.publicationEpoch,
            sequence,
            revision,
          })
        }
        if (change.settings && typeof change.settings === 'object') {
          const nextSettings = normalizeTaskManagerSettings(change.settings)
          setSettings((previousSettings) => {
            const sharedSettings = {
              ...nextSettings,
              activeVaultPath: previousSettings.activeVaultPath,
              activeTab: previousSettings.activeTab,
              pomodoro: previousSettings.pomodoro,
            }
            saveTaskManagerSettings(sharedSettings, { syncPublication: false })
            return sharedSettings
          })
        }
        if (change.type === 'changed' || change.type === 'resync-required') {
          // A publication event can represent a move/rename. Its path hints
          // are intentionally bounded and may contain only the source or the
          // destination, so the published client must reconcile from the
          // complete snapshot through the same queue as local interactions.
          dispatchTaskManagerMutation(vaultPath, change.changedPaths ?? [], { forceFullReload: true })
        }
      })
    }

    let disposed = false
    let unlisten: UnlistenFn | undefined
    void listen<unknown>('task-manager-publication-changed', (event) => {
      const payload = event.payload
      if (!payload || typeof payload !== 'object' || !('vaultPath' in payload)) {
        return
      }
      const changedVaultPath = payload.vaultPath
      if (typeof changedVaultPath === 'string' && changedVaultPath === vaultPath) {
        const publicationEpoch = 'publicationEpoch' in payload && typeof payload.publicationEpoch === 'string'
          ? payload.publicationEpoch
          : undefined
        const sequence = 'sequence' in payload && typeof payload.sequence === 'number' && Number.isSafeInteger(payload.sequence)
          ? payload.sequence
          : undefined
        const revision = 'revision' in payload && typeof payload.revision === 'number' && Number.isSafeInteger(payload.revision)
          ? payload.revision
          : undefined
        if (publicationEpoch && sequence !== undefined && revision !== undefined && sequence >= 0 && revision >= 0) {
          setPublicationCursor({ publicationEpoch, sequence, revision })
        }
        if ('settings' in payload && payload.settings && typeof payload.settings === 'object') {
          const nextSettings = normalizeTaskManagerSettings(payload.settings)
          setSettings((previousSettings) => {
            const sharedSettings = {
              ...nextSettings,
              activeVaultPath: previousSettings.activeVaultPath,
              activeTab: previousSettings.activeTab,
              pomodoro: previousSettings.pomodoro,
            }
            saveTaskManagerSettings(sharedSettings, { syncPublication: false })
            return sharedSettings
          })
        }
        const changedPaths = 'changedPaths' in payload && Array.isArray(payload.changedPaths)
          ? payload.changedPaths.filter((path): path is string => typeof path === 'string')
          : []
        dispatchTaskManagerMutation(vaultPath, changedPaths, { forceFullReload: true })
      }
    }).then((stopListening) => {
      if (disposed) {
        stopListening()
        return
      }
      unlisten = stopListening
    }).catch((error: unknown) => {
      console.warn('[task-manager] publication event listener unavailable', error)
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [settings.activeVaultPath])

  const recoverPartialTaskManagerPublicationBatch = useCallback(async (
    vaultPath: string,
    initialSnapshot: TaskManagerSnapshot,
    initialSettings: TaskManagerSettings,
    mutationContext: TaskManagerMutationContext,
  ): Promise<void> => {
    const recoverySnapshot = await loadTaskManagerSnapshot(vaultPath)
    const recoverySettings = loadTaskManagerSettings()
    const snapshotChanged = !areTaskManagerSnapshotsEqual(initialSnapshot, recoverySnapshot)
    const sharedSettingsChanged = sharedTaskManagerSettingsFingerprint(initialSettings)
      !== sharedTaskManagerSettingsFingerprint(recoverySettings)
    if (!snapshotChanged && !sharedSettingsChanged) {
      return
    }

    const publicationCursor = await notifyTaskManagerPublicationChanged(
      vaultPath,
      recoverySettings,
      resolveTaskManagerSnapshotChangedPaths(initialSnapshot, recoverySnapshot),
      mutationContext,
    )
    setPublicationCursor(publicationCursor)
    if (snapshotChanged) {
      applySnapshotState(recoverySnapshot)
      flushPendingTaskManagerLibraryTreeChanges()
    }
  }, [applySnapshotState])

  const ensureTaskWorkspaceWithPublication = useCallback(async (
    vaultPath: string,
    boards: Board[],
  ): Promise<void> => {
    const initialSnapshot = await loadTaskManagerSnapshot(vaultPath)
    const initialSettings = loadTaskManagerSettings()
    await withTaskManagerPublicationBatch(async () => {
      await ensureTaskWorkspace(vaultPath, boards)
    }, async (_result, mutationContext) => {
      const nextSnapshot = await loadTaskManagerSnapshot(vaultPath)
      if (areTaskManagerSnapshotsEqual(initialSnapshot, nextSnapshot)) {
        return
      }

      const publicationCursor = await notifyTaskManagerPublicationChanged(
        vaultPath,
        loadTaskManagerSettings(),
        resolveTaskManagerSnapshotChangedPaths(initialSnapshot, nextSnapshot),
        mutationContext,
      )
      setPublicationCursor(publicationCursor)
    }, {
      onFailure: (_error, mutationContext) => recoverPartialTaskManagerPublicationBatch(
        vaultPath,
        initialSnapshot,
        initialSettings,
        mutationContext,
      ),
    })
  }, [recoverPartialTaskManagerPublicationBatch])

  const cleanupEmptyWorkspaceBoardsWithPublication = useCallback(async (
    vaultPath: string,
    boardNames: string[],
  ): Promise<void> => {
    const initialSnapshot = await loadTaskManagerSnapshot(vaultPath)
    const initialSettings = loadTaskManagerSettings()
    await withTaskManagerPublicationBatch(async () => {
      await cleanupEmptyWorkspaceBoards(vaultPath, boardNames)
    }, async (_result, mutationContext) => {
      const nextSnapshot = await loadTaskManagerSnapshot(vaultPath)
      if (areTaskManagerSnapshotsEqual(initialSnapshot, nextSnapshot)) {
        return
      }

      const publicationCursor = await notifyTaskManagerPublicationChanged(
        vaultPath,
        loadTaskManagerSettings(),
        resolveTaskManagerSnapshotChangedPaths(initialSnapshot, nextSnapshot),
        mutationContext,
      )
      setPublicationCursor(publicationCursor)
    }, {
      onFailure: (_error, mutationContext) => recoverPartialTaskManagerPublicationBatch(
        vaultPath,
        initialSnapshot,
        initialSettings,
        mutationContext,
      ),
    })
  }, [recoverPartialTaskManagerPublicationBatch])

  const setActiveVaultPath = useCallback(async (vault: TaskManagerVaultRef | null) => {
    if (!vault?.path) {
      activeVaultRef.current = null
      setActiveTaskManagerVaultContext(null)
      updateSettings((previousSettings) => ({
        ...previousSettings,
        activeVaultPath: null,
      }))
      snapshotRef.current = EMPTY_SNAPSHOT
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
      if (isExternallyControlled) {
        const publishedSnapshot = await loadTaskManagerSnapshot(normalizedVault.path)
        applySnapshotState(publishedSnapshot)
        updateSettings((previousSettings) => ({
          ...previousSettings,
          activeVaultPath: normalizedVault.path,
        }))
        setInfoMessage(null)
        return
      }

      const sharedMetadata = await hydrateSharedMetadata(normalizedVault.path)
      const bootstrapSnapshot = await loadTaskManagerSnapshot(normalizedVault.path)
      if (bootstrapSnapshot.tasks.length === 0) {
        updateSettings((previousSettings) => resolveSettingsForEmptySnapshot(previousSettings))
        await cleanupEmptyWorkspaceBoardsWithPublication(
          normalizedVault.path,
          resolveCleanupBoardCandidates(bootstrapSnapshot),
        )
      }
      const storedSettings = loadTaskManagerSettings()
      const bootstrapBoards = sharedMetadata?.boards ?? mergeTaskManagerBoards(
        storedSettings.boards,
        resolveBootstrapBoardsFromSnapshot(bootstrapSnapshot),
      )
      await ensureTaskWorkspaceWithPublication(normalizedVault.path, bootstrapBoards)
      const nextSnapshot = await loadTaskManagerSnapshot(normalizedVault.path)
      applySnapshotState(nextSnapshot)
      if (!sharedMetadata) {
        persistSharedMetadata(normalizedVault.path, {
          boards: bootstrapBoards,
          groups: storedSettings.groups,
        }, { enqueueMutation: true })
      }
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
  }, [applyCachedVaultState, applySnapshotState, cleanupEmptyWorkspaceBoardsWithPublication, ensureTaskWorkspaceWithPublication, hydrateSharedMetadata, isExternallyControlled, persistSharedMetadata, updateSettings])

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
            await cleanupEmptyWorkspaceBoardsWithPublication(
              normalizedVault.path,
              resolveCleanupBoardCandidates(bootstrapSnapshot),
            )
          }

          await ensureTaskWorkspaceWithPublication(
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
  }, [applyCachedVaultState, applySnapshotState, cleanupEmptyWorkspaceBoardsWithPublication, ensureTaskWorkspaceWithPublication, updateSettings])

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
    void hydrateSharedMetadata(settings.activeVaultPath)
      .then((sharedMetadata) => loadTaskManagerSnapshot(settings.activeVaultPath as string)
        .then(async (bootstrapSnapshot) => {
          if (bootstrapSnapshot.tasks.length === 0) {
            updateSettings((previousSettings) => resolveSettingsForEmptySnapshot(previousSettings))
            await cleanupEmptyWorkspaceBoardsWithPublication(
              settings.activeVaultPath as string,
              resolveCleanupBoardCandidates(bootstrapSnapshot),
            )
          }

          const storedSettings = loadTaskManagerSettings()
          const bootstrapBoards = sharedMetadata?.boards ?? mergeTaskManagerBoards(
            storedSettings.boards,
            resolveBootstrapBoardsFromSnapshot(bootstrapSnapshot),
          )
          await ensureTaskWorkspaceWithPublication(
            settings.activeVaultPath as string,
            bootstrapBoards,
          )
          if (!sharedMetadata) {
            persistSharedMetadata(settings.activeVaultPath as string, {
              boards: bootstrapBoards,
              groups: storedSettings.groups,
            }, { enqueueMutation: true })
          }
        }))
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
  }, [applyCachedVaultState, applySnapshotState, cleanupEmptyWorkspaceBoardsWithPublication, ensureTaskWorkspaceWithPublication, hydrateSharedMetadata, isExternallyControlled, persistSharedMetadata, settings.activeVaultPath, updateSettings])

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
        saveTaskManagerSettings(nextSettings, { syncPublication: false })
        return nextSettings
      })

      if (!didTransition || completedPhases.length === 0 || !settings.activeVaultPath) {
        return
      }

      const selectedTask = snapshot.tasks.find((task) => task.filePath === settings.pomodoro.selectedTaskPath)
      const completedWorkCycles = completedPhases.filter((phase) => phase === 'work').length
      const workedHours = roundHours((completedWorkCycles * settings.pomodoro.durations.workMinutes) / 60)
      const deviationHours = roundHours(settings.pomodoro.phaseDeviationSeconds / 3600)
      const initialSharedSettings = loadTaskManagerSettings()

      void (async () => {
        try {
          await withTaskManagerPublicationBatch(async () => {
            for (const [index, phase] of completedPhases.entries()) {
              await appendPomodoroEntry(settings.activeVaultPath as string, {
                timestampMs: now,
                type: getPomodoroPhaseLabel(phase as 'work' | 'short-break' | 'long-break'),
                durationChoice: resolvePomodoroDurationChoice(settings.pomodoro.durations),
                task: selectedTask?.title ?? '-',
                durationMinutes: (phase === 'work' ? settings.pomodoro.durations.workMinutes : phase === 'short-break' ? settings.pomodoro.durations.shortBreakMinutes : settings.pomodoro.durations.longBreakMinutes),
                deviationHours: index === completedPhases.length - 1 ? deviationHours : 0,
                finalized: true,
              })
            }

            if (selectedTask && (workedHours > 0 || deviationHours > 0)) {
              await updateTaskFrontmatterCompat(settings.activeVaultPath as string, selectedTask.filePath, {
                dedicado: roundHours(selectedTask.dedicatedHours + workedHours),
                desvio: roundHours(selectedTask.deviationHours + deviationHours),
              })
            }
          }, async (_result, mutationContext) => {
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
            await notifyTaskManagerPublicationChanged(
              settings.activeVaultPath as string,
              loadTaskManagerSettings(),
              resolveTaskManagerSnapshotChangedPaths(snapshot, nextSnapshot),
              mutationContext,
            )
          }, {
            vaultPath: settings.activeVaultPath as string,
            scopes: ['task-manager', 'pomodoro'],
            changedPaths: [`${TASKS_ROOT_FOLDER}/pomodoro.md`],
            onFailure: (_error, mutationContext) => recoverPartialTaskManagerPublicationBatch(
              settings.activeVaultPath as string,
              snapshot,
              initialSharedSettings,
              mutationContext,
            ),
          })
        } catch (runtimeError) {
          console.error(runtimeError)
        }
      })()
    }, 1000)

    return () => window.clearInterval(interval)
  }, [applySnapshotState, recoverPartialTaskManagerPublicationBatch, settings.activeVaultPath, settings.pomodoro, snapshot, updateSettings, updateTaskFrontmatterCompat])

  const runSync = useCallback(async (
    runner: () => Promise<void>,
    syncBoardsOverride?: Board[],
    options?: {
      syncStrategy?: 'full' | 'snapshot-only'
      publicationSettings?: TaskManagerSettings
    },
  ) => {
    return enqueueTaskManagerMutation(async (mutationContext) => {
      if (!settings.activeVaultPath) {
        throw new Error('No hay un vault activo.')
      }

      setIsSyncing(true)
      localSyncInFlightRef.current += 1
      const initialSnapshot = snapshotRef.current
      const initialSharedSettings = loadTaskManagerSettings()
      let journalPath: string | undefined
      let journalActive = false
      let publicationBatchActive = false
      let publicationNotificationVerified = true
      try {
      if (!(typeof window !== 'undefined' && window.__NOTIA_PUBLISHED_TASK_MANAGER__ === true)) {
        journalPath = await resolveTaskManagerMutationJournalPath(settings.activeVaultPath)
        await beginTaskManagerMutationJournal(journalPath, mutationContext.operationId, ['task-manager'])
        journalActive = true
      }
      publicationBatchActive = await beginTaskManagerPublicationBatch(mutationContext.operationId)
      await runner()
      if (
        (options?.syncStrategy ?? 'full') === 'full'
        && !(typeof window !== 'undefined' && window.__NOTIA_PUBLISHED_TASK_MANAGER__ === true)
      ) {
        try {
          await syncTaskIndexesAndMetadata(
            settings.activeVaultPath,
            (syncBoardsOverride ?? settings.boards).map((board) => board.name),
            syncBoardsOverride ?? settings.boards,
          )
        } catch (syncError) {
          console.warn('[task-manager] syncTaskIndexesAndMetadata failed after action', syncError)
          throw syncError
        }
      }
      if (options?.publicationSettings) {
        await persistSharedMetadata(settings.activeVaultPath, options.publicationSettings, { throwOnError: true })
      }
      const nextSnapshot = await loadTaskManagerSnapshot(settings.activeVaultPath)
      const snapshotChanged = !areTaskManagerSnapshotsEqual(initialSnapshot, nextSnapshot)
      const changedPaths = resolveTaskManagerSnapshotChangedPaths(initialSnapshot, nextSnapshot)
      if (journalPath && journalActive) {
        await recordTaskManagerMutationJournalChangedPaths(
          journalPath,
          mutationContext.operationId,
          changedPaths,
        )
      }
      if (snapshotChanged || options?.publicationSettings) {
        try {
          const publicationCursor = await notifyTaskManagerPublicationChanged(
            settings.activeVaultPath,
            options?.publicationSettings ?? loadTaskManagerSettings(),
            changedPaths,
            mutationContext,
          )
          setPublicationCursor(publicationCursor)
        } catch (publicationError) {
          publicationNotificationVerified = false
          try {
            await setTaskManagerPublicationRecovery(true)
          } catch (recoveryError) {
            console.warn('[task-manager] no se pudo marcar la notificación de publicación como pendiente', recoveryError)
          }
          console.warn('[task-manager] publication change notification failed', publicationError)
        }
      }
      applySnapshotState(nextSnapshot)
      flushPendingTaskManagerLibraryTreeChanges()
      setPublicationConflict(null)
      if (publicationBatchActive) {
        const completedCursor = await endTaskManagerPublicationBatch(mutationContext.operationId)
        publicationBatchActive = false
        if (completedCursor) {
          setPublicationCursor(completedCursor)
        }
      }
      if (journalPath && journalActive) {
        try {
          await completeTaskManagerMutationJournal(journalPath, mutationContext.operationId, 'committed')
          journalActive = false
        } catch (journalError) {
          console.warn('[task-manager] no se pudo cerrar el journal de la mutación aplicada', journalError)
        }
      }
      if ((!journalPath || !journalActive) && publicationNotificationVerified) {
        try {
          await setTaskManagerPublicationRecovery(false)
        } catch (recoveryError) {
          console.warn('[task-manager] no se pudo confirmar el estado verificado de la publicación', recoveryError)
        }
      }
    } catch (runtimeError) {
      try {
        await setTaskManagerPublicationRecovery(true)
      } catch (recoveryError) {
        console.warn('[task-manager] no se pudo marcar la publicación en recuperación', recoveryError)
      }
      try {
        const recoverySnapshot = await loadTaskManagerSnapshot(settings.activeVaultPath)
        const recoverySettings = loadTaskManagerSettings()
        const sharedSettingsChanged = sharedTaskManagerSettingsFingerprint(initialSharedSettings)
          !== sharedTaskManagerSettingsFingerprint(recoverySettings)
        const snapshotChanged = !areTaskManagerSnapshotsEqual(initialSnapshot, recoverySnapshot)
        const changedPaths = resolveTaskManagerSnapshotChangedPaths(initialSnapshot, recoverySnapshot)
        if (journalPath && journalActive) {
          try {
            await recordTaskManagerMutationJournalChangedPaths(
              journalPath,
              mutationContext.operationId,
              changedPaths,
            )
          } catch (journalError) {
            console.warn('[task-manager] no se pudo registrar el alcance parcial de la mutación', journalError)
          }
        }
        if (snapshotChanged || sharedSettingsChanged) {
          try {
            await notifyTaskManagerPublicationChanged(
              settings.activeVaultPath,
              recoverySettings,
              changedPaths,
              mutationContext,
            )
          } catch (publicationError) {
            console.warn('[task-manager] no se pudo anunciar una mutación parcial', publicationError)
          }
          try {
            await setTaskManagerPublicationRecovery(true)
          } catch (recoveryError) {
            console.warn('[task-manager] no se pudo marcar la publicación en recuperación', recoveryError)
          }
          applySnapshotState(recoverySnapshot)
          flushPendingTaskManagerLibraryTreeChanges()
        } else if (journalPath && journalActive) {
          try {
            await setTaskManagerPublicationRecovery(true)
          } catch (recoveryError) {
            console.warn('[task-manager] no se pudo preparar el estado de recuperación', recoveryError)
          }
          try {
            await completeTaskManagerMutationJournal(journalPath, mutationContext.operationId, 'rolled-back')
            journalActive = false
            await setTaskManagerPublicationRecovery(false)
          } catch (journalError) {
            console.warn('[task-manager] no se pudo marcar el rollback de la mutación', journalError)
          }
        }
      } catch (recoveryError) {
        console.warn('[task-manager] no se pudo recuperar el snapshot tras un error', recoveryError)
        try {
          await setTaskManagerPublicationRecovery(true)
        } catch (publicationRecoveryError) {
          console.warn('[task-manager] no se pudo marcar la recuperación pendiente', publicationRecoveryError)
        }
      }
      if (runtimeError instanceof TaskManagerPublicationMutationError && runtimeError.conflict) {
        const conflict: TaskManagerPublicationConflict = runtimeError.conflict
        setPublicationConflict({
          operationId: runtimeError.operationId,
          command: runtimeError.command,
          expectedRevision: conflict.expectedRevision,
          currentRevision: conflict.currentRevision,
          actorId: conflict.actorId,
          conflictingOperationId: conflict.operationId,
        })
      }
      throw runtimeError
    } finally {
      if (publicationBatchActive) {
        try {
          const completedCursor = await endTaskManagerPublicationBatch(mutationContext.operationId)
          publicationBatchActive = false
          if (completedCursor) {
            setPublicationCursor(completedCursor)
          }
        } catch (batchError) {
          console.warn('[task-manager] no se pudo cerrar el lote de publicación', batchError)
        }
      }
      localSyncInFlightRef.current = Math.max(0, localSyncInFlightRef.current - 1)
      if (localSyncInFlightRef.current === 0) {
        const pendingExternalChange = pendingExternalChangeRef.current
        pendingExternalChangeRef.current = { fullReload: false, paths: new Set() }
        if (pendingExternalChange.fullReload || pendingExternalChange.paths.size > 0) {
          void reload(
            pendingExternalChange.fullReload ? [] : Array.from(pendingExternalChange.paths),
            { notifyExternalChange: true },
          )
        }
      }
      setIsSyncing(false)
      }
    })
  }, [applySnapshotState, persistSharedMetadata, reload, settings.activeVaultPath, settings.boards])

  const clearPublicationConflict = useCallback(() => {
    setPublicationConflict(null)
  }, [])

  const reloadPublicationConflict = useCallback(async () => {
    await reload()
    setPublicationConflict(null)
  }, [reload])

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
          await createTask(settings.activeVaultPath as string, formData, snapshotRef.current.tasks)
          return
        }

        await updateTaskFrontmatterCompat(settings.activeVaultPath as string, taskDialog.task.filePath, {
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
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      const publicationError = runtimeError instanceof TaskManagerPublicationMutationError
      setError(publicationError && runtimeError.outcome === 'unknown'
        ? 'La operación no fue confirmada por la publicación. Actualizá el tablero antes de volver a crear la tarea.'
        : runtimeMessage
          ? `No se pudo guardar la tarea: ${runtimeMessage}`
          : 'No se pudo guardar la tarea.')
    }
  }, [closeTaskDialog, runSync, settings.activeVaultPath, taskDialog.mode, taskDialog.task, updateTaskFrontmatterCompat])

  const updateTaskState = useCallback(async (task: TaskItem, nextState: string) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        const existingPaths = new Set(snapshotRef.current.tasks.map((item) => item.filePath))
        await moveTaskByState(settings.activeVaultPath as string, task, nextState, existingPaths)
      })
    } catch (runtimeError) {
      console.error(runtimeError)
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage
        ? `No se pudo cambiar el estado de la tarea: ${runtimeMessage}`
        : 'No se pudo cambiar el estado de la tarea.')
    }
  }, [runSync, settings.activeVaultPath])

  const updateTaskPriority = useCallback(async (task: TaskItem, nextPriority: TaskPriority) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        await updateTaskFrontmatterCompat(settings.activeVaultPath as string, task.filePath, {
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
  }, [runSync, settings.activeVaultPath, updateTaskFrontmatterCompat])

  const updateTaskDedicatedHours = useCallback(async (task: TaskItem, nextDedicatedHours: number) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        await updateTaskFrontmatterCompat(settings.activeVaultPath as string, task.filePath, {
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
  }, [runSync, settings.activeVaultPath, updateTaskFrontmatterCompat])

  const markTaskAsUrgent = useCallback(async (task: TaskItem) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        await updateTaskFrontmatterCompat(settings.activeVaultPath as string, task.filePath, {
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
  }, [runSync, settings.activeVaultPath, updateTaskFrontmatterCompat])

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
        await updateTaskFrontmatterCompat(settings.activeVaultPath as string, task.filePath, {
          estado: done ? 'Finalizada' : 'Pendiente',
        })
      }, undefined, { syncStrategy: 'snapshot-only' })
    } catch (runtimeError) {
      console.error(runtimeError)
      setError('No se pudo actualizar la subtarea.')
    }
  }, [runSync, settings.activeVaultPath, updateTaskFrontmatterCompat])

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
        if (typeof window !== 'undefined' && window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
          await invokeTaskManagerPublicationMutation({
            command: 'append_task_comment',
            args: {
              payload: {
                filePath: task.filePath,
                comment: normalizedComment,
              },
            },
          })
          return
        }
        await updateTaskBody(settings.activeVaultPath as string, task.filePath, (currentContent) => {
          return appendTaskComment(currentContent, normalizedComment)
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

    const source = await readTaskMarkdownSourceWithRevision(settings.activeVaultPath, taskPath)
    if (source.revision) {
      taskSourceRevisionsRef.current.set(taskPath, source.revision)
    }
    return source.content
  }, [settings.activeVaultPath])

  const saveTaskSource = useCallback(async (taskPath: string, content: string) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      await runSync(async () => {
        await writeTaskMarkdownSource(
          settings.activeVaultPath as string,
          taskPath,
          content,
          taskSourceRevisionsRef.current.get(taskPath),
        )
        taskSourceRevisionsRef.current.delete(taskPath)
      })
    } catch (runtimeError) {
      console.error(runtimeError)
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message : ''
      const publicationConflict = runtimeError instanceof TaskManagerPublicationMutationError
        ? runtimeError.conflict
        : undefined
      setError(publicationConflict
        ? `Los cambios compartidos cambiaron (revisión ${publicationConflict.currentRevision ?? 'nueva'}). Revisá y reintentá.`
        : runtimeMessage.includes('cambió')
        ? 'La tarea cambió en otra sesión. Recargá el ticket antes de guardar.'
        : 'No se pudo guardar el markdown de la tarea.')
      throw runtimeError instanceof Error ? runtimeError : new Error('No se pudo guardar el markdown de la tarea.')
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
        const nextPublicationSettings = {
          ...settings,
          boards: nextBoards,
          activeTab: normalizedName,
        }
        await runSync(async () => {
          await ensureBoardWorkspace(settings.activeVaultPath as string, normalizedName)
          updateSettings((previousSettings) => ({
            ...previousSettings,
            boards: nextBoards,
            activeTab: normalizedName,
          }))
        }, nextBoards, { publicationSettings: nextPublicationSettings })
      } else if (boardDialog.board) {
        const previousName = boardDialog.board.name

        if (previousName !== normalizedName && settings.boards.some((board) => board.name === normalizedName)) {
          setError(`Ya existe un tablero llamado "${normalizedName}".`)
          return
        }

        const canRenameOrRecolor = previousName !== DEFAULT_BOARD_NAME
        const effectiveName = canRenameOrRecolor ? normalizedName : previousName
        const effectiveColor = canRenameOrRecolor ? normalizedColor : boardDialog.board.color

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
        const nextGroups = settings.groups.map((group) => {
          if ((group.board ?? DEFAULT_BOARD_NAME) !== previousName) {
            return group
          }

          return {
            ...group,
            board: effectiveName,
          }
        })
        const nextPublicationSettings = {
          ...settings,
          boards: nextBoards,
          groups: nextGroups,
          activeTab: settings.activeTab === previousName ? effectiveName : settings.activeTab,
        }

        await runSync(async () => {
          if (canRenameOrRecolor && previousName !== effectiveName) {
            await renameBoardWorkspace(settings.activeVaultPath as string, previousName, effectiveName)
          }
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
            groups: nextGroups,
            activeTab: previousSettings.activeTab === previousName ? effectiveName : previousSettings.activeTab,
          }))
        }, nextBoards, { publicationSettings: nextPublicationSettings })
      }
      closeBoardDialog()
    } catch (runtimeError) {
      console.error(runtimeError)
      setError('No se pudo guardar el tablero.')
    }
  }, [boardDialog.board, boardDialog.mode, closeBoardDialog, runSync, settings, updateSettings])

  const removeBoard = useCallback(async (boardName: string) => {
    if (!settings.activeVaultPath || boardName === DEFAULT_BOARD_NAME) {
      return
    }

    try {
      const nextBoards = settings.boards.filter((board) => board.name !== boardName)
      const nextGroups = settings.groups.filter((group) => (group.board ?? DEFAULT_BOARD_NAME) !== boardName)
      const nextPublicationSettings = {
        ...settings,
        boards: nextBoards,
        groups: nextGroups,
        activeTab: settings.activeTab === boardName ? DEFAULT_BOARD_NAME : settings.activeTab,
      }
      await runSync(async () => {
        await removeBoardWorkspace(settings.activeVaultPath as string, boardName)
        updateSettings((previousSettings) => ({
          ...previousSettings,
          boards: nextBoards,
          groups: nextGroups,
          activeTab: previousSettings.activeTab === boardName ? DEFAULT_BOARD_NAME : previousSettings.activeTab,
        }))
      }, nextBoards, { publicationSettings: nextPublicationSettings })
    } catch (runtimeError) {
      console.error(runtimeError)
      setError('No se pudo eliminar el tablero.')
    }
  }, [runSync, settings, updateSettings])

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
    if (!settings.activeVaultPath) {
      setError('Seleccioná un vault antes de modificar grupos.')
      return
    }

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

    const nextGroups = (() => {
      if (groupDialog.mode === 'create') {
        return [
          ...settings.groups,
          {
            name: normalizedName,
            color: normalizedColor,
            board: normalizedBoard,
          },
        ]
      }

      if (!groupDialog.group) {
        return settings.groups
      }

      return settings.groups.map((group) => {
        if (group.name !== groupDialog.group?.name || (group.board ?? DEFAULT_BOARD_NAME) !== (groupDialog.group.board ?? DEFAULT_BOARD_NAME)) {
          return group
        }

        return {
          name: normalizedName,
          color: normalizedColor,
          board: normalizedBoard,
        }
      })
    })()

    const nextSettings = {
      ...settings,
      groups: nextGroups,
    }
    const initialSharedSettings = loadTaskManagerSettings()

    try {
      await withTaskManagerPublicationBatch(async (mutationContext) => {
        await persistSharedMetadata(settings.activeVaultPath as string, nextSettings, { throwOnError: true })
        updateSettings((previousSettings) => ({
          ...previousSettings,
          groups: nextGroups,
        }), { syncPublication: false })
        await syncTaskManagerPublicationSettings(settings.activeVaultPath as string, nextSettings, mutationContext)
      }, undefined, {
        vaultPath: settings.activeVaultPath,
        scopes: ['task-manager', 'groups'],
        changedPaths: [`${TASKS_ROOT_FOLDER}/${TASK_MANAGER_SHARED_METADATA_FILE}`],
        onFailure: (_error, mutationContext) => recoverPartialTaskManagerPublicationBatch(
          settings.activeVaultPath as string,
          snapshot,
          initialSharedSettings,
          mutationContext,
        ),
      })
    } catch (runtimeError) {
      console.error(runtimeError)
      if (runtimeError instanceof TaskManagerPublicationMutationError && runtimeError.conflict) {
        setPublicationConflict({
          operationId: runtimeError.operationId,
          command: runtimeError.command,
          expectedRevision: runtimeError.conflict.expectedRevision,
          currentRevision: runtimeError.conflict.currentRevision,
          actorId: runtimeError.conflict.actorId,
          conflictingOperationId: runtimeError.conflict.operationId,
        })
      }
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage || 'No se pudo sincronizar el grupo con la publicación.')
      return
    }

    closeGroupDialog()
    setInfoMessage('Grupo actualizado.')
  }, [closeGroupDialog, groupDialog.group, groupDialog.mode, persistSharedMetadata, recoverPartialTaskManagerPublicationBatch, settings, snapshot, updateSettings])

  const removeGroup = useCallback(async (groupName: string, board: string) => {
    if (!settings.activeVaultPath) {
      return
    }

    try {
      const nextPublicationSettings = {
        ...settings,
        groups: settings.groups.filter((group) => !(
          group.name === groupName
          && (group.board ?? DEFAULT_BOARD_NAME) === board
        )),
      }
      await runSync(async () => {
        const currentTasks = snapshotRef.current.tasks
        const candidateTasks = currentTasks
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

        const existingPaths = new Set(currentTasks.map((task) => task.filePath))
        for (const task of tasksToDismiss) {
          await moveTaskByState(settings.activeVaultPath as string, task, 'Cancelada', existingPaths)
        }

        updateSettings((previousSettings) => ({
          ...previousSettings,
          groups: nextPublicationSettings.groups,
        }))
      }, undefined, { publicationSettings: nextPublicationSettings })

      closeGroupDialog()
      setInfoMessage('Grupo eliminado.')
    } catch (runtimeError) {
      console.error(runtimeError)
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage
        ? `No se pudo eliminar el grupo: ${runtimeMessage}`
        : 'No se pudo eliminar el grupo.')
    }
  }, [closeGroupDialog, runSync, settings, updateSettings])

  const reorderGroupsInBoard = useCallback(async (board: string, orderedGroupNames: string[]) => {
    const normalizedBoard = board.trim().toLowerCase() || DEFAULT_BOARD_NAME
    const uniqueNames = Array.from(new Set(orderedGroupNames.map((name) => name.trim()).filter(Boolean)))
    if (uniqueNames.length === 0) {
      return
    }

    const nextGroups = reorderGroupsForBoard(settings.groups, normalizedBoard, uniqueNames)
    const groupsChanged = nextGroups.length !== settings.groups.length
      || nextGroups.some((group, index) => group !== settings.groups[index])
    if (!groupsChanged) {
      return
    }

    if (!settings.activeVaultPath) {
      return
    }

    const nextSettings = {
      ...settings,
      groups: nextGroups,
    }
    const initialSharedSettings = loadTaskManagerSettings()
    try {
      await withTaskManagerPublicationBatch(async (mutationContext) => {
        await persistSharedMetadata(settings.activeVaultPath as string, nextSettings, { throwOnError: true })
        updateSettings((previousSettings) => ({
          ...previousSettings,
          groups: reorderGroupsForBoard(previousSettings.groups, normalizedBoard, uniqueNames),
        }), { syncPublication: false })
        await syncTaskManagerPublicationSettings(settings.activeVaultPath as string, nextSettings, mutationContext)
      }, undefined, {
        vaultPath: settings.activeVaultPath,
        scopes: ['task-manager', 'groups'],
        changedPaths: [`${TASKS_ROOT_FOLDER}/${TASK_MANAGER_SHARED_METADATA_FILE}`],
        onFailure: (_error, mutationContext) => recoverPartialTaskManagerPublicationBatch(
          settings.activeVaultPath as string,
          snapshot,
          initialSharedSettings,
          mutationContext,
        ),
      })
    } catch (runtimeError) {
      console.error(runtimeError)
      if (runtimeError instanceof TaskManagerPublicationMutationError && runtimeError.conflict) {
        setPublicationConflict({
          operationId: runtimeError.operationId,
          command: runtimeError.command,
          expectedRevision: runtimeError.conflict.expectedRevision,
          currentRevision: runtimeError.conflict.currentRevision,
          actorId: runtimeError.conflict.actorId,
          conflictingOperationId: runtimeError.conflict.operationId,
        })
      }
      const runtimeMessage = runtimeError instanceof Error ? runtimeError.message.trim() : ''
      setError(runtimeMessage || 'No se pudo reordenar los grupos en la publicación.')
    }
  }, [persistSharedMetadata, recoverPartialTaskManagerPublicationBatch, settings, snapshot, updateSettings])

  const applyTaskArrangement = useCallback(async (
    updates: Array<{ taskPath: string; order: number; group?: string; parentTaskName?: string }>,
  ) => {
    if (!settings.activeVaultPath || updates.length === 0) {
      return
    }

    const sanitizedUpdates = normalizeTaskArrangementUpdates(updates)

    if (sanitizedUpdates.length === 0) {
      return
    }

    try {
      await runSync(async () => {
        const changedUpdates = selectChangedTaskArrangementUpdates(snapshotRef.current.tasks, sanitizedUpdates)
        for (const update of changedUpdates) {
          await updateTaskFrontmatterCompat(settings.activeVaultPath as string, update.taskPath, {
            order: update.order,
            ...(typeof update.group === 'string' ? { equipo: update.group } : {}),
            ...(update.parentTaskName !== undefined
              ? { parent: update.parentTaskName ? `[[${update.parentTaskName}]]` : '' }
              : {}),
          })
        }
      })
    } catch (runtimeError) {
      console.error(runtimeError)
      setError('No se pudo reordenar tareas/grupos.')
    }
  }, [runSync, settings.activeVaultPath, updateTaskFrontmatterCompat])

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
      const initialSharedSettings = loadTaskManagerSettings()

      if (settings.activeVaultPath && (elapsedSeconds > 0 || deviationHours > 0)) {
        try {
          await withTaskManagerPublicationBatch(async () => {
            await appendPomodoroEntry(settings.activeVaultPath as string, {
              timestampMs: now,
              type: getPomodoroPhaseLabel(currentPomodoro.phase),
              durationChoice: resolvePomodoroDurationChoice(currentPomodoro.durations),
              task: selectedTask?.title ?? '-',
              durationMinutes: roundHours(elapsedSeconds / 60),
              deviationHours,
              finalized: false,
            })

            if (selectedTask && (workedHours > 0 || deviationHours > 0)) {
              await updateTaskFrontmatterCompat(settings.activeVaultPath as string, selectedTask.filePath, {
                dedicado: roundHours(selectedTask.dedicatedHours + workedHours),
                desvio: roundHours(selectedTask.deviationHours + deviationHours),
              })
            }
          }, async (_result, mutationContext) => {
            const nextSnapshot = await loadTaskManagerSnapshot(settings.activeVaultPath as string)
            applySnapshotState(nextSnapshot)
            await notifyTaskManagerPublicationChanged(
              settings.activeVaultPath as string,
              loadTaskManagerSettings(),
              resolveTaskManagerSnapshotChangedPaths(snapshot, nextSnapshot),
              mutationContext,
            )
          }, {
            vaultPath: settings.activeVaultPath,
            scopes: ['task-manager', 'pomodoro'],
            changedPaths: [`${TASKS_ROOT_FOLDER}/pomodoro.md`],
            onFailure: (_error, mutationContext) => recoverPartialTaskManagerPublicationBatch(
              settings.activeVaultPath as string,
              snapshot,
              initialSharedSettings,
              mutationContext,
            ),
          })
        } catch (runtimeError) {
          console.error(runtimeError)
        }
      }

      updateSettings((previousSettings) => ({
        ...previousSettings,
        pomodoro: resetPomodoro(previousSettings.pomodoro),
      }))
    })()
  }, [applySnapshotState, recoverPartialTaskManagerPublicationBatch, settings.activeVaultPath, settings.pomodoro, snapshot, updateSettings, updateTaskFrontmatterCompat])

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
    const activeVaultPath = settings.activeVaultPath
    const initialSharedSettings = loadTaskManagerSettings()

    const durations = nextDurations
    await withTaskManagerPublicationBatch(async () => {
      if (selectedTask && deviationHours > 0) {
        await updateTaskFrontmatterCompat(activeVaultPath, selectedTask.filePath, {
          desvio: roundHours(selectedTask.deviationHours + deviationHours),
        })
      }

      if (completedWork) {
        if (selectedTask) {
          await updateTaskFrontmatterCompat(activeVaultPath, selectedTask.filePath, {
            dedicado: roundHours(selectedTask.dedicatedHours + roundHours(durations.workMinutes / 60)),
          })
        }

        await appendPomodoroEntry(activeVaultPath, {
          timestampMs: now,
          type: getPomodoroPhaseLabel('work'),
          durationChoice: resolvePomodoroDurationChoice(durations),
          task: selectedTask?.title ?? '-',
          durationMinutes: durations.workMinutes,
          deviationHours,
          finalized: true,
        })
      } else {
        await appendPomodoroEntry(activeVaultPath, {
          timestampMs: now,
          type: 'Desvío parcial',
          durationChoice: resolvePomodoroDurationChoice(durations),
          task: selectedTask?.title ?? '-',
          durationMinutes: roundHours(elapsedSeconds / 60),
          deviationHours,
          finalized: false,
        })
      }
    }, async (_result, mutationContext) => {
      const nextSnapshot = await loadTaskManagerSnapshot(settings.activeVaultPath as string)
      applySnapshotState(nextSnapshot)
      await notifyTaskManagerPublicationChanged(
        settings.activeVaultPath as string,
        loadTaskManagerSettings(),
        resolveTaskManagerSnapshotChangedPaths(snapshot, nextSnapshot),
        mutationContext,
      )
    }, {
      vaultPath: activeVaultPath,
      scopes: ['task-manager', 'pomodoro'],
      changedPaths: [`${TASKS_ROOT_FOLDER}/pomodoro.md`],
      onFailure: (_error, mutationContext) => recoverPartialTaskManagerPublicationBatch(
        activeVaultPath,
        snapshot,
        initialSharedSettings,
        mutationContext,
      ),
    })
  }, [applySnapshotState, recoverPartialTaskManagerPublicationBatch, settings.activeVaultPath, settings.pomodoro.durations, settings.pomodoro.selectedTaskPath, snapshot, updateSettings, updateTaskFrontmatterCompat])

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

    const initialSharedSettings = loadTaskManagerSettings()
    const deleted = await withTaskManagerPublicationBatch(
      () => deletePomodoroEntry(settings.activeVaultPath as string, entryId),
      async (wasDeleted, mutationContext) => {
        if (!wasDeleted) {
          return
        }

        const nextEntries = await readPomodoroEntries(settings.activeVaultPath as string)
        setSnapshot((previousSnapshot) => {
          const nextSnapshot = {
            ...previousSnapshot,
            pomodoroEntries: nextEntries,
          }
          snapshotRef.current = nextSnapshot
          return nextSnapshot
        })
        await notifyTaskManagerPublicationChanged(
          settings.activeVaultPath as string,
          loadTaskManagerSettings(),
          [`${TASKS_ROOT_FOLDER}/pomodoro.md`],
          mutationContext,
        )
      },
      {
        vaultPath: settings.activeVaultPath,
        scopes: ['task-manager', 'pomodoro'],
        changedPaths: [`${TASKS_ROOT_FOLDER}/pomodoro.md`],
        onFailure: (_error, mutationContext) => recoverPartialTaskManagerPublicationBatch(
          settings.activeVaultPath as string,
          snapshot,
          initialSharedSettings,
          mutationContext,
        ),
      },
    )
    if (!deleted) {
      setError('No se pudo eliminar el registro de pomodoro.')
      return
    }
  }, [recoverPartialTaskManagerPublicationBatch, settings.activeVaultPath, snapshot])

  const taskStates = useMemo(() => TASK_STATES, [])
  const taskPriorities = useMemo(() => TASK_PRIORITIES, [])

  return {
    settings,
    snapshot,
    isLoading,
    isSyncing,
    error,
    infoMessage,
    publicationConflict,
    publicationCursor,
    taskDialog,
    taskCreateDefaults,
    boardDialog,
    groupDialog,
    taskStates,
    taskPriorities,
    setError,
    setInfoMessage,
    clearPublicationConflict,
    reloadPublicationConflict,
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
