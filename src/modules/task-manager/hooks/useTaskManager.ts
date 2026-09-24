import { subscribeBackend, type Unsubscribe } from '../../../services/transport'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TASK_PRIORITIES, TASK_STATES } from '../constants/taskManagerConstants'
import type {
  Board,
  Group,
  PomodoroDurations,
  PomodoroState,
  TaskCreationRequest,
  TaskFormData,
  TaskItem,
  TaskManagerSettings,
  TaskManagerVaultRef,
  TaskPriority,
  TaskState,
} from '../types/taskManagerTypes'
import { clearLegacyPomodoroState, loadActiveTaskTab, loadLegacyPomodoroState, saveActiveTaskTab } from '../services/taskManagerStorage'
import {
  deletePomodoroEntry,
  EMPTY_TASK_MANAGER_SNAPSHOT,
  executeTaskBoardIntent,
  readTaskBoardView,
  readTaskMarkdownSource,
  runPomodoroAction,
  writeTaskMarkdownSource,
  type PomodoroAction,
  type TaskBoardIntent,
  type TaskManagerBackendContext,
  type TaskManagerSnapshot,
} from '../services/taskManagerService'
import {
  subscribeTaskManagerPublicationChanges,
  TaskManagerPublicationMutationError,
} from '../services/taskManagerPublicationClient'
import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'

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

export interface TaskManagerConflictDetails {
  operationId: string
  command: string
  expectedRevision?: number
  currentRevision?: number
  actorId?: string
  conflictingOperationId?: string
}

export interface UseTaskManagerResult {
  settings: TaskManagerSettings
  snapshot: TaskManagerSnapshot
  isLoading: boolean
  isSyncing: boolean
  error: string | null
  infoMessage: string | null
  publicationConflict: TaskManagerConflictDetails | null
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
  reload: () => Promise<void>
  openTaskCreateDialog: (request?: TaskCreationRequest) => void
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
  submitBoardDialog: (payload: { name: string; color: string; activityHoursPerDay: number; contexto: string }) => Promise<void>
  removeBoard: (boardName: string) => Promise<void>
  openGroupCreateDialog: () => void
  openGroupEditDialog: (group: Group) => void
  closeGroupDialog: () => void
  submitGroupDialog: (payload: { name: string; color: string; board: string }) => Promise<void>
  removeGroup: (groupName: string, board: string) => Promise<void>
  reorderGroupsInBoard: (board: string, orderedGroupNames: string[]) => Promise<void>
  placeTask: (placement: { taskPath: string; orderedPaths: string[]; group: string; parentTaskName: string }) => Promise<void>
  selectPomodoroTask: (taskPath: string | null) => void
  startPomodoroCycle: () => Promise<void>
  pausePomodoroCycle: () => void
  resumePomodoroCycle: () => void
  resetPomodoroCycle: () => void
  enterPomodoroDeviationMode: () => void
  exitPomodoroDeviationMode: () => Promise<void>
  setPomodoroDurations: (durations: PomodoroDurations) => void
  deletePomodoroLogEntry: (entryId: string) => Promise<void>
}

const TASK_MANAGER_CHANGED_EVENT = 'task-manager-changed'
const PUBLICATION_CHANGED_EVENT = 'task-manager-publication-changed'
const FINISHED_TAB_ID = '__finished__'
const CANCELLED_TAB_ID = '__cancelled__'
const POMODORO_TAB_ID = '__pomodoro__'

/** Shown until the backend returns the user's timer. */
const INITIAL_POMODORO: PomodoroState = {
  phase: 'work',
  runState: 'idle',
  remainingSeconds: 25 * 60,
  endTimestamp: null,
  completedWorkCycles: 0,
  selectedTaskPath: null,
  isDeviationActive: false,
  deviationStartedAt: null,
  deviationBaseRemainingSeconds: 0,
  phaseDeviationSeconds: 0,
  durations: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
}
const NON_BOARD_TABS = new Set([FINISHED_TAB_ID, CANCELLED_TAB_ID, POMODORO_TAB_ID])

