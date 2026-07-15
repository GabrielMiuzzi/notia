import { Alert, Snackbar, ThemeProvider, createTheme } from '@mui/material'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react'
import { useConfirmationEngine } from '../../../context/confirmation/useConfirmationEngine'
import { NotiaButton } from '../../../components/common/NotiaButton'
import type { TaskManagerVaultRef } from '../types/taskManagerTypes'
import { isTaskInCancelledFolder, isTaskInFinishedFolder } from '../engines/taskEngine'
import { TASK_ICON_NAME, TaskManagerIcon } from '../engines/taskIconEngine'
import { TASKS_ROOT_FOLDER } from '../constants/taskManagerConstants'
import { useTaskManager } from '../hooks/useTaskManager'
import { toAbsoluteVaultPath } from '../utils/path'
import { notiaTimer } from '../../../services/runtime/notiaLogger'
import { TaskBoardView } from './boards/TaskBoardView'
import { TaskTableView } from './boards/TaskTableView'
import { BoardDialog } from './dialogs/BoardDialog'
import { GroupDialog } from './dialogs/GroupDialog'
import { TaskDialog } from './dialogs/TaskDialog'
import { PomodoroPanel } from './pomodoro/PomodoroPanel'
import '../styles/taskManager.css'

const FINISHED_TAB_ID = '__finished__'
const CANCELLED_TAB_ID = '__cancelled__'
const POMODORO_TAB_ID = '__pomodoro__'

export type { TaskManagerChatContext } from '../types/taskManagerTypes'

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#bd93f9' },
    secondary: { main: '#8be9fd' },
    background: { default: '#282a36', paper: '#303241' },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: 'Manrope, Segoe UI, sans-serif',
  },
})

interface TaskManagerAppProps {
  embedded?: boolean
  vault?: TaskManagerVaultRef | null
  onOpenTaskFile?: (taskPath: string) => void
  onActivePanelChange?: (panelId: string) => void
  onActiveChatContextChange?: (context: TaskManagerChatContext | null) => void
}

