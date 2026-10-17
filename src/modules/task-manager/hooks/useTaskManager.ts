import { subscribeBackend, type Unsubscribe } from '../../../services/transport'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Board,
  Group,
  PomodoroState,
  TaskManagerSettings,
  TaskManagerVaultRef,
} from '../types/taskManagerTypes'
import type { TaskBoardPlan, TaskColumnKind } from '../types/taskBoardTypes'
import { clearLegacyPomodoroState, loadActiveTaskTab, loadLegacyPomodoroState, saveActiveTaskTab } from '../services/taskManagerStorage'
import {
  EMPTY_TASK_MANAGER_SNAPSHOT,
  executeTaskBoardIntent,
  readTaskBoardView,
  readTaskMarkdownSource,
  runPomodoroAction,
  writeTaskMarkdownSource,
  type PomodoroAction,
  type PomodoroPreset,
  type PomodoroToday,
  type TaskBoardExecuteResult,
  type TaskBoardIntent,
  type TaskManagerBackendContext,
  type TaskManagerSnapshot,
} from '../services/taskManagerService'
import {
  subscribeTaskManagerPublicationChanges,
  TaskManagerPublicationMutationError,
} from '../services/taskManagerPublicationClient'
import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'

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

export interface PeoplePanelState {
  open: boolean
  tab: 'people' | 'projects'
}

/** «Tarea finalizada / desestimada / eliminada» with «Deshacer» for 5 s. */
export interface TaskUndoToast {
  id: number
  token: string
  kind: 'finish' | 'cancel' | 'delete'
  title: string
}

export interface BoardSaveValue {
  name: string
  color: string
  contexto: string
  plan: TaskBoardPlan
}

export interface GroupSaveValue {
  name: string
  color: string
  board: string
  columnKind: TaskColumnKind
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
  context: TaskManagerBackendContext | null
  isLoading: boolean
  isSyncing: boolean
  error: string | null
  publicationConflict: TaskManagerConflictDetails | null
  setError: (value: string | null) => void
  clearPublicationConflict: () => void
  reloadPublicationConflict: () => Promise<void>
  setActiveTab: (tab: string) => void
  reload: () => Promise<void>
  /** Sends an intent and reloads; rejects (after showing the error) when the backend refuses it. */
  executeIntent: (intent: TaskBoardIntent) => Promise<TaskBoardExecuteResult>
  undoToast: TaskUndoToast | null
  undo: () => Promise<void>
  dismissUndo: () => void
  /** Ticket id the board highlights after an action. */
  flashTaskId: string | null
  /** «Nueva tarea» in a column of the active board (the first one by default). */
  createTask: (groupName?: string) => Promise<void>
  addTaskComment: (taskPath: string, comment: string) => Promise<void>
  loadTaskSource: (taskPath: string) => Promise<string>
  saveTaskSource: (taskPath: string, content: string) => Promise<void>
  boardDialog: BoardDialogState
  openBoardCreateDialog: () => void
  openBoardEditDialog: (board: Board) => void
  closeBoardDialog: () => void
  /** Rejects with the backend's message, which the dialog shows. */
  saveBoard: (value: BoardSaveValue) => Promise<void>
  removeBoard: (boardName: string) => Promise<void>
  groupDialog: GroupDialogState
  openGroupCreateDialog: () => void
  openGroupEditDialog: (group: Group) => void
  closeGroupDialog: () => void
  submitGroupDialog: (value: GroupSaveValue) => Promise<void>
  removeGroup: (group: Group) => Promise<void>
  peoplePanel: PeoplePanelState
  openPeoplePanel: (tab: 'people' | 'projects') => void
  closePeoplePanel: () => void
  pomodoroPresets: PomodoroPreset[]
  pomodoroToday: PomodoroToday | null
  runPomodoro: (action: PomodoroAction) => Promise<void>
}

