import { ThemeProvider, createTheme } from '@mui/material'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useConfirmationEngine } from '../../../context/confirmation/useConfirmationEngine'
import { NotiaButton } from '../../../components/common/NotiaButton'
import type { LibraryContext } from '../../../services/contexts/libraryContexts'
import { notiaTimer } from '../../../services/runtime/notiaLogger'
import type { Group, TaskItem, TaskManagerChatContext, TaskManagerVaultRef } from '../types/taskManagerTypes'
import type { ManagementRequest } from '../types/managementTypes'
import type { TaskBoardIntent } from '../services/taskManagerService'
import { loadBoardViewPreferences, saveBoardViewPreferences, type TaskBoardViewMode } from '../services/taskManagerStorage'
import {
  archiveFilterOptions,
  filterArchiveRows,
  filterTasks,
  hasTaskFilters,
  NO_TASK_FILTERS,
  taskFilterOptions,
  type TaskFilters,
} from '../utils/taskFilters'
import { useTaskManager } from '../hooks/useTaskManager'
import { DEFAULT_MANAGEMENT_REQUEST, useManagementView } from '../hooks/useManagementView'
import { TaskManagerHeader } from './shell/TaskManagerHeader'
import { CANCELLED_TAB_ID, FINISHED_TAB_ID, POMODORO_TAB_ID, TaskManagerTabs } from './shell/TaskManagerTabs'
import { TaskFilterRow, type FilterField } from './shell/TaskFilterRow'
import { TaskToasts } from './shell/TaskToasts'
import { TaskKanbanView } from './board/TaskKanbanView'
import { TaskListView } from './list/TaskListView'
import { TaskManagementView } from './management/TaskManagementView'
import { TaskArchiveView } from './archive/TaskArchiveView'
import { PomodoroPanel } from './pomodoro/PomodoroPanel'
import { BoardEditDialog } from './dialogs/BoardEditDialog'
import { BoardPeopleDrawer } from './people/BoardPeopleDrawer'
import { GroupDialog } from './dialogs/GroupDialog'
import { TaskCommentDialog } from './dialogs/TaskCommentDialog'
import { TaskSourceDialog, type TaskSourceDialogState } from './dialogs/TaskSourceDialog'
import '../styles/taskManagerTokens.css'
import '../styles/taskManager.css'
import '../styles/taskShell.css'

export type { TaskManagerChatContext } from '../types/taskManagerTypes'

// The column and ticket dialogs still use MUI fields.
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#4fd1c5' },
    secondary: { main: '#6c8eff' },
    background: { default: '#0f1420', paper: '#1b2438' },
    text: { primary: '#edf0f5', secondary: '#8892a6' },
    divider: '#29334a',
  },
  shape: { borderRadius: 8 },
  typography: { fontFamily: 'Public Sans, Segoe UI, sans-serif' },
})

interface TaskManagerAppProps {
  embedded?: boolean
  vault?: TaskManagerVaultRef | null
  publishedBoardNames?: readonly string[]
  canManageBoards?: boolean
  onOpenTaskFile?: (taskPath: string) => void
  /** Opens a ticket in this page's own editor (a published Task Manager). */
  onOpenTask?: (task: TaskItem) => void
  onActivePanelChange?: (panelId: string) => void
  onActiveChatContextChange?: (context: TaskManagerChatContext | null) => void
  onPublishedChatContextChange?: (context: TaskManagerChatContext | null) => void
  contexts?: LibraryContext[]
}

const STATE_OPTIONS = ['Pendiente', 'En progreso', 'Bloqueada']
const PRIORITY_OPTIONS = ['Atrasado', 'Urgente', 'Alta', 'Media', 'Baja']

/** «C:/Users/…/gaia» without the `//?/` prefix of extended Windows paths. */
function readablePath(path: string): string {
  return path.replace(/^(\\\\\?\\|\/\/\?\/)/, '').replace(/\\/g, '/')
}

