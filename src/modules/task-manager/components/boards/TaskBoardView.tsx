import { useMemo, useState } from 'react'
import { TextField } from '@mui/material'
import { ChevronDown, ChevronRight, Clock3, Edit2, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react'
import { groupTopLevelTasks } from '../../engines/taskEngine'
import type { Group, TaskItem } from '../../types/taskManagerTypes'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { NotiaModalShell } from '../../../../components/notia/NotiaModalShell'

interface TaskBoardViewProps {
  boardName: string
  tasks: TaskItem[]
  groups: Group[]
  onCreateTask: (defaults?: { parentTaskName?: string; group?: string }) => void
  onEditTask: (task: TaskItem) => void
  onDeleteTask: (task: TaskItem) => Promise<void>
  onChangeTaskState: (task: TaskItem, nextState: string) => Promise<void>
  onMarkTaskUrgent: (task: TaskItem) => Promise<void>
  onToggleSubtaskDone: (task: TaskItem, done: boolean) => Promise<void>
  onAddTaskComment: (task: TaskItem, comment: string) => Promise<void>
  onLoadTaskSource: (taskPath: string) => Promise<string>
  onSaveTaskSource: (taskPath: string, content: string) => Promise<void>
  onCreateGroup: () => void
  onEditGroup: (group: Group) => void
  onOpenPomodoroTask: (taskPath: string) => void
  onReorderGroups: (boardName: string, orderedGroupNames: string[]) => Promise<void>
  onApplyTaskArrangement: (updates: Array<{ taskPath: string; order: number; group?: string; parentTaskName?: string }>) => Promise<void>
}

const STATUS_ACTIONS = [
  { id: 'dismiss', label: 'Desestimar', nextState: 'Cancelada', cls: 'is-dismiss' },
  { id: 'start-stop', label: 'Iniciar', nextState: 'En progreso', cls: 'is-start-stop' },
  { id: 'finish', label: 'Finalizar', nextState: 'Finalizada', cls: 'is-finish' },
  { id: 'block', label: 'Bloquear', nextState: 'Bloqueada', cls: 'is-block' },
] as const

interface TaskCommentDialogState {
  task: TaskItem
  text: string
}

interface TaskSourceDialogState {
  task: TaskItem
  source: string
  isLoading: boolean
  isSaving: boolean
}

export function TaskBoardView({
  boardName,
  tasks,
  groups,
  onCreateTask,
  onEditTask,
  onDeleteTask,
  onChangeTaskState,
  onMarkTaskUrgent,
  onToggleSubtaskDone,
  onAddTaskComment,
  onLoadTaskSource,
  onSaveTaskSource,
  onCreateGroup,
  onEditGroup,
  onOpenPomodoroTask,
  onReorderGroups,
  onApplyTaskArrangement,
}: TaskBoardViewProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(groups.map((group) => getGroupKey(group))))
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<string>>(() => new Set())
  const [commentDialog, setCommentDialog] = useState<TaskCommentDialogState | null>(null)
  const [sourceDialog, setSourceDialog] = useState<TaskSourceDialogState | null>(null)
  const [draggedGroupName, setDraggedGroupName] = useState<string | null>(null)
  const [draggedTaskPath, setDraggedTaskPath] = useState<string | null>(null)
  const [draggedSubtaskPath, setDraggedSubtaskPath] = useState<string | null>(null)
  const [groupDropTargetName, setGroupDropTargetName] = useState<string | null>(null)
  const [taskDropTarget, setTaskDropTarget] = useState<{ groupName: string; index: number } | null>(null)
  const [subtaskDropTarget, setSubtaskDropTarget] = useState<{ parentTaskPath: string; index: number } | null>(null)

  const boardTasks = useMemo(
    () => tasks
      .filter((task) => task.board === boardName)
      .filter((task) => !task.filePath.includes('/finished/') && !task.filePath.includes('/cancelled/')),
    [boardName, tasks],
  )

  const activeTopLevelTasks = useMemo(
    () => boardTasks
      .filter((task) => !task.parentTaskName.trim())
      .filter((task) => task.state !== 'Finalizada' && task.state !== 'Cancelada'),
    [boardTasks],
  )

  const grouped = useMemo(() => groupTopLevelTasks(activeTopLevelTasks, groups), [activeTopLevelTasks, groups])
  const topLevelTasks = useMemo(
    () => boardTasks.filter((task) => !task.parentTaskName.trim()).sort((left, right) => left.order - right.order),
    [boardTasks],
  )

  const toggleGroup = (group: Group) => {
    const groupKey = getGroupKey(group)
    setExpandedGroups((previous) => {
      const next = new Set(previous)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }

  const toggleSubtasks = (taskPath: string) => {
    setExpandedSubtasks((previous) => {
      const next = new Set(previous)
      if (next.has(taskPath)) {
        next.delete(taskPath)
      } else {
        next.add(taskPath)
      }
      return next
    })
  }

  const openCommentDialog = (task: TaskItem) => {
    setCommentDialog({ task, text: '' })
  }

  const managedGroupNames = groups.map((group) => group.name)

  const handleGroupDrop = async (targetGroupName: string) => {
    if (!draggedGroupName || draggedGroupName === targetGroupName) {
      return
    }

    const ordered = managedGroupNames.filter((name) => name !== draggedGroupName)
    const targetIndex = ordered.findIndex((name) => name === targetGroupName)
    if (targetIndex < 0) {
      return
    }

    ordered.splice(targetIndex, 0, draggedGroupName)
    setDraggedGroupName(null)
    setGroupDropTargetName(null)
    await onReorderGroups(boardName, ordered)
  }

  const handleTopLevelTaskDrop = async (targetGroupName: string, targetIndex: number) => {
    if (!draggedTaskPath) {
      return
    }

    const draggedTask = topLevelTasks.find((task) => task.filePath === draggedTaskPath)
    if (!draggedTask) {
      setDraggedTaskPath(null)
      return
    }

    const sourceGroupName = draggedTask.group || 'Sin grupo'
    const actualTargetGroup = targetGroupName === 'Sin grupo' ? '' : targetGroupName

    const sourceTasks = topLevelTasks.filter((task) => (task.group || 'Sin grupo') === sourceGroupName)
    const targetTasksInitial = sourceGroupName === targetGroupName
      ? sourceTasks
      : topLevelTasks.filter((task) => (task.group || 'Sin grupo') === targetGroupName)

    const sourceWithoutDragged = sourceTasks.filter((task) => task.filePath !== draggedTask.filePath)
    const targetTasks = targetTasksInitial.filter((task) => task.filePath !== draggedTask.filePath)
    const nextTargetIndex = Math.max(0, Math.min(targetIndex, targetTasks.length))
    targetTasks.splice(nextTargetIndex, 0, draggedTask)

    const updates: Array<{ taskPath: string; order: number; group?: string; parentTaskName?: string }> = []

    const sourceGroupValue = sourceGroupName === 'Sin grupo' ? '' : sourceGroupName
    const targetGroupValue = actualTargetGroup
    const sourceList = sourceGroupName === targetGroupName ? targetTasks : sourceWithoutDragged

    for (const [index, task] of sourceList.entries()) {
      updates.push({
        taskPath: task.filePath,
        order: (index + 1) * 10,
        group: sourceGroupValue,
        parentTaskName: '',
      })
    }

    if (sourceGroupName !== targetGroupName) {
      for (const [index, task] of targetTasks.entries()) {
        updates.push({
          taskPath: task.filePath,
          order: (index + 1) * 10,
          group: targetGroupValue,
          parentTaskName: '',
        })
      }
    }

    setDraggedTaskPath(null)
    setTaskDropTarget(null)
    await onApplyTaskArrangement(updates)
  }

  const handleSubtaskDrop = async (targetParentTask: TaskItem, targetIndex: number) => {
    if (!draggedSubtaskPath) {
      return
    }

    const draggedSubtask = boardTasks.find((task) => task.filePath === draggedSubtaskPath)
    if (!draggedSubtask || !draggedSubtask.parentTaskName.trim()) {
      setDraggedSubtaskPath(null)
      return
    }

    const sourceParentTask = resolveParentTaskForSubtask(draggedSubtask, topLevelTasks)
    if (!sourceParentTask) {
      setDraggedSubtaskPath(null)
      return
    }

    const sourceSubtasks = getSubtasks(sourceParentTask, boardTasks)
    const targetSubtasksInitial = sourceParentTask.filePath === targetParentTask.filePath
      ? sourceSubtasks
      : getSubtasks(targetParentTask, boardTasks)

    const sourceWithoutDragged = sourceSubtasks.filter((task) => task.filePath !== draggedSubtask.filePath)
    const targetSubtasks = targetSubtasksInitial.filter((task) => task.filePath !== draggedSubtask.filePath)
    const nextTargetIndex = Math.max(0, Math.min(targetIndex, targetSubtasks.length))
    targetSubtasks.splice(nextTargetIndex, 0, draggedSubtask)

    const updates: Array<{ taskPath: string; order: number; group?: string; parentTaskName?: string }> = []
    const sourceList = sourceParentTask.filePath === targetParentTask.filePath ? targetSubtasks : sourceWithoutDragged

    for (const [index, subtask] of sourceList.entries()) {
      updates.push({
        taskPath: subtask.filePath,
        order: (index + 1) * 10,
        group: sourceParentTask.group,
        parentTaskName: sourceParentTask.fileName,
      })
    }

    if (sourceParentTask.filePath !== targetParentTask.filePath) {
      for (const [index, subtask] of targetSubtasks.entries()) {
        updates.push({
          taskPath: subtask.filePath,
          order: (index + 1) * 10,
          group: targetParentTask.group,
          parentTaskName: targetParentTask.fileName,
        })
      }
    }

    setDraggedSubtaskPath(null)
    setSubtaskDropTarget(null)
    await onApplyTaskArrangement(updates)
  }

  const submitCommentDialog = async () => {
    if (!commentDialog) {
      return
    }

    await onAddTaskComment(commentDialog.task, commentDialog.text)
    setCommentDialog(null)
  }

  const openTaskSourceDialog = async (task: TaskItem) => {
    setSourceDialog({ task, source: '', isLoading: true, isSaving: false })
    try {
      const source = await onLoadTaskSource(task.filePath)
      setSourceDialog({ task, source, isLoading: false, isSaving: false })
    } catch {
      setSourceDialog({ task, source: '', isLoading: false, isSaving: false })
    }
  }

  const saveTaskSourceDialog = async () => {
    if (!sourceDialog) {
      return
    }

    setSourceDialog((previous) => previous ? { ...previous, isSaving: true } : previous)
    await onSaveTaskSource(sourceDialog.task.filePath, sourceDialog.source)
    setSourceDialog(null)
  }

  return (
    <>
      <div className="tareas-board-shell">
        <div className="tareas-board">
          {groups.map((group) => {
            const groupTasks = grouped[group.name] ?? []
            const isExpanded = expandedGroups.has(getGroupKey(group))

            return (
              <div key={getGroupKey(group)} className="tareas-group" data-group={group.name}>
                <div
                  className={`tareas-group-header${draggedGroupName === group.name ? ' is-dragging' : ''}${groupDropTargetName === group.name ? ' is-drop-target' : ''}`}
                  onClick={() => toggleGroup(group)}
                  draggable
                  onDragStart={() => setDraggedGroupName(group.name)}
                  onDragEnd={() => {
                    setDraggedGroupName(null)
                    setGroupDropTargetName(null)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (draggedGroupName) {
                      setGroupDropTargetName(group.name)
                    }
                  }}
                  onDragLeave={() => {
                    if (groupDropTargetName === group.name) {
                      setGroupDropTargetName(null)
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    void handleGroupDrop(group.name)
                  }}
                >
                  <span className="tareas-toggle">{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
                  <span className="tareas-badge" style={{ background: group.color }}>{group.name}</span>
                  <span className="tareas-count">{groupTasks.length}</span>
                  <NotiaButton
                    className="tareas-group-edit-btn"
                    onClick={(event) => {
                      event.stopPropagation()
                      onEditGroup(group)
                    }}
                    title="Editar grupo"
                  >
                    <Pencil size={12} />
                  </NotiaButton>
                </div>

                {isExpanded ? (
                  <div
                    className="tareas-card-list"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (draggedTaskPath) {
                        void handleTopLevelTaskDrop(group.name, groupTasks.length)
                      }
                    }}
                  >
                    {groupTasks
                      .slice()
                      .sort((left, right) => left.order - right.order)
                      .map((task, index) => (
                        <div
                          key={task.filePath}
                          className={`tareas-task-drag-wrap${draggedTaskPath === task.filePath ? ' is-dragging' : ''}${taskDropTarget?.groupName === group.name && taskDropTarget.index === index ? ' is-drop-target' : ''}`}
                          draggable
                          onDragStart={() => setDraggedTaskPath(task.filePath)}
                          onDragEnd={() => {
                            setDraggedTaskPath(null)
                            setTaskDropTarget(null)
                          }}
                          onDragOver={(event) => {
                            event.preventDefault()
                            if (draggedTaskPath && !draggedSubtaskPath) {
                              setTaskDropTarget({ groupName: group.name, index })
                            }
                          }}
                          onDragLeave={() => {
                            if (taskDropTarget?.groupName === group.name && taskDropTarget.index === index) {
                              setTaskDropTarget(null)
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault()
                            if (!draggedSubtaskPath) {
                              void handleTopLevelTaskDrop(group.name, index)
                            }
                          }}
                        >
                          <TaskCard
                            task={task}
                            allTasks={boardTasks}
                            isSubtasksExpanded={expandedSubtasks.has(task.filePath)}
                            onToggleSubtasks={toggleSubtasks}
                            onCreateTask={onCreateTask}
                            onEditTask={onEditTask}
                            onDeleteTask={onDeleteTask}
                            onChangeTaskState={onChangeTaskState}
                            onMarkTaskUrgent={onMarkTaskUrgent}
                            onToggleSubtaskDone={onToggleSubtaskDone}
                            onAddTaskComment={openCommentDialog}
                            onOpenTaskSource={openTaskSourceDialog}
                            onOpenPomodoroTask={onOpenPomodoroTask}
                            draggedSubtaskPath={draggedSubtaskPath}
                            subtaskDropTarget={subtaskDropTarget}
                            onSubtaskDragStart={setDraggedSubtaskPath}
                            onSubtaskDragEnd={() => {
                              setDraggedSubtaskPath(null)
                              setSubtaskDropTarget(null)
                            }}
                            onSubtaskDragOverTarget={(targetIndex) => {
                              setSubtaskDropTarget({ parentTaskPath: task.filePath, index: targetIndex })
                            }}
                            onSubtaskDragLeaveTarget={(targetIndex) => {
                              if (subtaskDropTarget?.parentTaskPath === task.filePath && subtaskDropTarget.index === targetIndex) {
                                setSubtaskDropTarget(null)
                              }
                            }}
                            onSubtaskDrop={(targetIndex) => {
                              void handleSubtaskDrop(task, targetIndex)
                            }}
                          />
                        </div>
                      ))}

                    <div className="tareas-task-card tareas-task-card-add">
                      <span className="tareas-add-link" onClick={() => onCreateTask({ group: group.name })}>
                        <Plus size={12} />
                        Nueva tarea
                      </span>
                    </div>
                    {taskDropTarget?.groupName === group.name && taskDropTarget.index === groupTasks.length ? (
                      <div className="tareas-drop-indicator" />
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}

          {grouped['Sin grupo']?.length ? (
            <div className="tareas-group" data-group="Sin grupo">
              <div
                className="tareas-group-header"
                onClick={() => toggleGroup({ name: 'Sin grupo', color: '#607d8b', board: boardName })}
              >
                <span className="tareas-toggle">
                  {expandedGroups.has(getGroupKey({ name: 'Sin grupo', color: '#607d8b', board: boardName }))
                    ? <ChevronDown size={13} />
                    : <ChevronRight size={13} />}
                </span>
                <span className="tareas-badge" style={{ background: '#607d8b' }}>Sin grupo</span>
                <span className="tareas-count">{grouped['Sin grupo'].length}</span>
              </div>

              {expandedGroups.has(getGroupKey({ name: 'Sin grupo', color: '#607d8b', board: boardName })) ? (
                <div
                  className="tareas-card-list"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (draggedTaskPath) {
                      void handleTopLevelTaskDrop('Sin grupo', grouped['Sin grupo'].length)
                    }
                  }}
                >
                  {grouped['Sin grupo']
                    .slice()
                    .sort((left, right) => left.order - right.order)
                    .map((task, index) => (
                      <div
                        key={task.filePath}
                        className={`tareas-task-drag-wrap${draggedTaskPath === task.filePath ? ' is-dragging' : ''}${taskDropTarget?.groupName === 'Sin grupo' && taskDropTarget.index === index ? ' is-drop-target' : ''}`}
                        draggable
                        onDragStart={() => setDraggedTaskPath(task.filePath)}
                        onDragEnd={() => {
                          setDraggedTaskPath(null)
                          setTaskDropTarget(null)
                        }}
                        onDragOver={(event) => {
                          event.preventDefault()
                          if (draggedTaskPath && !draggedSubtaskPath) {
                            setTaskDropTarget({ groupName: 'Sin grupo', index })
                          }
                        }}
                        onDragLeave={() => {
                          if (taskDropTarget?.groupName === 'Sin grupo' && taskDropTarget.index === index) {
                            setTaskDropTarget(null)
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          if (!draggedSubtaskPath) {
                            void handleTopLevelTaskDrop('Sin grupo', index)
                          }
                        }}
                      >
                        <TaskCard
                          task={task}
                          allTasks={boardTasks}
                          isSubtasksExpanded={expandedSubtasks.has(task.filePath)}
                          onToggleSubtasks={toggleSubtasks}
                          onCreateTask={onCreateTask}
                          onEditTask={onEditTask}
                          onDeleteTask={onDeleteTask}
                          onChangeTaskState={onChangeTaskState}
                          onMarkTaskUrgent={onMarkTaskUrgent}
                          onToggleSubtaskDone={onToggleSubtaskDone}
                          onAddTaskComment={openCommentDialog}
                          onOpenTaskSource={openTaskSourceDialog}
                          onOpenPomodoroTask={onOpenPomodoroTask}
                          draggedSubtaskPath={draggedSubtaskPath}
                          subtaskDropTarget={subtaskDropTarget}
                          onSubtaskDragStart={setDraggedSubtaskPath}
                          onSubtaskDragEnd={() => {
                            setDraggedSubtaskPath(null)
                            setSubtaskDropTarget(null)
                          }}
                          onSubtaskDragOverTarget={(targetIndex) => {
                            setSubtaskDropTarget({ parentTaskPath: task.filePath, index: targetIndex })
                          }}
                          onSubtaskDragLeaveTarget={(targetIndex) => {
                            if (subtaskDropTarget?.parentTaskPath === task.filePath && subtaskDropTarget.index === targetIndex) {
                              setSubtaskDropTarget(null)
                            }
                          }}
                          onSubtaskDrop={(targetIndex) => {
                            void handleSubtaskDrop(task, targetIndex)
                          }}
                        />
                      </div>
                    ))}

                  <div className="tareas-task-card tareas-task-card-add">
                    <span className="tareas-add-link" onClick={() => onCreateTask({ group: '' })}>
                      <Plus size={12} />
                      Nueva tarea
                    </span>
                  </div>
                  {taskDropTarget?.groupName === 'Sin grupo' && taskDropTarget.index === grouped['Sin grupo'].length ? (
                    <div className="tareas-drop-indicator" />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="tareas-new-group">
          <span className="tareas-add-link" onClick={onCreateGroup}>
            <Plus size={12} />
            Nuevo grupo
          </span>
        </div>
      </div>

      <NotiaModalShell open={Boolean(commentDialog)} onClose={() => setCommentDialog(null)} size="md" panelClassName="tareas-dialog">
        <div className="tareas-dialog-header">
          <h2>Agregar comentario</h2>
        </div>
        <div className="tareas-dialog-body">
          <TextField
            autoFocus
            multiline
            minRows={5}
            fullWidth
            value={commentDialog?.text ?? ''}
            onChange={(event) => {
              setCommentDialog((previous) => previous ? { ...previous, text: event.target.value } : previous)
            }}
            sx={{ mt: 1 }}
          />
        </div>
        <div className="tareas-dialog-actions">
          <NotiaButton onClick={() => setCommentDialog(null)}>Cancelar</NotiaButton>
          <NotiaButton variant="primary" onClick={() => void submitCommentDialog()} disabled={!commentDialog?.text.trim()}>
            Guardar comentario
          </NotiaButton>
        </div>
      </NotiaModalShell>

      <NotiaModalShell open={Boolean(sourceDialog)} onClose={() => setSourceDialog(null)} size="xl" panelClassName="tareas-dialog">
        <div className="tareas-dialog-header">
          <h2>Editar markdown de tarea</h2>
        </div>
        <div className="tareas-dialog-body">
          <TextField
            multiline
            minRows={18}
            fullWidth
            value={sourceDialog?.source ?? ''}
            disabled={Boolean(sourceDialog?.isLoading) || Boolean(sourceDialog?.isSaving)}
            onChange={(event) => {
              setSourceDialog((previous) => previous ? { ...previous, source: event.target.value } : previous)
            }}
            sx={{ mt: 1 }}
          />
        </div>
        <div className="tareas-dialog-actions">
          <NotiaButton onClick={() => setSourceDialog(null)}>Cancelar</NotiaButton>
          <NotiaButton
            variant="primary"
            onClick={() => void saveTaskSourceDialog()}
            disabled={Boolean(sourceDialog?.isLoading) || Boolean(sourceDialog?.isSaving)}
          >
            Guardar markdown
          </NotiaButton>
        </div>
      </NotiaModalShell>
    </>
  )
}

interface TaskCardProps {
  task: TaskItem
  allTasks: TaskItem[]
  isSubtasksExpanded: boolean
  onToggleSubtasks: (taskPath: string) => void
  onCreateTask: (defaults?: { parentTaskName?: string; group?: string }) => void
  onEditTask: (task: TaskItem) => void
  onDeleteTask: (task: TaskItem) => Promise<void>
  onChangeTaskState: (task: TaskItem, nextState: string) => Promise<void>
  onMarkTaskUrgent: (task: TaskItem) => Promise<void>
  onToggleSubtaskDone: (task: TaskItem, done: boolean) => Promise<void>
  onAddTaskComment: (task: TaskItem) => void
  onOpenTaskSource: (task: TaskItem) => void
  onOpenPomodoroTask: (taskPath: string) => void
  draggedSubtaskPath: string | null
  subtaskDropTarget: { parentTaskPath: string; index: number } | null
  onSubtaskDragStart: (taskPath: string) => void
  onSubtaskDragEnd: () => void
  onSubtaskDragOverTarget: (targetIndex: number) => void
  onSubtaskDragLeaveTarget: (targetIndex: number) => void
  onSubtaskDrop: (targetIndex: number) => void
}

function TaskCard({
  task,
  allTasks,
  isSubtasksExpanded,
  onToggleSubtasks,
  onCreateTask,
  onEditTask,
  onDeleteTask,
  onChangeTaskState,
  onMarkTaskUrgent,
  onToggleSubtaskDone,
  onAddTaskComment,
  onOpenTaskSource,
  onOpenPomodoroTask,
  draggedSubtaskPath,
  subtaskDropTarget,
  onSubtaskDragStart,
  onSubtaskDragEnd,
  onSubtaskDragOverTarget,
  onSubtaskDragLeaveTarget,
  onSubtaskDrop,
}: TaskCardProps) {
  const subtasks = getSubtasks(task, allTasks)
  const progressPercent = task.estimatedHours > 0 ? (task.dedicatedHours / task.estimatedHours) * 100 : 0
  const isOverflow = progressPercent > 100
  const visiblePercent = isOverflow
    ? (progressPercent % 100 || 100)
    : progressPercent
  const fillPercent = Math.max(0, Math.min(100, visiblePercent))

  return (
    <div
      className="tareas-task-card"
      style={{ ['--tareas-card-actions-band-height' as string]: '16px' }}
      onDoubleClick={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest('a,button,input,textarea,select,label')) {
          return
        }

        onOpenTaskSource(task)
      }}
    >
      <div className={`tareas-card-side-band tareas-card-status-band tareas-card-status-band-${toClassName(task.state)}`}>
        <span className="tareas-card-side-band-text">{task.state}</span>
      </div>

      <div className={`tareas-card-side-band tareas-card-priority-band tareas-card-priority-band-${toClassName(task.priority || 'Media')}`}>
        <span className="tareas-card-side-band-text">{task.priority || 'Media'}</span>
      </div>

      <div className="tareas-card-actions-band">
        <div className="tareas-status-actions">
          {STATUS_ACTIONS.map((action) => {
            const nextState = action.id === 'start-stop'
              ? task.state === 'En progreso'
                ? 'Pendiente'
                : 'En progreso'
              : action.nextState

            const label = action.id === 'start-stop'
              ? task.state === 'En progreso'
                ? 'Parar'
                : 'Iniciar'
              : action.label

            return (
              <NotiaButton
                key={`${task.filePath}-${action.id}`}
                className={`tareas-status-action-btn ${action.cls}${task.state === nextState ? ' is-active' : ''}`}
                onClick={() => {
                  if (task.state !== nextState) {
                    void onChangeTaskState(task, nextState)
                  }
                }}
              >
                {label}
              </NotiaButton>
            )
          })}

          <NotiaButton
            className={`tareas-status-action-btn is-urgent${task.priority === 'Urgente' ? ' is-active' : ''}`}
            onClick={() => {
              if (task.priority !== 'Urgente') {
                void onMarkTaskUrgent(task)
              }
            }}
          >
            Urgente
          </NotiaButton>
        </div>
      </div>

      <div className="tareas-card-title-row">
        <a
          className="tareas-task-card-title"
          title={task.title}
          href="#"
          onClick={(event) => {
            event.preventDefault()
            onEditTask(task)
          }}
        >
          {task.title}
        </a>

        <NotiaButton
          className="tareas-card-comment-btn"
          title="Agregar comentario"
          onClick={() => onAddTaskComment(task)}
        >
          <MessageSquare size={12} />
        </NotiaButton>

        <NotiaButton
          className="tareas-card-comment-btn"
          title="Editar tarea"
          onClick={() => onEditTask(task)}
        >
          <Edit2 size={12} />
        </NotiaButton>
      </div>

      {task.preview ? <p className="tareas-card-preview">{task.preview}</p> : null}

      <div className="tareas-card-footer">
        {subtasks.length > 0 ? (
          <span
            className={`tareas-card-subtasks tareas-card-subtasks-toggle${isSubtasksExpanded ? ' is-expanded' : ''}`}
            onClick={() => onToggleSubtasks(task.filePath)}
          >
            {isSubtasksExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {subtasks.length}
            {' '}subtarea(s)
          </span>
        ) : <span className="tareas-card-subtasks">Sin subtareas</span>}

        <span className="tareas-add-link" onClick={() => onCreateTask({ parentTaskName: task.fileName, group: task.group })}>
          <Plus size={12} />
          Subtarea
        </span>
      </div>

      {subtasks.length > 0 && isSubtasksExpanded ? (
        <div
          className="tareas-card-subtask-list"
          onDragOver={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onSubtaskDragOverTarget(subtasks.length)
          }}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onSubtaskDrop(subtasks.length)
          }}
        >
          {subtasks.map((subtask, index) => {
            const checked = subtask.state === 'Finalizada'
            return (
              <div
                className={`tareas-card-subtask-row${draggedSubtaskPath === subtask.filePath ? ' is-dragging' : ''}${subtaskDropTarget?.parentTaskPath === task.filePath && subtaskDropTarget.index === index ? ' is-drop-target' : ''}`}
                key={subtask.filePath}
                draggable
                onDragStart={(event) => {
                  event.stopPropagation()
                  onSubtaskDragStart(subtask.filePath)
                }}
                onDragEnd={(event) => {
                  event.stopPropagation()
                  onSubtaskDragEnd()
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onSubtaskDragOverTarget(index)
                }}
                onDragLeave={() => onSubtaskDragLeaveTarget(index)}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onSubtaskDrop(index)
                }}
              >
                <input
                  className="tareas-card-subtask-check"
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    void onToggleSubtaskDone(subtask, event.target.checked)
                  }}
                />

                <a
                  className={`tareas-card-subtask-title${checked ? ' is-done' : ''}`}
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    onEditTask(subtask)
                  }}
                  title={subtask.title}
                >
                  {subtask.title}
                </a>

                <NotiaButton
                  className="tareas-card-comment-btn"
                  title="Agregar comentario"
                  onClick={() => onAddTaskComment(subtask)}
                >
                  <MessageSquare size={12} />
                </NotiaButton>
              </div>
            )
          })}
          {subtaskDropTarget?.parentTaskPath === task.filePath && subtaskDropTarget.index === subtasks.length ? (
            <div className="tareas-drop-indicator tareas-drop-indicator-subtask" />
          ) : null}
        </div>
      ) : null}

      <div className="tareas-card-progress-row">
        <div className={`tareas-card-progress-band${isOverflow ? ' is-overflow' : ''}`}>
          <div className="tareas-card-progress-band-fill" style={{ width: `${fillPercent}%` }} />
          <div className="tareas-card-progress-band-text">
            <span>
              {formatHours(task.dedicatedHours)}/{formatHours(task.estimatedHours)}
              <span className="tareas-card-progress-band-text-deviation"> +-&gt; {formatHours(task.deviationHours)}</span>
            </span>
          </div>
        </div>

        <NotiaButton
          className="tareas-card-pomodoro-btn"
          title="Abrir pomodoro con esta tarea"
          onClick={() => onOpenPomodoroTask(task.filePath)}
        >
          <Clock3 size={12} />
        </NotiaButton>

        <NotiaButton
          className="tareas-card-pomodoro-btn"
          title="Eliminar tarea"
          onClick={() => {
            void onDeleteTask(task)
          }}
        >
          <Trash2 size={12} />
        </NotiaButton>
      </div>
    </div>
  )
}

function getSubtasks(task: TaskItem, allTasks: TaskItem[]): TaskItem[] {
  return allTasks
    .filter((candidate) => candidate.parentTaskName)
    .filter((candidate) => {
      const parentName = candidate.parentTaskName.trim().toLowerCase()
      return parentName === task.title.trim().toLowerCase() || parentName === task.fileName.trim().toLowerCase()
    })
    .sort((left, right) => left.order - right.order)
}

function resolveParentTaskForSubtask(subtask: TaskItem, topLevelTasks: TaskItem[]): TaskItem | null {
  const parentName = subtask.parentTaskName.trim().toLowerCase()
  if (!parentName) {
    return null
  }

  return topLevelTasks.find((task) => (
    task.fileName.trim().toLowerCase() === parentName
    || task.title.trim().toLowerCase() === parentName
  )) ?? null
}

function getGroupKey(group: Group): string {
  return `${group.board ?? 'default'}::${group.name}`
}

function toClassName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-')
}

function formatHours(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}