const TASK_MANAGER_CHANGED_EVENT = 'task-manager-changed'
const PUBLICATION_CHANGED_EVENT = 'task-manager-publication-changed'
const FINISHED_TAB_ID = '__finished__'
const CANCELLED_TAB_ID = '__cancelled__'
const POMODORO_TAB_ID = '__pomodoro__'
/** How long the toast offers «Deshacer», as the backend keeps the token. */
export const UNDO_TOAST_MS = 5_000
const FLASH_MS = 1_200

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
  durations: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, cycles: 4 },
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
 * Task Manager state for the interface. The boards, their tasks, the plan
 * and the Pomodoro come from the backend; this hook keeps only what is
 * shown (dialogs, active tab, toasts, highlight) and sends every change to
 * the backend as an intent.
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
  const [pomodoroPresets, setPomodoroPresets] = useState<PomodoroPreset[]>([])
  const [pomodoroToday, setPomodoroToday] = useState<PomodoroToday | null>(null)
  const pomodoroRef = useRef(pomodoro)
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publicationConflict, setPublicationConflict] = useState<TaskManagerConflictDetails | null>(null)
  const [boardDialog, setBoardDialog] = useState<BoardDialogState>({ open: false, mode: 'create', board: null })
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>({ open: false, mode: 'create', group: null })
  const [peoplePanel, setPeoplePanel] = useState<PeoplePanelState>({ open: false, tab: 'people' })
  const [undoToast, setUndoToast] = useState<TaskUndoToast | null>(null)
  const [flashTaskId, setFlashTaskId] = useState<string | null>(null)
  const taskSourceRevisionsRef = useRef(new Map<string, string>())
  const reloadStateRef = useRef<{ inFlight: Promise<void> | null; pending: boolean }>({ inFlight: null, pending: false })
  const undoIdRef = useRef(0)

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

  const reportFailure = useCallback((failure: unknown, fallback: string) => {
    console.error(failure)
    const conflict = conflictOf(failure)
    if (conflict) {
      setPublicationConflict(conflict)
    }
    setError(failure instanceof TaskManagerPublicationMutationError && failure.outcome === 'unknown'
      ? 'La operación no fue confirmada por la publicación. Actualizá el tablero antes de reintentar.'
      : errorMessage(failure) || fallback)
  }, [])

  // The highlight fades by itself.
  useEffect(() => {
    if (!flashTaskId) return undefined
    const timer = window.setTimeout(() => setFlashTaskId(null), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flashTaskId])

  const executeIntent = useCallback(async (intent: TaskBoardIntent): Promise<TaskBoardExecuteResult> => {
    if (!context) {
      const missing = new Error('El Task Manager necesita una biblioteca abierta.')
      setError(missing.message)
      throw missing
    }
    setIsSyncing(true)
    try {
      const result = await executeTaskBoardIntent(context, intent)
      await reload()
      setPublicationConflict(null)
      if (result.undo) {
        undoIdRef.current += 1
        setUndoToast({ id: undoIdRef.current, ...result.undo })
      }
      if (result.focusTaskId) setFlashTaskId(result.focusTaskId)
      return result
    } catch (intentError) {
      reportFailure(intentError, 'No se pudo completar la acción.')
      throw intentError instanceof Error ? intentError : new Error('No se pudo completar la acción.')
    } finally {
      setIsSyncing(false)
    }
  }, [context, reload, reportFailure])

  /** Runs an intent whose failure only needs the error message. */
  const runQuietly = useCallback(async (intent: TaskBoardIntent): Promise<boolean> => {
    try {
      await executeIntent(intent)
      return true
    } catch {
      return false
    }
  }, [executeIntent])

  const dismissUndo = useCallback(() => setUndoToast(null), [])

  const undo = useCallback(async () => {
    const toast = undoToast
    if (!toast) return
    setUndoToast(null)
    await runQuietly({ kind: 'undo', token: toast.token })
  }, [runQuietly, undoToast])

  const setActiveTab = useCallback((tab: string) => setActiveTabState(tab), [])

  const clearPublicationConflict = useCallback(() => setPublicationConflict(null), [])

  const reloadPublicationConflict = useCallback(async () => {
    await reload()
    setPublicationConflict(null)
  }, [reload])

  const activeBoardName = settings.activeTab

  const createTask = useCallback(async (groupName?: string) => {
    const board = snapshotRef.current.boards.find((candidate) => candidate.name === activeBoardName)
    if (!board) return
    const group = groupName ?? snapshotRef.current.groups.find((candidate) => (candidate.board ?? 'default') === board.name)?.name ?? ''
    await runQuietly({
      kind: 'create-task',
      board: board.name,
      title: 'Nueva tarea',
      detail: '',
      group,
      priority: 'Media',
      state: 'Pendiente',
      parentTaskName: '',
      endDate: '',
      dynamicEndDate: true,
      estimatedHours: 0,
      project: '',
      assignees: [],
    })
  }, [activeBoardName, runQuietly])

  const addTaskComment = useCallback(async (taskPath: string, comment: string) => {
    await executeIntent({ kind: 'add-comment', taskPath, comment })
  }, [executeIntent])

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

  const saveBoard = useCallback(async (value: BoardSaveValue) => {
    const previousName = boardDialog.mode === 'edit' ? boardDialog.board?.name : undefined
    const activityHoursPerDay = (value.plan.dayEndMinutes - value.plan.dayStartMinutes) / 60
    if (!context) throw new Error('El Task Manager necesita una biblioteca abierta.')
    // The dialog shows the backend's refusal itself.
    await executeTaskBoardIntent(context, previousName
      ? { kind: 'update-board', previousName, activityHoursPerDay, ...value }
      : { kind: 'create-board', activityHoursPerDay, ...value })
    await reload()
    // The backend owns the resulting name; the tab follows it.
    const saved = snapshotRef.current.boards.find((board) => (
      board.name.toLowerCase() === value.name.trim().toLowerCase()
    ))
    if (saved && (!previousName || activeTab === previousName)) {
      setActiveTabState(saved.name)
    }
  }, [activeTab, boardDialog.board, boardDialog.mode, context, reload])

  const removeBoard = useCallback(async (boardName: string) => {
    await runQuietly({ kind: 'delete-board', name: boardName })
  }, [runQuietly])

  const openGroupCreateDialog = useCallback(() => {
    setGroupDialog({ open: true, mode: 'create', group: null })
  }, [])

  const openGroupEditDialog = useCallback((group: Group) => {
    setGroupDialog({ open: true, mode: 'edit', group })
  }, [])

  const closeGroupDialog = useCallback(() => {
    setGroupDialog({ open: false, mode: 'create', group: null })
  }, [])

  const submitGroupDialog = useCallback(async (value: GroupSaveValue) => {
    const editedGroup = groupDialog.mode === 'edit' ? groupDialog.group : null
    const saved = await runQuietly(editedGroup
      ? {
        kind: 'update-group',
        previousBoard: editedGroup.board ?? value.board,
        previousName: editedGroup.name,
        name: value.name,
        color: value.color,
        columnKind: value.columnKind,
      }
      : { kind: 'create-group', board: value.board, name: value.name, color: value.color, columnKind: value.columnKind })
    if (saved) closeGroupDialog()
  }, [closeGroupDialog, groupDialog.group, groupDialog.mode, runQuietly])

  const removeGroup = useCallback(async (group: Group) => {
    if (await runQuietly({ kind: 'delete-group', board: group.board ?? 'default', name: group.name })) {
      closeGroupDialog()
    }
  }, [closeGroupDialog, runQuietly])

  const openPeoplePanel = useCallback((tab: 'people' | 'projects') => setPeoplePanel({ open: true, tab }), [])
  const closePeoplePanel = useCallback(() => setPeoplePanel((current) => ({ ...current, open: false })), [])

  // --- Pomodoro -----------------------------------------------------------
  // The backend keeps the timer of each library user, advances its phases,
  // logs each event and adds the hours to the linked task. The panel shows
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
      setPomodoroPresets(result.presets ?? [])
      setPomodoroToday(result.today ?? null)
      if (result.recordError) reportFailure(new Error(result.recordError), 'No se pudo registrar el pomodoro.')
      if (result.changed) await reload()
    } catch (pomodoroError) {
      reportFailure(pomodoroError, 'No se pudo actualizar el pomodoro.')
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

  return {
    settings,
    snapshot,
    context,
    isLoading,
    isSyncing,
    error,
    publicationConflict,
    setError,
    clearPublicationConflict,
    reloadPublicationConflict,
    setActiveTab,
    reload,
    executeIntent,
    undoToast,
    undo,
    dismissUndo,
    flashTaskId,
    createTask,
    addTaskComment,
    loadTaskSource,
    saveTaskSource,
    boardDialog,
    openBoardCreateDialog,
    openBoardEditDialog,
    closeBoardDialog,
    saveBoard,
    removeBoard,
    groupDialog,
    openGroupCreateDialog,
    openGroupEditDialog,
    closeGroupDialog,
    submitGroupDialog,
    removeGroup,
    peoplePanel,
    openPeoplePanel,
    closePeoplePanel,
    pomodoroPresets,
    pomodoroToday,
    runPomodoro,
  }
}