/** Last view of each library, so reopening the board renders at once. */
const viewCache = new Map<string, TaskManagerSnapshot>()

function isPublishedTaskManager(): boolean {
  return typeof window !== 'undefined' && window.__NOTIA_PUBLISHED_TASK_MANAGER__ === true
}

function backendContextOf(libraryId?: string, libraryUserId?: string): TaskManagerBackendContext | null {
  const library = libraryId?.trim()
  const user = libraryUserId?.trim()
  return library && user ? { libraryId: library, libraryUserId: user } : null
}

function resolveActiveTab(activeTab: string, boards: Board[]): string {
  if (NON_BOARD_TABS.has(activeTab) || boards.some((board) => board.name === activeTab)) {
    return activeTab
  }
  return boards[0]?.name ?? activeTab
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.trim() : ''
}

function conflictOf(error: unknown): TaskManagerConflictDetails | null {
  if (!(error instanceof TaskManagerPublicationMutationError) || !error.conflict) {
    return null
  }
  return {
    operationId: error.operationId,
    command: error.command,
    expectedRevision: error.conflict.expectedRevision,
    currentRevision: error.conflict.currentRevision,
    actorId: error.conflict.actorId,
    conflictingOperationId: error.conflict.operationId,
  }
}

/**
 * Task Manager board state for the interface. The board, its tasks and the
 * Pomodoro log come from the backend view; this hook keeps only what is
 * shown (dialogs, active tab, messages) and the device's Pomodoro timer,
 * and sends every change to the backend as an intent.
 */