function libraryLabel(path: string | null): { name: string; path: string } | null {
  if (!path) return null
  // A SAF tree is an opaque identifier: only its name is shown.
  if (path.startsWith('content://')) {
    const name = decodeURIComponent(path.split('%3A').pop() ?? '').split('/').pop() || 'Biblioteca'
    return { name, path: name }
  }
  const readable = readablePath(path).replace(/\/+$/, '')
  return { name: readable.split('/').pop() || readable, path: readable }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function TaskManagerAppComponent({
  embedded = false,
  vault = null,
  publishedBoardNames,
  canManageBoards = true,
  onOpenTaskFile,
  onOpenTask,
  onActivePanelChange,
  onActiveChatContextChange,
  onPublishedChatContextChange,
  contexts = [],
}: TaskManagerAppProps) {
  const mountTimerRef = useRef(
    notiaTimer('task-manager', 'TaskManagerApp mount', {
      embedded: Boolean(embedded),
      vaultPath: vault?.path ?? null,
    }),
  )
  useEffect(() => {
    const mountTimer = mountTimerRef.current
    return () => {
      mountTimer.success()
    }
  }, [])

  const manager = useTaskManager(vault)
  const { confirm } = useConfirmationEngine()
  const { snapshot, settings } = manager
  const activeTab = settings.activeTab
  const searchRef = useRef<HTMLInputElement>(null)

  const deferredTasks = useDeferredValue(snapshot.tasks)
  const publishedBoardNameSet = useMemo(() => (
    publishedBoardNames
      ? new Set(publishedBoardNames.map((boardName) => boardName.trim().toLowerCase()))
      : null
  ), [publishedBoardNames])
  const visibleTasks = useMemo(() => (
    publishedBoardNameSet
      ? deferredTasks.filter((task) => publishedBoardNameSet.has(task.board.trim().toLowerCase()))
      : deferredTasks
  ), [deferredTasks, publishedBoardNameSet])
  const openTasks = useMemo(
    () => visibleTasks.filter((task) => task.state !== 'Finalizada' && task.state !== 'Cancelada'),
    [visibleTasks],
  )

  const activeBoard = settings.boards.find((board) => board.name === activeTab) ?? null
  const boardGroups = useMemo(
    () => settings.groups.filter((group) => (group.board ?? 'default') === activeTab),
    [activeTab, settings.groups],
  )
  // Open tasks of the board, and the finished subtasks of their checklists.
  const boardTasks = useMemo(() => visibleTasks.filter((task) => (
    task.board === activeTab
      && task.state !== 'Cancelada'
      && (task.state !== 'Finalizada' || Boolean(task.parentTaskName.trim()))
  )), [activeTab, visibleTasks])

  useEffect(() => {
    onActivePanelChange?.(activeTab)
  }, [activeTab, onActivePanelChange])

  const activeBoardChatContext = useMemo(() => {
    if (!settings.activeVaultPath) return null
    return {
      scopeKey: `task-manager:panel:${activeTab}`,
      filePaths: snapshot.panelPaths[activeTab] ?? [],
    } satisfies TaskManagerChatContext
  }, [activeTab, snapshot.panelPaths, settings.activeVaultPath])

  useEffect(() => {
    onActiveChatContextChange?.(activeBoardChatContext)
  }, [activeBoardChatContext, onActiveChatContextChange])

  const publishedChatContext = useMemo(() => {
    if (!settings.activeVaultPath || !publishedBoardNameSet) return null
    return {
      scopeKey: `task-manager:panel:${activeTab}`,
      filePaths: Array.from(new Set(visibleTasks.map((task) => task.path)))
        .sort((left, right) => left.localeCompare(right, 'es')),
    } satisfies TaskManagerChatContext
  }, [activeTab, settings.activeVaultPath, publishedBoardNameSet, visibleTasks])

  useEffect(() => {
    onPublishedChatContextChange?.(publishedChatContext)
  }, [onPublishedChatContextChange, publishedChatContext])

  // --- View of the board: remembered per board on this device -------------
  const [viewMode, setViewMode] = useState<TaskBoardViewMode>('board')
  const [collapsedBoard, setCollapsedBoard] = useState<Record<string, boolean>>({})
  const [collapsedList, setCollapsedList] = useState<Record<string, boolean>>({})
  useEffect(() => {
    const preferences = loadBoardViewPreferences(activeTab)
    setViewMode(preferences.mode ?? 'board')
    setCollapsedBoard(preferences.collapsedBoard ?? {})
    setCollapsedList(preferences.collapsedList ?? {})
  }, [activeTab])
  const changeViewMode = useCallback((mode: TaskBoardViewMode) => {
    setViewMode(mode)
    saveBoardViewPreferences(activeTab, { mode })
  }, [activeTab])
  const toggleCollapsedBoard = useCallback((groupName: string, collapsed: boolean) => {
    setCollapsedBoard((current) => {
      const next = { ...current, [groupName]: collapsed }
      saveBoardViewPreferences(activeTab, { collapsedBoard: next })
      return next
    })
  }, [activeTab])
  const toggleCollapsedList = useCallback((groupName: string, collapsed: boolean) => {
    setCollapsedList((current) => {
      const next = { ...current, [groupName]: collapsed }
      saveBoardViewPreferences(activeTab, { collapsedList: next })
      return next
    })
  }, [activeTab])

  // --- Search and filters: they only choose what shows --------------------
  const [filters, setFilters] = useState<TaskFilters>(NO_TASK_FILTERS)
  const isArchiveTab = activeTab === FINISHED_TAB_ID || activeTab === CANCELLED_TAB_ID
  useEffect(() => {
    setFilters((current) => ({ ...NO_TASK_FILTERS, query: current.query }))
  }, [activeTab])
  const archiveRows = activeTab === FINISHED_TAB_ID ? snapshot.archive.finished : snapshot.archive.cancelled
  const filteredBoardTasks = useMemo(() => filterTasks(boardTasks, filters), [boardTasks, filters])
  const filteredArchiveRows = useMemo(() => filterArchiveRows(archiveRows, filters), [archiveRows, filters])
  const filterFields = useMemo<FilterField[]>(() => {
    if (isArchiveTab) {
      const options = archiveFilterOptions(archiveRows)
      return [
        { key: 'group', label: 'Grupo', allLabel: 'Todos', options: options.groups },
        { key: 'priority', label: 'Prioridad', allLabel: 'Todas', options: PRIORITY_OPTIONS },
        { key: 'project', label: 'Proyecto', allLabel: 'Todos', options: options.projects },
        { key: 'person', label: 'Persona', allLabel: 'Todas', options: options.people },
      ]
    }
    const options = taskFilterOptions(boardTasks)
    return [
      { key: 'state', label: 'Estado', allLabel: 'Todos', options: STATE_OPTIONS },
      { key: 'priority', label: 'Prioridad', allLabel: 'Todas', options: PRIORITY_OPTIONS },
      { key: 'project', label: 'Proyecto', allLabel: 'Todos', options: activeBoard?.projects.map((project) => project.name) ?? options.projects },
      { key: 'person', label: 'Persona', allLabel: 'Todas', options: activeBoard?.members.map((member) => member.name) ?? options.people },
    ]
  }, [activeBoard, archiveRows, boardTasks, isArchiveTab])
  const searching = filters.query.trim().length > 0
  const resultCount = !searching
    ? null
    : isArchiveTab
      ? filteredArchiveRows.length
      : filteredBoardTasks.filter((task) => !task.parentTaskName.trim()).length

  // --- Management --------------------------------------------------------
  const [managementRequest, setManagementRequest] = useState<ManagementRequest>(DEFAULT_MANAGEMENT_REQUEST)
  const management = useManagementView(
    manager.context,
    activeBoard?.name ?? null,
    managementRequest,
    snapshot.generation,
    Boolean(activeBoard) && viewMode === 'management',
  )

  // --- Ticket dialogs ------------------------------------------------------
  const [sourceDialog, setSourceDialog] = useState<TaskSourceDialogState | null>(null)
  const [commentTask, setCommentTask] = useState<TaskItem | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const openTask = useCallback((task: TaskItem) => {
    if (!settings.activeVaultPath) return
    if (onOpenTask) onOpenTask(task)
    else onOpenTaskFile?.(task.path)
  }, [onOpenTask, onOpenTaskFile, settings.activeVaultPath])

  const openTaskByPath = useCallback((taskPath: string) => {
    const task = snapshot.tasks.find((item) => item.filePath === taskPath)
    if (task) openTask(task)
  }, [openTask, snapshot.tasks])

  const editSource = useCallback(async (task: TaskItem) => {
    setSourceDialog({ task, originalSource: '', source: '', isLoading: true, isSaving: false, loadError: null })
    try {
      const source = await manager.loadTaskSource(task.filePath)
      setSourceDialog({ task, originalSource: source, source, isLoading: false, isSaving: false, loadError: null })
    } catch (error) {
      // Without the content there is nothing to edit: saving would wipe the task.
      setSourceDialog({
        task,
        originalSource: '',
        source: '',
        isLoading: false,
        isSaving: false,
        loadError: error instanceof Error && error.message ? error.message : 'No se pudo leer la tarea.',
      })
    }
  }, [manager])

  const saveSource = useCallback(async () => {
    if (!sourceDialog) return
    setSourceDialog((previous) => previous ? { ...previous, isSaving: true } : previous)
    try {
      await manager.saveTaskSource(sourceDialog.task.filePath, sourceDialog.source)
      setSourceDialog(null)
    } catch {
      setSourceDialog((previous) => previous ? { ...previous, isSaving: false } : previous)
    }
  }, [manager, sourceDialog])

  const submitComment = useCallback(async (task: TaskItem, comment: string) => {
    await manager.addTaskComment(task.filePath, comment)
    setCommentTask(null)
  }, [manager])

  // --- Board and column actions -------------------------------------------
  const removeActiveBoard = useCallback(async () => {
    if (!activeBoard) return
    const accepted = await confirm({
      title: 'Eliminar tablero',
      message: `¿Eliminar el tablero «${activeBoard.name}»? Solo se puede eliminar un tablero sin tareas ni columnas.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })
    if (accepted) await manager.removeBoard(activeBoard.name)
  }, [activeBoard, confirm, manager])

  const removeGroup = useCallback(async (group: Group) => {
    const accepted = await confirm({
      title: 'Eliminar columna',
      message: `¿Eliminar la columna «${group.name}»? Solo se puede eliminar una columna sin tareas.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })
    if (accepted) await manager.removeGroup(group)
  }, [confirm, manager])

  const intent = useCallback((value: TaskBoardIntent) => manager.executeIntent(value), [manager])
  const quietIntent = useCallback(async (value: TaskBoardIntent) => {
    try {
      await manager.executeIntent(value)
    } catch {
      // The error toast already shows it.
    }
  }, [manager])

  const canCreateTask = Boolean(activeBoard) && !isArchiveTab && activeTab !== POMODORO_TAB_ID

  // N: new task; /: search. Never while typing or with modifiers.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || isTyping(event.target)) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (event.key === '/' && activeTab !== POMODORO_TAB_ID) {
        event.preventDefault()
        searchRef.current?.focus()
      } else if ((event.key === 'n' || event.key === 'N') && canCreateTask) {
        event.preventDefault()
        void manager.createTask()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activeTab, canCreateTask, manager])

  const boardActions = {
    onIntent: intent,
    onOpenTask: openTask,
    onEditSource: (task: TaskItem) => void editSource(task),
    onComment: setCommentTask,
    onOpenPeoplePanel: manager.openPeoplePanel,
  }
  const boardViewProps = activeBoard ? {
    ...boardActions,
    board: activeBoard,
    groups: boardGroups,
    tasks: filteredBoardTasks,
    allTasks: boardTasks,
    searchActive: hasTaskFilters(filters),
    showDescriptions: true,
    flashTaskId: manager.flashTaskId,
    canEdit: true,
    onCreateTask: (groupName: string) => void manager.createTask(groupName),
    onCreateGroup: manager.openGroupCreateDialog,
    onEditGroup: manager.openGroupEditDialog,
    onDeleteGroup: (group: Group) => void removeGroup(group),
  } : null

  return (
    <ThemeProvider theme={theme}>
      <div className={`tareas-root tm-shell${embedded ? ' is-embedded' : ''}`}>
        <TaskManagerHeader
          library={libraryLabel(settings.activeVaultPath)}
          board={activeBoard}
          canManageBoards={canManageBoards}
          canCreateTask={canCreateTask}
          onOpenPeople={manager.openPeoplePanel}
          onRefresh={() => void manager.reload()}
          onEditBoard={() => activeBoard && manager.openBoardEditDialog(activeBoard)}
          onNewBoard={manager.openBoardCreateDialog}
          onDeleteBoard={() => void removeActiveBoard()}
          onNewTask={() => void manager.createTask()}
        />

        {manager.publicationConflict ? (
          <div className="tm-conflict" role="alert">
            <p>
              <strong>Conflicto de colaboración.</strong>{' '}
              La operación {manager.publicationConflict.operationId.slice(0, 8)} necesita una revisión actualizada
              (esperada {manager.publicationConflict.expectedRevision ?? '—'}, actual {manager.publicationConflict.currentRevision ?? '—'}).
            </p>
            <div className="tm-conflict-actions">
              <NotiaButton onClick={() => void manager.reloadPublicationConflict()}>Recargar estado</NotiaButton>
              <NotiaButton onClick={manager.clearPublicationConflict}>Cerrar</NotiaButton>
            </div>
          </div>
        ) : null}

        <TaskManagerTabs
          boards={settings.boards}
          activeTab={activeTab}
          finishedCount={snapshot.finishedCount}
          cancelledCount={snapshot.cancelledCount}
          canManageBoards={canManageBoards}
          onSelect={manager.setActiveTab}
          onNewBoard={manager.openBoardCreateDialog}
          onEditBoard={manager.openBoardEditDialog}
        />

        {activeTab !== POMODORO_TAB_ID ? (
          <TaskFilterRow
            filters={filters}
            onChange={setFilters}
            fields={filterFields}
            searchLabel={activeTab === FINISHED_TAB_ID ? 'Buscar en completadas' : activeTab === CANCELLED_TAB_ID ? 'Buscar en canceladas' : 'Buscar tareas, personas o proyectos'}
            resultCount={resultCount}
            searchRef={searchRef}
            viewMode={activeBoard ? viewMode : undefined}
            onViewModeChange={activeBoard ? changeViewMode : undefined}
          />
        ) : null}

        <div className="tm-content">
          {boardViewProps && viewMode === 'board' ? (
            <TaskKanbanView {...boardViewProps} collapsed={collapsedBoard} onToggleCollapsed={toggleCollapsedBoard} />
          ) : null}
          {boardViewProps && viewMode === 'list' ? (
            <TaskListView {...boardViewProps} collapsed={collapsedList} onToggleCollapsed={toggleCollapsedList} />
          ) : null}
          {activeBoard && viewMode === 'management' ? (
            <TaskManagementView
              view={management.view}
              loading={management.loading}
              error={management.error}
              request={managementRequest}
              onRequestChange={setManagementRequest}
              onSetPredecessors={async (taskPath, dependencyPaths) => {
                await manager.executeIntent({ kind: 'set-dependencies', taskPath, dependencyPaths })
              }}
              onOpenTask={openTaskByPath}
              canEdit
            />
          ) : null}
          {isArchiveTab ? (
            <TaskArchiveView
              key={activeTab}
              kind={activeTab === FINISHED_TAB_ID ? 'finished' : 'cancelled'}
              rows={filteredArchiveRows}
              total={archiveRows.length}
              onOpen={(row) => openTaskByPath(row.taskPath)}
              onRestore={(taskPaths) => quietIntent({ kind: 'restore-tasks', taskPaths })}
              onDelete={(taskPaths) => quietIntent({ kind: 'delete-tasks', taskPaths })}
              canEdit
            />
          ) : null}
          {activeTab === POMODORO_TAB_ID ? (
            <PomodoroPanel
              state={settings.pomodoro}
              presets={manager.pomodoroPresets}
              today={manager.pomodoroToday}
              boards={settings.boards.filter((board) => !publishedBoardNameSet || publishedBoardNameSet.has(board.name.toLowerCase()))}
              tasks={openTasks}
              onAction={manager.runPomodoro}
              onNotify={setNotice}
            />
          ) : null}
          {!activeBoard && !isArchiveTab && activeTab !== POMODORO_TAB_ID && !manager.isLoading ? (
            <p className="tm-empty">{settings.activeVaultPath ? 'No hay tableros todavía.' : 'Abrí una biblioteca para usar Task Manager.'}</p>
          ) : null}
        </div>

        <BoardEditDialog
          open={manager.boardDialog.open}
          mode={manager.boardDialog.mode}
          board={manager.boardDialog.board}
          palette={snapshot.palette}
          contexts={contexts}
          context={manager.context ?? { libraryId: '', libraryUserId: '' }}
          lockNameAndColor={manager.boardDialog.board?.name === 'default'}
          onClose={manager.closeBoardDialog}
          onSave={manager.saveBoard}
        />

        <BoardPeopleDrawer
          open={manager.peoplePanel.open}
          board={activeBoard}
          palette={snapshot.palette}
          initialTab={manager.peoplePanel.tab}
          onClose={manager.closePeoplePanel}
          onAddMember={async (name) => { await intent({ kind: 'add-board-member', board: activeBoard?.name ?? '', name }) }}
          onRemoveMember={async (name) => { await intent({ kind: 'remove-board-member', board: activeBoard?.name ?? '', name }) }}
          onAddProject={async (name, color) => { await intent({ kind: 'add-board-project', board: activeBoard?.name ?? '', name, color }) }}
          onRemoveProject={async (name) => { await intent({ kind: 'remove-board-project', board: activeBoard?.name ?? '', name }) }}
        />

        <GroupDialog
          open={manager.groupDialog.open}
          mode={manager.groupDialog.mode}
          group={manager.groupDialog.group}
          boards={settings.boards}
          activeBoard={activeTab}
          columnKinds={snapshot.columnKinds}
          onClose={manager.closeGroupDialog}
          onSubmit={manager.submitGroupDialog}
          onDelete={() => manager.groupDialog.group && void removeGroup(manager.groupDialog.group)}
        />

        <TaskCommentDialog task={commentTask} onClose={() => setCommentTask(null)} onSubmit={submitComment} />

        {sourceDialog ? (
          <TaskSourceDialog
            state={sourceDialog}
            libraryId={vault?.libraryId}
            contexts={contexts}
            onSourceChange={(source) => {
              setSourceDialog((previous) => previous ? { ...previous, source } : previous)
            }}
            onSave={() => void saveSource()}
            onClose={() => setSourceDialog(null)}
            onOpenLinkedFile={onOpenTaskFile}
          />
        ) : null}

        <TaskToasts
          undo={manager.undoToast}
          onUndo={() => void manager.undo()}
          onDismissUndo={manager.dismissUndo}
          error={manager.error}
          onDismissError={() => manager.setError(null)}
          notice={notice}
          onDismissNotice={() => setNotice(null)}
        />
      </div>
    </ThemeProvider>
  )
}