function TaskManagerAppComponent({
  embedded = false,
  vault = null,
  onOpenTaskFile,
  onActivePanelChange,
  onActiveChatContextChange,
}: TaskManagerAppProps) {
  const mountTimerRef = useRef(
    notiaTimer('task-manager', 'TaskManagerApp mount', {
      embedded: Boolean(embedded),
      vaultPath: vault?.path ?? null,
    }),
  )
  useEffect(() => {
    return () => {
      mountTimerRef.current.success()
    }
  }, [])

  const manager = useTaskManager(vault)
  const { confirm } = useConfirmationEngine()

  const activeBoard = manager.settings.activeTab
  const deferredTasks = useDeferredValue(manager.snapshot.tasks)
  const deferredDocuments = useDeferredValue(manager.snapshot.documents)
  const deferredGroups = useDeferredValue(manager.settings.groups)

  useEffect(() => {
    onActivePanelChange?.(activeBoard)
  }, [activeBoard, onActivePanelChange])

  const activeTabIsBoard = manager.settings.boards.some((board) => board.name === activeBoard)

  const activeBoardChatContext = useMemo(() => {
    if (!activeTabIsBoard || !manager.settings.activeVaultPath) {
      return null
    }

    const boardPrefix = `${TASKS_ROOT_FOLDER}/${activeBoard}/`
    const filePaths = deferredDocuments
      .map((document) => document.path)
      .filter((pathValue) => pathValue.startsWith(boardPrefix))
      .map((pathValue) => toAbsoluteVaultPath(manager.settings.activeVaultPath as string, pathValue))
      .sort((left, right) => left.localeCompare(right, 'es'))

    return {
      scopeKey: `task-manager:board:${activeBoard}`,
      filePaths,
    } satisfies TaskManagerChatContext
  }, [activeBoard, activeTabIsBoard, deferredDocuments, manager.settings.activeVaultPath])

  useEffect(() => {
    onActiveChatContextChange?.(activeBoardChatContext)
  }, [activeBoardChatContext, onActiveChatContextChange])

  const visibleGroups = useMemo(
    () => deferredGroups.filter((group) => (group.board ?? 'default') === activeBoard),
    [activeBoard, deferredGroups],
  )

  const finishedTasks = useMemo(
    () => deferredTasks.filter((task) => isTaskInFinishedFolder(task.filePath)),
    [deferredTasks],
  )

  const cancelledTasks = useMemo(
    () => deferredTasks.filter((task) => isTaskInCancelledFolder(task.filePath)),
    [deferredTasks],
  )

  const activeBoardTasks = useMemo(
    () => deferredTasks.filter((task) => task.board === activeBoard),
    [activeBoard, deferredTasks],
  )

  const activeBoardTasksCount = useMemo(
    () => activeBoardTasks
      .filter((task) => !isTaskInFinishedFolder(task.filePath) && !isTaskInCancelledFolder(task.filePath)).length,
    [activeBoardTasks],
  )

  const activePomodoroTasks = useMemo(
    () => deferredTasks.filter((task) => !isTaskInFinishedFolder(task.filePath) && !isTaskInCancelledFolder(task.filePath)),
    [deferredTasks],
  )

  const activeBoardConfig = manager.settings.boards.find((board) => board.name === activeBoard) ?? null

  const handleRemoveBoard = useCallback(async () => {
    const shouldRemove = await confirm({
      title: 'Eliminar tablero',
      message: `Desea eliminar el tablero "${activeBoard}"? Esta accion no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })

    if (!shouldRemove) {
      return
    }

    await manager.removeBoard(activeBoard)
  }, [activeBoard, confirm, manager])

  const handleDeleteTask = useCallback(async (task: Parameters<typeof manager.deleteTaskItem>[0]) => {
    const shouldDelete = await confirm({
      title: 'Eliminar tarea',
      message: `Desea eliminar la tarea "${task.title}"? Esta accion no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })

    if (!shouldDelete) {
      return
    }

    await manager.deleteTaskItem(task)
  }, [confirm, manager])

  const handleDeletePomodoroEntry = useCallback(async (entryId: string) => {
    const shouldDelete = await confirm({
      title: 'Eliminar registro',
      message: 'Desea eliminar este registro de pomodoro? Esta accion no se puede deshacer.',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })

    if (!shouldDelete) {
      return
    }

    await manager.deletePomodoroLogEntry(entryId)
  }, [confirm, manager])

  const handleDeleteGroup = useCallback(async () => {
    const group = manager.groupDialog.group
    if (!group) {
      return
    }

    const shouldDelete = await confirm({
      title: 'Eliminar grupo',
      message: `Desea eliminar el grupo "${group.name}"? Esta accion no se puede deshacer. Si tiene tareas activas, pasarán a desestimar.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })

    if (!shouldDelete) {
      return
    }

    await manager.removeGroup(group.name, group.board ?? 'default')
  }, [confirm, manager])

  const handleOpenBoardEditDialog = useCallback(() => {
    if (!activeBoardConfig) {
      return
    }
    manager.openBoardEditDialog(activeBoardConfig)
  }, [activeBoardConfig, manager])

  const handleOpenTaskFileWrapped = useCallback((taskPath: string) => {
    if (!onOpenTaskFile || !manager.settings.activeVaultPath) {
      return
    }

    onOpenTaskFile(toAbsoluteVaultPath(manager.settings.activeVaultPath, taskPath))
  }, [onOpenTaskFile, manager.settings.activeVaultPath])

  const handleOpenPomodoroTaskWrapped = useCallback((taskPath: string) => {
    manager.selectPomodoroTask(taskPath)
    manager.setActiveTab(POMODORO_TAB_ID)
  }, [manager])

  return (
    <ThemeProvider theme={theme}>
      <div className={`tareas-root${embedded ? ' is-embedded' : ''}`}>
        <div className="tareas-header">
          <div className="tareas-header-path">
            {manager.settings.activeVaultPath || 'Selecciona un vault para empezar'}
          </div>

          <h2 className="tareas-header-title">Tareas</h2>

          <div className="tareas-header-actions">
            {!manager.isVaultExternallyControlled ? (
              <NotiaButton className="tareas-btn-ghost" onClick={() => void manager.selectVault()}>
                <TaskManagerIcon name={TASK_ICON_NAME.folderKanban} size={14} />
                Vault
              </NotiaButton>
            ) : null}

            <NotiaButton className="tareas-btn-ghost" onClick={() => void manager.reload()}>
              <TaskManagerIcon name={TASK_ICON_NAME.refresh} size={14} />
              Refrescar
            </NotiaButton>

            <NotiaButton className="tareas-btn-new" onClick={manager.openBoardCreateDialog}>
              <TaskManagerIcon name={TASK_ICON_NAME.plus} size={14} />
              Nuevo tablero
            </NotiaButton>

            <NotiaButton
              className="tareas-btn-edit-board"
              onClick={handleOpenBoardEditDialog}
              disabled={!activeTabIsBoard}
            >
              Editar tablero
            </NotiaButton>

            <NotiaButton
              className="tareas-btn-delete-board"
              onClick={() => void handleRemoveBoard()}
              disabled={!activeTabIsBoard || activeBoard === 'default'}
            >
              Eliminar tablero
            </NotiaButton>
          </div>
        </div>

        <div className="tareas-tabs">
          {manager.settings.boards.map((board) => (
            <NotiaButton
              key={board.name}
              className={`tareas-tab-btn${manager.settings.activeTab === board.name ? ' is-active' : ''}`}
              onClick={() => manager.setActiveTab(board.name)}
            >
              {board.name}
              {board.name === activeBoard ? ` ${activeBoardTasksCount}` : ''}
            </NotiaButton>
          ))}

          <NotiaButton
            className={`tareas-tab-btn${manager.settings.activeTab === FINISHED_TAB_ID ? ' is-active' : ''}`}
            onClick={() => manager.setActiveTab(FINISHED_TAB_ID)}
          >
            Completadas {finishedTasks.length}
          </NotiaButton>

          <NotiaButton
            className={`tareas-tab-btn${manager.settings.activeTab === CANCELLED_TAB_ID ? ' is-active' : ''}`}
            onClick={() => manager.setActiveTab(CANCELLED_TAB_ID)}
          >
            Canceladas {cancelledTasks.length}
          </NotiaButton>

          <NotiaButton
            className={`tareas-tab-btn${manager.settings.activeTab === POMODORO_TAB_ID ? ' is-active' : ''}`}
            onClick={() => manager.setActiveTab(POMODORO_TAB_ID)}
          >
            Pomodoro
          </NotiaButton>

        </div>

        <div className="tareas-tab-content tareas-tab-content-animate">
          {activeTabIsBoard ? (
            <TaskBoardView
              boardName={activeBoard}
              groups={visibleGroups}
              tasks={activeBoardTasks}
              onCreateTask={manager.openTaskCreateDialog}
              onEditTask={manager.openTaskEditDialog}
              onChangeTaskState={manager.updateTaskState}
              onChangeTaskPriority={manager.updateTaskPriority}
              onChangeTaskDedicatedHours={manager.updateTaskDedicatedHours}
              onToggleSubtaskDone={manager.toggleSubtaskDone}
              onAddTaskComment={manager.addTaskComment}
              onLoadTaskSource={manager.loadTaskSource}
              onSaveTaskSource={manager.saveTaskSource}
              onOpenTaskFile={handleOpenTaskFileWrapped}
              onCreateGroup={manager.openGroupCreateDialog}
              onEditGroup={manager.openGroupEditDialog}
              onOpenPomodoroTask={handleOpenPomodoroTaskWrapped}
              onReorderGroups={manager.reorderGroupsInBoard}
              onApplyTaskArrangement={manager.applyTaskArrangement}
            />
          ) : null}

          {manager.settings.activeTab === FINISHED_TAB_ID ? (
            <TaskTableView
              title="Tareas completadas"
              tasks={finishedTasks}
              onChangeTaskState={manager.updateTaskState}
              onDeleteTask={handleDeleteTask}
            />
          ) : null}

          {manager.settings.activeTab === CANCELLED_TAB_ID ? (
            <TaskTableView
              title="Tareas canceladas"
              tasks={cancelledTasks}
              onChangeTaskState={manager.updateTaskState}
              onDeleteTask={handleDeleteTask}
            />
          ) : null}

          {manager.settings.activeTab === POMODORO_TAB_ID ? (
            <PomodoroPanel
              state={manager.settings.pomodoro}
              tasks={activePomodoroTasks}
              entries={manager.snapshot.pomodoroEntries}
              onSelectTask={manager.selectPomodoroTask}
              onStart={manager.startPomodoroCycle}
              onPause={manager.pausePomodoroCycle}
              onResume={manager.resumePomodoroCycle}
              onReset={manager.resetPomodoroCycle}
              onEnterDeviation={manager.enterPomodoroDeviationMode}
              onExitDeviation={manager.exitPomodoroDeviationMode}
              onSetDurations={manager.setPomodoroDurations}
              onDeleteEntry={handleDeletePomodoroEntry}
              onNotify={manager.setInfoMessage}
            />
          ) : null}

        </div>

        <TaskDialog
          open={manager.taskDialog.open}
          mode={manager.taskDialog.mode}
          task={manager.taskDialog.task}
          boardName={manager.settings.activeTab}
          createDefaults={manager.taskCreateDefaults}
          groups={visibleGroups}
          states={manager.taskStates}
          priorities={manager.taskPriorities}
          onClose={manager.closeTaskDialog}
          onSubmit={manager.submitTaskDialog}
        />

        <BoardDialog
          open={manager.boardDialog.open}
          mode={manager.boardDialog.mode}
          board={manager.boardDialog.board}
          onClose={manager.closeBoardDialog}
          onSubmit={manager.submitBoardDialog}
        />

        <GroupDialog
          open={manager.groupDialog.open}
          mode={manager.groupDialog.mode}
          group={manager.groupDialog.group}
          boards={manager.settings.boards}
          activeBoard={activeBoard}
          onClose={manager.closeGroupDialog}
          onSubmit={manager.submitGroupDialog}
          onDelete={handleDeleteGroup}
        />

        <Snackbar open={Boolean(manager.error)} autoHideDuration={4800} onClose={() => manager.setError(null)}>
          <Alert severity="error" variant="filled" onClose={() => manager.setError(null)}>
            {manager.error}
          </Alert>
        </Snackbar>

        <Snackbar open={Boolean(manager.infoMessage)} autoHideDuration={3000} onClose={() => manager.setInfoMessage(null)}>
          <Alert severity="success" variant="filled" onClose={() => manager.setInfoMessage(null)}>
            {manager.infoMessage}
          </Alert>
        </Snackbar>
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
  if (previous.embedded !== next.embedded) {
    return false
  }

  if ((previous.vault?.path ?? '') !== (next.vault?.path ?? '')) {
    return false
  }

  if ((previous.vault?.androidTreeUri ?? '') !== (next.vault?.androidTreeUri ?? '')) {
    return false
  }

  if (previous.onOpenTaskFile !== next.onOpenTaskFile) {
    return false
  }

  if (previous.onActivePanelChange !== next.onActivePanelChange) {
    return false
  }

  if (previous.onActiveChatContextChange !== next.onActiveChatContextChange) {
    return false
  }

  return true
}