export function useTaskManager(vault: TaskManagerVaultRef | null = null): UseTaskManagerResult {
  const libraryId = vault?.libraryId
  const libraryUserId = vault?.libraryUserId
  const context = useMemo(() => backendContextOf(libraryId, libraryUserId), [libraryId, libraryUserId])
  const vaultPath = vault?.path ?? null
  const cacheKey = context ? `${context.libraryId}::${context.libraryUserId}` : null

  const [snapshot, setSnapshot] = useState<TaskManagerSnapshot>(() => (
    (cacheKey && viewCache.get(cacheKey)) || EMPTY_TASK_MANAGER_SNAPSHOT
  ))
  const snapshotRef = useRef(snapshot)
  const [activeTab, setActiveTabState] = useState(loadActiveTaskTab)
  const [pomodoro, setPomodoro] = useState<PomodoroState>(INITIAL_POMODORO)
  const pomodoroRef = useRef(pomodoro)
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [publicationConflict, setPublicationConflict] = useState<TaskManagerConflictDetails | null>(null)
  const [taskDialog, setTaskDialog] = useState<TaskDialogState>({ open: false, mode: 'create', task: null })
  const [taskCreateDefaults, setTaskCreateDefaults] = useState<{ parentTaskName?: string; group?: string }>({})
  const [boardDialog, setBoardDialog] = useState<BoardDialogState>({ open: false, mode: 'create', board: null })
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>({ open: false, mode: 'create', group: null })
  const taskSourceRevisionsRef = useRef(new Map<string, string>())
  const reloadStateRef = useRef<{ inFlight: Promise<void> | null; pending: boolean }>({ inFlight: null, pending: false })

  const settings = useMemo<TaskManagerSettings>(() => ({
    activeVaultPath: vaultPath,
    boards: snapshot.boards,
    groups: snapshot.groups,
    pomodoro,
    activeTab: resolveActiveTab(activeTab, snapshot.boards),
  }), [activeTab, pomodoro, snapshot.boards, snapshot.groups, vaultPath])

  // Device preference: the active tab.
  useEffect(() => {
    saveActiveTaskTab(activeTab)
  }, [activeTab])

  const applySnapshot = useCallback((nextSnapshot: TaskManagerSnapshot) => {
    snapshotRef.current = nextSnapshot
    if (cacheKey) {
      viewCache.set(cacheKey, nextSnapshot)
    }
    startTransition(() => setSnapshot(nextSnapshot))
  }, [cacheKey])

  /** Reads the view; overlapping requests collapse into one more read. */
  const reload = useCallback(async (): Promise<void> => {
    if (!context) {
      applySnapshot(EMPTY_TASK_MANAGER_SNAPSHOT)
      return
    }
    const reloadState = reloadStateRef.current
    if (reloadState.inFlight) {
      reloadState.pending = true
      return reloadState.inFlight
    }
    const run = async () => {
      do {
        reloadState.pending = false
        try {
          applySnapshot(await readTaskBoardView(context))
          setError(null)
        } catch (reloadError) {
          console.warn('[task-manager] no se pudo leer el tablero', reloadError)
          setError(errorMessage(reloadError) || 'No se pudo leer el estado del gestor de tareas.')
        }
      } while (reloadState.pending)
    }
    reloadState.inFlight = run().finally(() => {
      reloadState.inFlight = null
    })
    return reloadState.inFlight
  }, [applySnapshot, context])

  useEffect(() => {
    const cached = cacheKey ? viewCache.get(cacheKey) : undefined
    applySnapshot(cached ?? EMPTY_TASK_MANAGER_SNAPSHOT)
    if (!context) {
      return
    }
    setIsLoading(!cached)
    void reload().finally(() => setIsLoading(false))
  }, [applySnapshot, cacheKey, context, reload])

  // Changes made elsewhere: the backend, the publication or another app.
  useEffect(() => {
    if (!context) {
      return undefined
    }
    if (isPublishedTaskManager()) {
      return subscribeTaskManagerPublicationChanges((change) => {
        if (change.type === 'changed' || change.type === 'resync-required') {
          void reload()
        }
      })
    }

    let disposed = false
    const unlisteners: Unsubscribe[] = []
    const subscribe = (event: string, matches: (payload: Record<string, unknown>) => boolean) => {
      void subscribeBackend<unknown>(event, (payload) => {
        if (payload && typeof payload === 'object' && matches(payload as Record<string, unknown>)) {
          void reload()
        }
      }).then((unlisten) => {
        if (disposed) unlisten()
        else unlisteners.push(unlisten)
      }).catch((listenError: unknown) => {
        console.warn(`[task-manager] ${event} no está disponible`, listenError)
      })
    }
    subscribe(TASK_MANAGER_CHANGED_EVENT, (payload) => payload.libraryId === context.libraryId)
    subscribe(PUBLICATION_CHANGED_EVENT, (payload) => payload.vaultPath === vaultPath)

    const activeVaultPath = normalizeFilesystemPath(vaultPath ?? '')
    const handleTreeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ vaultPath?: string; source?: 'external' | 'internal' }>).detail
      if (detail?.source === 'internal') return
      const changedVaultPath = normalizeFilesystemPath(detail?.vaultPath ?? '')
      if (!changedVaultPath || changedVaultPath === activeVaultPath) {
        void reload()
      }
    }
    window.addEventListener('notia:library-tree-changed', handleTreeChange)
    return () => {
      disposed = true
      unlisteners.forEach((unlisten) => unlisten())
      window.removeEventListener('notia:library-tree-changed', handleTreeChange)
    }
  }, [context, reload, vaultPath])

  const reportFailure = useCallback((failure: unknown, action: string) => {
    console.error(failure)
    const conflict = conflictOf(failure)
    if (conflict) {
      setPublicationConflict(conflict)
    }
    const message = errorMessage(failure)
    setError(failure instanceof TaskManagerPublicationMutationError && failure.outcome === 'unknown'
      ? 'La operación no fue confirmada por la publicación. Actualizá el tablero antes de reintentar.'
      : message ? `${action}: ${message}` : `${action}.`)
  }, [])

  /** Sends an intent and renders the backend's resulting view. */
  const runIntent = useCallback(async (intent: TaskBoardIntent, failure: string): Promise<boolean> => {
    if (!context) {
      setError('El Task Manager necesita una biblioteca abierta.')
      return false
    }
    setIsSyncing(true)
    try {
      await executeTaskBoardIntent(context, intent)
      await reload()
      setPublicationConflict(null)
      return true
    } catch (intentError) {
      reportFailure(intentError, failure)
      return false
    } finally {
      setIsSyncing(false)
    }
  }, [context, reload, reportFailure])

  const setActiveTab = useCallback((tab: string) => setActiveTabState(tab), [])

  const clearPublicationConflict = useCallback(() => setPublicationConflict(null), [])

  const reloadPublicationConflict = useCallback(async () => {
    await reload()
    setPublicationConflict(null)
  }, [reload])

  const openTaskCreateDialog = useCallback((request?: TaskCreationRequest) => {
    setTaskCreateDefaults(request?.kind === 'subtask'
      ? { parentTaskName: request.parentTaskName, group: request.group }
      : { group: request?.group })
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
    const editedTask = taskDialog.mode === 'edit' ? taskDialog.task : null
    if (taskDialog.mode === 'edit' && !editedTask) {
      setError('No se encontró la tarea que se intenta editar.')
      return
    }
    const intent: TaskBoardIntent = editedTask
      ? {
        kind: 'edit-task',
        taskPath: editedTask.filePath,
        title: formData.title,
        detail: formData.detail,
        state: formData.state,
        priority: formData.priority || null,
        group: formData.group,
        endDate: formData.endDate,
        dynamicEndDate: formData.dynamicEndDate,
        estimatedHours: formData.estimatedHours,
        parentTaskName: formData.parentTaskName,
      }
      : {
        kind: 'create-task',
        board: formData.board,
        title: formData.title,
        detail: formData.detail,
        group: formData.group,
        priority: formData.priority || null,
        state: formData.state,
        parentTaskName: formData.parentTaskName,
        endDate: formData.endDate,
        dynamicEndDate: formData.dynamicEndDate,
        estimatedHours: formData.estimatedHours,
      }
    if (await runIntent(intent, 'No se pudo guardar la tarea')) {
      closeTaskDialog()
    }
  }, [closeTaskDialog, runIntent, taskDialog.mode, taskDialog.task])

  const updateTaskState = useCallback(async (task: TaskItem, nextState: string) => {
    await runIntent({ kind: 'change-state', taskPath: task.filePath, state: nextState as TaskState }, 'No se pudo cambiar el estado de la tarea')
  }, [runIntent])

  const updateTaskPriority = useCallback(async (task: TaskItem, nextPriority: TaskPriority) => {
    await runIntent({ kind: 'change-priority', taskPath: task.filePath, priority: nextPriority }, 'No se pudo cambiar la prioridad de la tarea')
  }, [runIntent])

  const updateTaskDedicatedHours = useCallback(async (task: TaskItem, nextDedicatedHours: number) => {
    await runIntent({ kind: 'set-dedicated-hours', taskPath: task.filePath, hours: nextDedicatedHours }, 'No se pudo actualizar horas dedicadas')
  }, [runIntent])

  const markTaskAsUrgent = useCallback(async (task: TaskItem) => {
    await runIntent({ kind: 'mark-urgent', taskPath: task.filePath }, 'No se pudo marcar la tarea como urgente')
  }, [runIntent])

  const deleteTaskItem = useCallback(async (task: TaskItem) => {
    await runIntent({ kind: 'delete-task', taskPath: task.filePath }, 'No se pudo eliminar la tarea')
  }, [runIntent])

  const toggleSubtaskDone = useCallback(async (task: TaskItem, done: boolean) => {
    await runIntent({ kind: 'change-state', taskPath: task.filePath, state: done ? 'Finalizada' : 'Pendiente' }, 'No se pudo actualizar la subtarea')
  }, [runIntent])

  const addTaskComment = useCallback(async (task: TaskItem, comment: string) => {
    await runIntent({ kind: 'add-comment', taskPath: task.filePath, comment }, 'No se pudo agregar el comentario')
  }, [runIntent])

  const loadTaskSource = useCallback(async (taskPath: string): Promise<string> => {
    if (!context) {
      throw new Error('El Task Manager necesita una biblioteca abierta.')
    }
    const source = await readTaskMarkdownSource(context, taskPath)
    taskSourceRevisionsRef.current.set(taskPath, source.revision)
    return source.content
  }, [context])

  const saveTaskSource = useCallback(async (taskPath: string, content: string) => {
    if (!context) {
      return
    }
    try {
      await writeTaskMarkdownSource(context, taskPath, content, taskSourceRevisionsRef.current.get(taskPath))
      taskSourceRevisionsRef.current.delete(taskPath)
      await reload()
    } catch (saveError) {
      console.error(saveError)
      const conflict = conflictOf(saveError)
      setError(conflict
        ? `Los cambios compartidos cambiaron (revisión ${conflict.currentRevision ?? 'nueva'}). Revisá y reintentá.`
        : errorMessage(saveError).includes('cambió')
          ? 'La tarea cambió en otra sesión. Recargá el ticket antes de guardar.'
          : 'No se pudo guardar el markdown de la tarea.')
      throw saveError instanceof Error ? saveError : new Error('No se pudo guardar el markdown de la tarea.')
    }
  }, [context, reload])

  const openBoardCreateDialog = useCallback(() => {
    setBoardDialog({ open: true, mode: 'create', board: null })
  }, [])

  const openBoardEditDialog = useCallback((board: Board) => {
    setBoardDialog({ open: true, mode: 'edit', board })
  }, [])

  const closeBoardDialog = useCallback(() => {
    setBoardDialog({ open: false, mode: 'create', board: null })
  }, [])

  const submitBoardDialog = useCallback(async (payload: { name: string; color: string; activityHoursPerDay: number; contexto: string }) => {
    const previousName = boardDialog.mode === 'edit' ? boardDialog.board?.name : undefined
    const saved = await runIntent(previousName
      ? { kind: 'update-board', previousName, ...payload }
      : { kind: 'create-board', ...payload }, 'No se pudo guardar el tablero')
    if (!saved) {
      return
    }
    // The backend owns the resulting name; follow it with the view's tab.
    const createdOrRenamed = snapshotRef.current.boards.find((board) => (
      board.name.toLowerCase() === payload.name.trim().toLowerCase()
    ))
    if (createdOrRenamed && (!previousName || activeTab === previousName)) {
      setActiveTabState(createdOrRenamed.name)
    }
    closeBoardDialog()
  }, [activeTab, boardDialog.board, boardDialog.mode, closeBoardDialog, runIntent])

  const removeBoard = useCallback(async (boardName: string) => {
    await runIntent({ kind: 'delete-board', name: boardName }, 'No se pudo eliminar el tablero')
  }, [runIntent])

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
    const editedGroup = groupDialog.mode === 'edit' ? groupDialog.group : null
    const saved = await runIntent(editedGroup
      ? {
        kind: 'update-group',
        previousBoard: editedGroup.board ?? payload.board,
        previousName: editedGroup.name,
        name: payload.name,
        color: payload.color,
      }
      : { kind: 'create-group', board: payload.board, name: payload.name, color: payload.color }, 'No se pudo guardar el grupo')
    if (saved) {
      closeGroupDialog()
      setInfoMessage('Grupo actualizado.')
    }
  }, [closeGroupDialog, groupDialog.group, groupDialog.mode, runIntent])

  const removeGroup = useCallback(async (groupName: string, board: string) => {
    if (await runIntent({ kind: 'delete-group', board, name: groupName }, 'No se pudo eliminar el grupo')) {
      closeGroupDialog()
      setInfoMessage('Grupo eliminado.')
    }
  }, [closeGroupDialog, runIntent])

  const reorderGroupsInBoard = useCallback(async (board: string, orderedGroupNames: string[]) => {
    await runIntent({ kind: 'reorder-groups', board, groupNames: orderedGroupNames }, 'No se pudo reordenar los grupos')
  }, [runIntent])

  const placeTask = useCallback(async (placement: { taskPath: string; orderedPaths: string[]; group: string; parentTaskName: string }) => {
    await runIntent({ kind: 'place-task', ...placement }, 'No se pudo reordenar la tarea')
  }, [runIntent])

  // --- Pomodoro -----------------------------------------------------------
  // The backend keeps the timer of each library user, advances its phases,
  // logs each event and adds the hours to the selected task. The panel shows
  // the countdown; this hook sends the actions.

  const pomodoroInFlightRef = useRef(false)

  const runPomodoro = useCallback(async (action: PomodoroAction): Promise<void> => {
    if (!context) {
      return
    }
    pomodoroInFlightRef.current = true
    try {
      const result = await runPomodoroAction(context, action, action.kind === 'read' ? loadLegacyPomodoroState() : undefined)
      if (action.kind === 'read') clearLegacyPomodoroState()
      pomodoroRef.current = result.state
      setPomodoro(result.state)
      if (result.recordError) reportFailure(new Error(result.recordError), 'No se pudo registrar el pomodoro')
      if (result.changed) await reload()
    } catch (pomodoroError) {
      reportFailure(pomodoroError, 'No se pudo actualizar el pomodoro')
    } finally {
      pomodoroInFlightRef.current = false
    }
  }, [context, reload, reportFailure])

  useEffect(() => {
    void runPomodoro({ kind: 'read' })
  }, [runPomodoro])

  // When the countdown reaches zero the backend advances the phase.
  useEffect(() => {
    if (!context) {
      return undefined
    }
    const interval = window.setInterval(() => {
      const current = pomodoroRef.current
      const due = current.runState === 'running'
        && !current.isDeviationActive
        && current.endTimestamp !== null
        && current.endTimestamp <= Date.now()
      if (due && !pomodoroInFlightRef.current) void runPomodoro({ kind: 'tick' })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [context, runPomodoro])

  const selectPomodoroTask = useCallback((taskPath: string | null) => {
    void runPomodoro({ kind: 'select-task', taskPath })
  }, [runPomodoro])

  const startPomodoroCycle = useCallback(async () => {
    await runPomodoro({ kind: 'start' })
  }, [runPomodoro])

  const pausePomodoroCycle = useCallback(() => {
    void runPomodoro({ kind: 'pause' })
  }, [runPomodoro])

  const resumePomodoroCycle = useCallback(() => {
    void runPomodoro({ kind: 'resume' })
  }, [runPomodoro])

  const resetPomodoroCycle = useCallback(() => {
    void runPomodoro({ kind: 'reset' })
  }, [runPomodoro])

  const enterPomodoroDeviationMode = useCallback(() => {
    void runPomodoro({ kind: 'enter-deviation' })
  }, [runPomodoro])

  const exitPomodoroDeviationMode = useCallback(async () => {
    await runPomodoro({ kind: 'exit-deviation' })
  }, [runPomodoro])

  const setPomodoroDurations = useCallback((durations: PomodoroDurations) => {
    void runPomodoro({ kind: 'set-durations', durations })
  }, [runPomodoro])

  const deletePomodoroLogEntry = useCallback(async (entryId: string) => {
    if (!context || isPublishedTaskManager()) {
      setError('No se pudo eliminar el registro de pomodoro.')
      return
    }
    try {
      if (!(await deletePomodoroEntry(context, entryId))) {
        setError('No se pudo eliminar el registro de pomodoro.')
        return
      }
      await reload()
    } catch (deleteError) {
      reportFailure(deleteError, 'No se pudo eliminar el registro de pomodoro')
    }
  }, [context, reload, reportFailure])

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
    setActiveTab,
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
    placeTask,
    selectPomodoroTask,
    startPomodoroCycle,
    pausePomodoroCycle,
    resumePomodoroCycle,
    resetPomodoroCycle,
    enterPomodoroDeviationMode,
    exitPomodoroDeviationMode,
    setPomodoroDurations,
    deletePomodoroLogEntry,
  }
}
