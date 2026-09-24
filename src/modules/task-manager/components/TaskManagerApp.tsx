import { Alert, Snackbar, ThemeProvider, createTheme } from '@mui/material'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react'
import { useConfirmationEngine } from '../../../context/confirmation/useConfirmationEngine'
import { NotiaButton } from '../../../components/common/NotiaButton'
import type { TaskManagerChatContext, TaskManagerVaultRef } from '../types/taskManagerTypes'
import type { LibraryContext } from '../../../services/contexts/libraryContexts'
import { TASK_ICON_NAME, TaskManagerIcon } from '../engines/taskIconEngine'
import { useTaskManager } from '../hooks/useTaskManager'
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
    primary: { main: '#4fd1c5' },
    secondary: { main: '#6c8eff' },
    background: { default: '#0f1420', paper: '#1b2438' },
    text: { primary: '#edf0f5', secondary: '#8892a6' },
    divider: '#29334a',
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
  publishedBoardNames?: readonly string[]
  canManageBoards?: boolean
  onOpenTaskFile?: (taskPath: string) => void
  onActivePanelChange?: (panelId: string) => void
  onActiveChatContextChange?: (context: TaskManagerChatContext | null) => void
  onPublishedChatContextChange?: (context: TaskManagerChatContext | null) => void
  contexts?: LibraryContext[]
}