export const TaskManagerApp = memo(TaskManagerAppComponent, areTaskManagerAppPropsEqual)
TaskManagerApp.displayName = 'TaskManagerApp'

function areTaskManagerAppPropsEqual(
  previous: TaskManagerAppProps,
  next: TaskManagerAppProps,
): boolean {
  return previous.embedded === next.embedded
    && (previous.vault?.path ?? '') === (next.vault?.path ?? '')
    && (previous.vault?.libraryId ?? '') === (next.vault?.libraryId ?? '')
    && (previous.vault?.androidTreeUri ?? '') === (next.vault?.androidTreeUri ?? '')
    && sameBoardNames(previous.publishedBoardNames, next.publishedBoardNames)
    && previous.canManageBoards === next.canManageBoards
    && previous.onOpenTaskFile === next.onOpenTaskFile
    && previous.onOpenTask === next.onOpenTask
    && previous.onActivePanelChange === next.onActivePanelChange
    && previous.onActiveChatContextChange === next.onActiveChatContextChange
    && previous.onPublishedChatContextChange === next.onPublishedChatContextChange
    && previous.contexts === next.contexts
}

function sameBoardNames(previous?: readonly string[], next?: readonly string[]): boolean {
  if (previous === next) return true
  if (!previous || !next || previous.length !== next.length) return false
  return previous.every((boardName, index) => boardName === next[index])
}
