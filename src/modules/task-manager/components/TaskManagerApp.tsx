import { Alert, Snackbar, ThemeProvider, createTheme } from '@mui/material'
import { FolderKanban, Plus, RefreshCw } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useConfirmationEngine } from '../../../context/confirmation/useConfirmationEngine'
import { NotiaButton } from '../../../components/common/NotiaButton'
import { isTaskInCancelledFolder, isTaskInFinishedFolder } from '../engines/taskEngine'
import { useTaskManager } from '../hooks/useTaskManager'
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
  vaultPath?: string | null
}

export function TaskManagerApp({ embedded = false, vaultPath = null }: TaskManagerAppProps) {
  const manager = useTaskManager(vaultPath)
  const { confirm } = useConfirmationEngine()

  const activeBoard = manager.settings.activeTab

  const visibleGroups = useMemo(
    () => manager.settings.groups.filter((group) => (group.board ?? 'default') === activeBoard),
    [activeBoard, manager.settings.groups],
  )

  const finishedTasks = useMemo(
    () => manager.snapshot.tasks.filter((task) => isTaskInFinishedFolder(task.filePath)),
    [manager.snapshot.tasks],
  )

  const cancelledTasks = useMemo(
    () => manager.snapshot.tasks.filter((task) => isTaskInCancelledFolder(task.filePath)),
    [manager.snapshot.tasks],
  )

  const activeTabIsBoard = manager.settings.boards.some((board) => board.name === activeBoard)

  const activeBoardTasksCount = useMemo(
    () => manager.snapshot.tasks
      .filter((task) => task.board === activeBoard)
      .filter((task) => !isTaskInFinishedFolder(task.filePath) && !isTaskInCancelledFolder(task.filePath)).length,
    [activeBoard, manager.snapshot.tasks],
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
                <FolderKanban size={14} />
                Vault
              </NotiaButton>
            ) : null}

            <NotiaButton className="tareas-btn-ghost" onClick={() => void manager.reload()}>
              <RefreshCw size={14} />
              Refrescar
            </NotiaButton>

            <NotiaButton className="tareas-btn-new" onClick={manager.openBoardCreateDialog}>
              <Plus size={14} />
              Nuevo tablero
            </NotiaButton>

            <NotiaButton
              className="tareas-btn-edit-board"
              onClick={() => {
                if (!activeBoardConfig) {
                  return
                }
                manager.openBoardEditDialog(activeBoardConfig)
              }}
              disabled={!activeTabIsBoard || activeBoard === 'default'}
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
              tasks={manager.snapshot.tasks}
              onCreateTask={manager.openTaskCreateDialog}
              onEditTask={manager.openTaskEditDialog}
              onDeleteTask={handleDeleteTask}
              onChangeTaskState={manager.updateTaskState}
              onMarkTaskUrgent={manager.markTaskAsUrgent}
              onToggleSubtaskDone={manager.toggleSubtaskDone}
              onAddTaskComment={manager.addTaskComment}
              onLoadTaskSource={manager.loadTaskSource}
              onSaveTaskSource={manager.saveTaskSource}
              onCreateGroup={manager.openGroupCreateDialog}
              onEditGroup={manager.openGroupEditDialog}
              onOpenPomodoroTask={(taskPath) => {
                manager.selectPomodoroTask(taskPath)
                manager.setActiveTab(POMODORO_TAB_ID)
              }}
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
              tasks={manager.snapshot.tasks.filter((task) => !isTaskInFinishedFolder(task.filePath) && !isTaskInCancelledFolder(task.filePath))}
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