function TaskManagerAppComponent({
  embedded = false,
  vault = null,
  publishedBoardNames,
  canManageBoards = true,
  onOpenTaskFile,
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

  const activeBoard = manager.settings.activeTab
  const deferredTasks = useDeferredValue(manager.snapshot.tasks)
  const panelPaths = manager.snapshot.panelPaths
  const deferredGroups = useDeferredValue(manager.settings.groups)
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

  useEffect(() => {
    onActivePanelChange?.(activeBoard)
  }, [activeBoard, onActivePanelChange])

  const activeTabIsBoard = manager.settings.boards.some((board) => board.name === activeBoard)

  const activeBoardChatContext = useMemo(() => {
    if (!manager.settings.activeVaultPath) {
      return null
    }

    return {
      scopeKey: `task-manager:panel:${activeBoard}`,
      filePaths: panelPaths[activeBoard] ?? [],
    } satisfies TaskManagerChatContext
  }, [activeBoard, panelPaths, manager.settings.activeVaultPath])

  useEffect(() => {
    onActiveChatContextChange?.(activeBoardChatContext)
  }, [activeBoardChatContext, onActiveChatContextChange])

  const publishedChatContext = useMemo(() => {
    if (!manager.settings.activeVaultPath || !publishedBoardNameSet) return null
    return {
      scopeKey: `task-manager:panel:${activeBoard}`,
      filePaths: Array.from(new Set(visibleTasks.map((task) => task.path)))
        .sort((left, right) => left.localeCompare(right, 'es')),
    } satisfies TaskManagerChatContext
  }, [activeBoard, manager.settings.activeVaultPath, publishedBoardNameSet, visibleTasks])

  useEffect(() => {
    onPublishedChatContextChange?.(publishedChatContext)
  }, [onPublishedChatContextChange, publishedChatContext])

  const visibleGroups = useMemo(
    () => deferredGroups.filter((group) => (group.board ?? 'default') === activeBoard),
    [activeBoard, deferredGroups],
  )

  const finishedPaths = useMemo(() => new Set(panelPaths[FINISHED_TAB_ID] ?? []), [panelPaths])
  const cancelledPaths = useMemo(() => new Set(panelPaths[CANCELLED_TAB_ID] ?? []), [panelPaths])
  const isArchived = useCallback(
    (taskPath: string) => finishedPaths.has(taskPath) || cancelledPaths.has(taskPath),
    [cancelledPaths, finishedPaths],
  )

  const finishedTasks = useMemo(
    () => visibleTasks.filter((task) => finishedPaths.has(task.filePath)),
    [finishedPaths, visibleTasks],
  )

  const cancelledTasks = useMemo(
    () => visibleTasks.filter((task) => cancelledPaths.has(task.filePath)),
    [cancelledPaths, visibleTasks],
  )

  const activeBoardTasks = useMemo(
    () => visibleTasks.filter((task) => task.board === activeBoard),
    [activeBoard, visibleTasks],
  )

  const activeBoardTasksCount = useMemo(
    () => activeBoardTasks.filter((task) => !isArchived(task.filePath)).length,
    [activeBoardTasks, isArchived],
  )

  const activePomodoroTasks = useMemo(
    () => visibleTasks.filter((task) => !isArchived(task.filePath)),
    [isArchived, visibleTasks],
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
    // The board sends the ticket's logical path; the editor opens the path
    // the explorer shows, as the backend reported it.
    const task = manager.snapshot.tasks.find((item) => item.filePath === taskPath)
    if (task) onOpenTaskFile(task.path)
  }, [onOpenTaskFile, manager.settings.activeVaultPath, manager.snapshot.tasks])

  const handleOpenPomodoroTaskWrapped = useCallback((taskPath: string) => {
    manager.selectPomodoroTask(taskPath)
    manager.setActiveTab(POMODORO_TAB_ID)
  }, [manager])

  const handleReloadPublicationConflict = useCallback(() => {
    void manager.reloadPublicationConflict().catch((runtimeError: unknown) => {
      manager.setError(runtimeError instanceof Error ? runtimeError.message : 'No se pudo recargar el estado compartido.')
    })
  }, [manager])

  return (
    <ThemeProvider theme={theme}>
      <div className={`tareas-root${embedded ? ' is-embedded' : ''}`}>
        <div className="tareas-header">
          <div className="tareas-header-heading">
            <h2 className="tareas-header-title">Tareas</h2>
            <div className="tareas-header-path">
              {manager.settings.activeVaultPath || 'Abrí una biblioteca para usar Task Manager'}
            </div>
          </div>

          <div className="tareas-header-actions">
            <span className="tareas-header-summary">
              <strong>{finishedTasks.length}</strong> completadas · <strong>{cancelledTasks.length}</strong> canceladas
            </span>

            <NotiaButton className="tareas-btn-ghost" onClick={() => void manager.reload()}>
              <TaskManagerIcon name={TASK_ICON_NAME.refresh} size={14} />
              Refrescar
            </NotiaButton>

            {canManageBoards ? (
              <>
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
              </>
            ) : null}

            <NotiaButton
              className="tareas-btn-new-task"
              onClick={() => manager.openTaskCreateDialog({ kind: 'task' })}
              disabled={!activeTabIsBoard}
            >
              <TaskManagerIcon name={TASK_ICON_NAME.plus} size={14} />
              Nueva tarea
            </NotiaButton>
          </div>
        </div>

        {manager.publicationConflict ? (
          <Alert
            severity="warning"
            variant="outlined"
            sx={{ m: 1.5, mb: 0, alignItems: 'center' }}
            action={(
              <div className="tareas-conflict-actions">
                <NotiaButton onClick={handleReloadPublicationConflict}>Recargar estado</NotiaButton>
                <NotiaButton variant="primary" onClick={manager.clearPublicationConflict}>Reintentar</NotiaButton>
                <NotiaButton onClick={manager.clearPublicationConflict}>Cancelar</NotiaButton>
              </div>
            )}
          >
            <strong>Conflicto de colaboración.</strong>{' '}
            La operación {manager.publicationConflict.operationId.slice(0, 8)} necesita una revisión actualizada
            (esperada {manager.publicationConflict.expectedRevision ?? '—'}, actual {manager.publicationConflict.currentRevision ?? '—'}).
            {manager.publicationConflict.actorId ? ` Cambio concurrente de ${manager.publicationConflict.actorId.slice(0, 8)}.` : ''}
            {manager.publicationConflict.conflictingOperationId ? ` Operación ${manager.publicationConflict.conflictingOperationId.slice(0, 8)}.` : ''}
            El formulario queda abierto para reintentar.
          </Alert>
        ) : null}

        <div className="tareas-tabs">
          {manager.settings.boards.map((board) => (
            <NotiaButton
              key={board.name}
              className={`tareas-tab-btn${manager.settings.activeTab === board.name ? ' is-active' : ''}`}
              onClick={() => manager.setActiveTab(board.name)}
            >
              {board.name}
              {board.name === activeBoard ? <span className="tareas-tab-count">{activeBoardTasksCount}</span> : null}
            </NotiaButton>
          ))}

          <NotiaButton
            className={`tareas-tab-btn${manager.settings.activeTab === FINISHED_TAB_ID ? ' is-active' : ''}`}
            onClick={() => manager.setActiveTab(FINISHED_TAB_ID)}
          >
            Completadas
          </NotiaButton>

          <NotiaButton
            className={`tareas-tab-btn${manager.settings.activeTab === CANCELLED_TAB_ID ? ' is-active' : ''}`}
            onClick={() => manager.setActiveTab(CANCELLED_TAB_ID)}
          >
            Canceladas
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
              onOpenLinkedFile={onOpenTaskFile}
              libraryId={vault?.libraryId}
              contexts={contexts}
              onCreateGroup={manager.openGroupCreateDialog}
              onEditGroup={manager.openGroupEditDialog}
              onOpenPomodoroTask={handleOpenPomodoroTaskWrapped}
              onReorderGroups={manager.reorderGroupsInBoard}
              onPlaceTask={manager.placeTask}
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
          contexts={contexts}
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

  if ((previous.vault?.libraryId ?? '') !== (next.vault?.libraryId ?? '')) {
    return false
  }

  if ((previous.vault?.androidTreeUri ?? '') !== (next.vault?.androidTreeUri ?? '')) {
    return false
  }

  if (!sameBoardNames(previous.publishedBoardNames, next.publishedBoardNames)) {
    return false
  }

  if (previous.canManageBoards !== next.canManageBoards) {
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

  if (previous.onPublishedChatContextChange !== next.onPublishedChatContextChange) {
    return false
  }

  if (previous.contexts !== next.contexts) {
    return false
  }

  return true
}

function sameBoardNames(previous?: readonly string[], next?: readonly string[]): boolean {
  if (previous === next) return true
  if (!previous || !next || previous.length !== next.length) return false
  return previous.every((boardName, index) => boardName === next[index])
}
