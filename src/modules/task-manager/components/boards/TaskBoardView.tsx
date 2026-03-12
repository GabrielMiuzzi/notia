import { Fragment, useMemo, useState, type CSSProperties } from 'react'
import { TextField } from '@mui/material'
import { TASK_ICON_NAME, TaskManagerIcon } from '../../engines/taskIconEngine'
import { TASK_PRIORITIES, TASK_STATES } from '../../constants/taskManagerConstants'
import { groupTopLevelTasks } from '../../engines/taskEngine'
import type { Group, TaskItem, TaskPriority, TaskState } from '../../types/taskManagerTypes'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { NotiaModalShell } from '../../../../components/notia/NotiaModalShell'
import { useSubmenuEngine } from '../../../../hooks/useSubmenuEngine'

interface TaskBoardViewProps {
  boardName: string
  tasks: TaskItem[]
  groups: Group[]
  onCreateTask: (defaults?: { parentTaskName?: string; group?: string }) => void
  onEditTask: (task: TaskItem) => void
  onChangeTaskState: (task: TaskItem, nextState: string) => Promise<void>
  onChangeTaskPriority: (task: TaskItem, nextPriority: TaskPriority) => Promise<void>
  onChangeTaskDedicatedHours: (task: TaskItem, nextDedicatedHours: number) => Promise<void>
  onToggleSubtaskDone: (task: TaskItem, done: boolean) => Promise<void>
  onAddTaskComment: (task: TaskItem, comment: string) => Promise<void>
  onLoadTaskSource: (taskPath: string) => Promise<string>
  onSaveTaskSource: (taskPath: string, content: string) => Promise<void>
  onOpenTaskFile?: (taskPath: string) => void
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
] as const
const TASK_DROP_HYSTERESIS_RATIO = 0.15

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
  onChangeTaskState,
  onChangeTaskPriority,
  onChangeTaskDedicatedHours,
  onToggleSubtaskDone,
  onAddTaskComment,
  onLoadTaskSource,
  onSaveTaskSource,
  onOpenTaskFile,
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
  const [draggedTaskHeight, setDraggedTaskHeight] = useState<number>(0)
  const [draggedSubtaskPath, setDraggedSubtaskPath] = useState<string | null>(null)
  const [groupDropTargetName, setGroupDropTargetName] = useState<string | null>(null)
  const [taskDropTarget, setTaskDropTarget] = useState<{ groupName: string; index: number } | null>(null)
  const [pinnedTaskDropTarget, setPinnedTaskDropTarget] = useState<{ groupName: string; index: number } | null>(null)
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
      setPinnedTaskDropTarget(null)
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
    setPinnedTaskDropTarget(null)
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

  const resolveTaskDropIndexFromPointer = (
    groupName: string,
    index: number,
    pointerY: number,
    rect: DOMRect,
  ): number => {
    const beforeIndex = index
    const afterIndex = index + 1
    const midpoint = rect.top + rect.height / 2
    const currentIndex = taskDropTarget?.groupName === groupName ? taskDropTarget.index : null
    const currentAffectsSameTask = currentIndex === beforeIndex || currentIndex === afterIndex

    if (!currentAffectsSameTask) {
      return pointerY < midpoint ? beforeIndex : afterIndex
    }

    const hysteresisOffset = rect.height * TASK_DROP_HYSTERESIS_RATIO
    const switchToBeforeY = midpoint - hysteresisOffset
    const switchToAfterY = midpoint + hysteresisOffset

    if (currentIndex === beforeIndex) {
      return pointerY > switchToAfterY ? afterIndex : beforeIndex
    }

    return pointerY < switchToBeforeY ? beforeIndex : afterIndex
  }

  const isPointerOverPinnedTaskDropSlot = (pointerX: number, pointerY: number): boolean => {
    if (!pinnedTaskDropTarget) {
      return false
    }

    const slot = Array
      .from(document.querySelectorAll<HTMLElement>('.tareas-task-drop-slot[data-drop-group][data-drop-index]'))
      .find((node) => (
        node.dataset.dropGroup === pinnedTaskDropTarget.groupName
        && Number(node.dataset.dropIndex) === pinnedTaskDropTarget.index
      ))

    if (!slot) {
      return false
    }

    const bounds = slot.getBoundingClientRect()
    return (
      pointerX >= bounds.left
      && pointerX <= bounds.right
      && pointerY >= bounds.top
      && pointerY <= bounds.bottom
    )
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
                  style={{ '--tareas-group-color': group.color } as CSSProperties}
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
                  <span className="tareas-toggle">
                    {isExpanded
                      ? <TaskManagerIcon name={TASK_ICON_NAME.chevronDown} size={13} />
                      : <TaskManagerIcon name={TASK_ICON_NAME.chevronRight} size={13} />}
                  </span>
                  <span className="tareas-badge">{group.name}</span>
                  <span className="tareas-count">{groupTasks.length}</span>
                  <NotiaButton
                    className="tareas-group-edit-btn"
                    onClick={(event) => {
                      event.stopPropagation()
                      onEditGroup(group)
                    }}
                    title="Editar grupo"
                  >
                    <TaskManagerIcon name={TASK_ICON_NAME.pencil} size={12} />
                  </NotiaButton>
                </div>

                {isExpanded ? (
                  <div
                    className="tareas-card-list"
                    onDragOver={(event) => {
                      event.preventDefault()
                      if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = 'move'
                      }
                      if (!draggedTaskPath || draggedSubtaskPath) {
                        return
                      }

                      const target = event.target
                      if (target instanceof HTMLElement && target.closest('.tareas-task-drag-wrap')) {
                        return
                      }
                      if (target instanceof HTMLElement && target.closest('.tareas-task-drop-slot')) {
                        return
                      }
                      if (isPointerOverPinnedTaskDropSlot(event.clientX, event.clientY)) {
                        return
                      }
                      if (pinnedTaskDropTarget) {
                        setPinnedTaskDropTarget(null)
                      }

                      setTaskDropTarget({ groupName: group.name, index: groupTasks.length })
                    }}
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
                        <Fragment key={task.filePath}>
                          {taskDropTarget?.groupName === group.name && taskDropTarget.index === index ? (
                            <div
                              className="tareas-task-drop-slot"
                              data-drop-group={group.name}
                              data-drop-index={index}
                              style={draggedTaskHeight > 0 ? { height: `${draggedTaskHeight}px` } : undefined}
                              onDragOver={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                if (event.dataTransfer) {
                                  event.dataTransfer.dropEffect = 'move'
                                }
                                if (!pinnedTaskDropTarget || pinnedTaskDropTarget.groupName !== group.name || pinnedTaskDropTarget.index !== index) {
                                  setPinnedTaskDropTarget({ groupName: group.name, index })
                                }
                                if (taskDropTarget?.groupName !== group.name || taskDropTarget.index !== index) {
                                  setTaskDropTarget({ groupName: group.name, index })
                                }
                              }}
                              onDragLeave={() => {
                                if (pinnedTaskDropTarget?.groupName === group.name && pinnedTaskDropTarget.index === index) {
                                  setPinnedTaskDropTarget(null)
                                }
                              }}
                              onDrop={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                if (!draggedSubtaskPath) {
                                  void handleTopLevelTaskDrop(group.name, index)
                                }
                              }}
                            />
                          ) : null}
                          <div
                            className={`tareas-task-drag-wrap${draggedTaskPath === task.filePath ? ' is-dragging' : ''}`}
                            draggable
                            onDragStart={(event) => {
                              if (event.dataTransfer) {
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', task.filePath)
                              }
                              setPinnedTaskDropTarget(null)
                              setDraggedTaskPath(task.filePath)
                              setDraggedTaskHeight(event.currentTarget.getBoundingClientRect().height)
                            }}
                            onDragEnd={() => {
                              setDraggedTaskPath(null)
                              setDraggedTaskHeight(0)
                              setTaskDropTarget(null)
                              setPinnedTaskDropTarget(null)
                            }}
                            onDragOver={(event) => {
                              event.preventDefault()
                              if (event.dataTransfer) {
                                event.dataTransfer.dropEffect = 'move'
                              }
                              if (draggedTaskPath && !draggedSubtaskPath) {
                                if (isPointerOverPinnedTaskDropSlot(event.clientX, event.clientY)) {
                                  return
                                }
                                if (pinnedTaskDropTarget) {
                                  setPinnedTaskDropTarget(null)
                                }
                                const bounds = event.currentTarget.getBoundingClientRect()
                                const nextIndex = resolveTaskDropIndexFromPointer(group.name, index, event.clientY, bounds)
                                if (taskDropTarget?.groupName === group.name && taskDropTarget.index === nextIndex) {
                                  return
                                }
                                setTaskDropTarget({ groupName: group.name, index: nextIndex })
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault()
                              if (!draggedSubtaskPath) {
                                const bounds = event.currentTarget.getBoundingClientRect()
                                const placeBefore = event.clientY < bounds.top + bounds.height / 2
                                void handleTopLevelTaskDrop(group.name, placeBefore ? index : index + 1)
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
                              onChangeTaskState={onChangeTaskState}
                              onChangeTaskPriority={onChangeTaskPriority}
                              onChangeTaskDedicatedHours={onChangeTaskDedicatedHours}
                              onToggleSubtaskDone={onToggleSubtaskDone}
                              onAddTaskComment={openCommentDialog}
                              onOpenTaskSource={openTaskSourceDialog}
                              onOpenTaskFile={onOpenTaskFile}
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
                        </Fragment>
                      ))}

                    {taskDropTarget?.groupName === group.name && taskDropTarget.index === groupTasks.length ? (
                      <div
                        className="tareas-task-drop-slot"
                        data-drop-group={group.name}
                        data-drop-index={groupTasks.length}
                        style={draggedTaskHeight > 0 ? { height: `${draggedTaskHeight}px` } : undefined}
                        onDragOver={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          if (event.dataTransfer) {
                            event.dataTransfer.dropEffect = 'move'
                          }
                          if (
                            !pinnedTaskDropTarget
                            || pinnedTaskDropTarget.groupName !== group.name
                            || pinnedTaskDropTarget.index !== groupTasks.length
                          ) {
                            setPinnedTaskDropTarget({ groupName: group.name, index: groupTasks.length })
                          }
                          if (taskDropTarget?.groupName !== group.name || taskDropTarget.index !== groupTasks.length) {
                            setTaskDropTarget({ groupName: group.name, index: groupTasks.length })
                          }
                        }}
                        onDragLeave={() => {
                          if (pinnedTaskDropTarget?.groupName === group.name && pinnedTaskDropTarget.index === groupTasks.length) {
                            setPinnedTaskDropTarget(null)
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          if (!draggedSubtaskPath) {
                            void handleTopLevelTaskDrop(group.name, groupTasks.length)
                          }
                        }}
                      />
                    ) : null}
                    <div className="tareas-task-card tareas-task-card-add">
                      <span className="tareas-add-link" onClick={() => onCreateTask({ group: group.name })}>
                        <TaskManagerIcon name={TASK_ICON_NAME.plus} size={12} />
                        Nueva tarea
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}

          {grouped['Sin grupo']?.length ? (
            <div className="tareas-group" data-group="Sin grupo">
              <div
                className="tareas-group-header"
                style={{ '--tareas-group-color': '#607d8b' } as CSSProperties}
                onClick={() => toggleGroup({ name: 'Sin grupo', color: '#607d8b', board: boardName })}
              >
                <span className="tareas-toggle">
                  {expandedGroups.has(getGroupKey({ name: 'Sin grupo', color: '#607d8b', board: boardName }))
                    ? <TaskManagerIcon name={TASK_ICON_NAME.chevronDown} size={13} />
                    : <TaskManagerIcon name={TASK_ICON_NAME.chevronRight} size={13} />}
                </span>
                <span className="tareas-badge">Sin grupo</span>
                <span className="tareas-count">{grouped['Sin grupo'].length}</span>
              </div>

              {expandedGroups.has(getGroupKey({ name: 'Sin grupo', color: '#607d8b', board: boardName })) ? (
                <div
                  className="tareas-card-list"
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (event.dataTransfer) {
                      event.dataTransfer.dropEffect = 'move'
                    }
                    if (!draggedTaskPath || draggedSubtaskPath) {
                      return
                    }

                    const target = event.target
                    if (target instanceof HTMLElement && target.closest('.tareas-task-drag-wrap')) {
                      return
                    }
                    if (target instanceof HTMLElement && target.closest('.tareas-task-drop-slot')) {
                      return
                    }
                    if (isPointerOverPinnedTaskDropSlot(event.clientX, event.clientY)) {
                      return
                    }
                    if (pinnedTaskDropTarget) {
                      setPinnedTaskDropTarget(null)
                    }

                    setTaskDropTarget({ groupName: 'Sin grupo', index: grouped['Sin grupo'].length })
                  }}
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
                      <Fragment key={task.filePath}>
                        {taskDropTarget?.groupName === 'Sin grupo' && taskDropTarget.index === index ? (
                          <div
                            className="tareas-task-drop-slot"
                            data-drop-group="Sin grupo"
                            data-drop-index={index}
                            style={draggedTaskHeight > 0 ? { height: `${draggedTaskHeight}px` } : undefined}
                            onDragOver={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              if (event.dataTransfer) {
                                event.dataTransfer.dropEffect = 'move'
                              }
                              if (!pinnedTaskDropTarget || pinnedTaskDropTarget.groupName !== 'Sin grupo' || pinnedTaskDropTarget.index !== index) {
                                setPinnedTaskDropTarget({ groupName: 'Sin grupo', index })
                              }
                              if (taskDropTarget?.groupName !== 'Sin grupo' || taskDropTarget.index !== index) {
                                setTaskDropTarget({ groupName: 'Sin grupo', index })
                              }
                            }}
                            onDragLeave={() => {
                              if (pinnedTaskDropTarget?.groupName === 'Sin grupo' && pinnedTaskDropTarget.index === index) {
                                setPinnedTaskDropTarget(null)
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              if (!draggedSubtaskPath) {
                                void handleTopLevelTaskDrop('Sin grupo', index)
                              }
                            }}
                          />
                        ) : null}
                        <div
                          className={`tareas-task-drag-wrap${draggedTaskPath === task.filePath ? ' is-dragging' : ''}`}
                          draggable
                          onDragStart={(event) => {
                            if (event.dataTransfer) {
                              event.dataTransfer.effectAllowed = 'move'
                              event.dataTransfer.setData('text/plain', task.filePath)
                            }
                            setPinnedTaskDropTarget(null)
                            setDraggedTaskPath(task.filePath)
                            setDraggedTaskHeight(event.currentTarget.getBoundingClientRect().height)
                          }}
                          onDragEnd={() => {
                            setDraggedTaskPath(null)
                            setDraggedTaskHeight(0)
                            setTaskDropTarget(null)
                            setPinnedTaskDropTarget(null)
                          }}
                          onDragOver={(event) => {
                            event.preventDefault()
                            if (event.dataTransfer) {
                              event.dataTransfer.dropEffect = 'move'
                            }
                            if (draggedTaskPath && !draggedSubtaskPath) {
                              if (isPointerOverPinnedTaskDropSlot(event.clientX, event.clientY)) {
                                return
                              }
                              if (pinnedTaskDropTarget) {
                                setPinnedTaskDropTarget(null)
                              }
                              const bounds = event.currentTarget.getBoundingClientRect()
                              const nextIndex = resolveTaskDropIndexFromPointer('Sin grupo', index, event.clientY, bounds)
                              if (taskDropTarget?.groupName === 'Sin grupo' && taskDropTarget.index === nextIndex) {
                                return
                              }
                              setTaskDropTarget({ groupName: 'Sin grupo', index: nextIndex })
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault()
                            if (!draggedSubtaskPath) {
                              const bounds = event.currentTarget.getBoundingClientRect()
                              const placeBefore = event.clientY < bounds.top + bounds.height / 2
                              void handleTopLevelTaskDrop('Sin grupo', placeBefore ? index : index + 1)
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
                            onChangeTaskState={onChangeTaskState}
                            onChangeTaskPriority={onChangeTaskPriority}
                            onChangeTaskDedicatedHours={onChangeTaskDedicatedHours}
                            onToggleSubtaskDone={onToggleSubtaskDone}
                            onAddTaskComment={openCommentDialog}
                            onOpenTaskSource={openTaskSourceDialog}
                            onOpenTaskFile={onOpenTaskFile}
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
                      </Fragment>
                    ))}

                  {taskDropTarget?.groupName === 'Sin grupo' && taskDropTarget.index === grouped['Sin grupo'].length ? (
                    <div
                      className="tareas-task-drop-slot"
                      data-drop-group="Sin grupo"
                      data-drop-index={grouped['Sin grupo'].length}
                      style={draggedTaskHeight > 0 ? { height: `${draggedTaskHeight}px` } : undefined}
                      onDragOver={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        if (event.dataTransfer) {
                          event.dataTransfer.dropEffect = 'move'
                        }
                        if (
                          !pinnedTaskDropTarget
                          || pinnedTaskDropTarget.groupName !== 'Sin grupo'
                          || pinnedTaskDropTarget.index !== grouped['Sin grupo'].length
                        ) {
                          setPinnedTaskDropTarget({ groupName: 'Sin grupo', index: grouped['Sin grupo'].length })
                        }
                        if (taskDropTarget?.groupName !== 'Sin grupo' || taskDropTarget.index !== grouped['Sin grupo'].length) {
                          setTaskDropTarget({ groupName: 'Sin grupo', index: grouped['Sin grupo'].length })
                        }
                      }}
                      onDragLeave={() => {
                        if (pinnedTaskDropTarget?.groupName === 'Sin grupo' && pinnedTaskDropTarget.index === grouped['Sin grupo'].length) {
                          setPinnedTaskDropTarget(null)
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        if (!draggedSubtaskPath) {
                          void handleTopLevelTaskDrop('Sin grupo', grouped['Sin grupo'].length)
                        }
                      }}
                    />
                  ) : null}
                  <div className="tareas-task-card tareas-task-card-add">
                    <span className="tareas-add-link" onClick={() => onCreateTask({ group: '' })}>
                      <TaskManagerIcon name={TASK_ICON_NAME.plus} size={12} />
                      Nueva tarea
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="tareas-new-group">
          <span className="tareas-add-link" onClick={onCreateGroup}>
            <TaskManagerIcon name={TASK_ICON_NAME.plus} size={12} />
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
  onChangeTaskState: (task: TaskItem, nextState: string) => Promise<void>
  onChangeTaskPriority: (task: TaskItem, nextPriority: TaskPriority) => Promise<void>
  onChangeTaskDedicatedHours: (task: TaskItem, nextDedicatedHours: number) => Promise<void>
  onToggleSubtaskDone: (task: TaskItem, done: boolean) => Promise<void>
  onAddTaskComment: (task: TaskItem) => void
  onOpenTaskSource: (task: TaskItem) => void
  onOpenTaskFile?: (taskPath: string) => void
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
  onChangeTaskState,
  onChangeTaskPriority,
  onChangeTaskDedicatedHours,
  onToggleSubtaskDone,
  onAddTaskComment,
  onOpenTaskSource,
  onOpenTaskFile,
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
  const [isDedicatedHoursEditing, setIsDedicatedHoursEditing] = useState(false)
  const [dedicatedHoursDraft, setDedicatedHoursDraft] = useState(() => formatHours(task.dedicatedHours))
  const [isSavingDedicatedHours, setIsSavingDedicatedHours] = useState(false)
  const [activeMetaMenu, setActiveMetaMenu] = useState<'state' | 'priority' | null>(null)
  const isStateMenuOpen = activeMetaMenu === 'state'
  const isPriorityMenuOpen = activeMetaMenu === 'priority'
  const resolvedPriority: TaskPriority = task.priority || 'Media'
  const { triggerRef: stateTagTriggerRef, panelRef: stateTagPanelRef } = useSubmenuEngine<HTMLButtonElement, HTMLDivElement>({
    open: isStateMenuOpen,
    onClose: () => {
      setActiveMetaMenu((current) => (current === 'state' ? null : current))
    },
  })
  const { triggerRef: priorityTagTriggerRef, panelRef: priorityTagPanelRef } = useSubmenuEngine<HTMLButtonElement, HTMLDivElement>({
    open: isPriorityMenuOpen,
    onClose: () => {
      setActiveMetaMenu((current) => (current === 'priority' ? null : current))
    },
  })

  const handleStateSelection = (nextState: TaskState) => {
    setActiveMetaMenu(null)
    if (task.state === nextState) {
      return
    }

    void onChangeTaskState(task, nextState)
  }

  const handlePrioritySelection = (nextPriority: TaskPriority) => {
    setActiveMetaMenu(null)
    if (resolvedPriority === nextPriority) {
      return
    }

    void onChangeTaskPriority(task, nextPriority)
  }

  const startDedicatedHoursEdit = () => {
    if (isSavingDedicatedHours) {
      return
    }

    setDedicatedHoursDraft(formatHours(task.dedicatedHours))
    setIsDedicatedHoursEditing(true)
  }

  const cancelDedicatedHoursEdit = () => {
    if (isSavingDedicatedHours) {
      return
    }

    setDedicatedHoursDraft(formatHours(task.dedicatedHours))
    setIsDedicatedHoursEditing(false)
  }

  const submitDedicatedHoursEdit = async () => {
    if (isSavingDedicatedHours) {
      return
    }

    const normalized = dedicatedHoursDraft.trim().replace(',', '.')
    const nextValue = Number(normalized)
    if (!Number.isFinite(nextValue) || nextValue < 0) {
      setDedicatedHoursDraft(formatHours(task.dedicatedHours))
      setIsDedicatedHoursEditing(false)
      return
    }

    setIsSavingDedicatedHours(true)
    try {
      if (Math.abs(nextValue - task.dedicatedHours) > 0.00001) {
        await onChangeTaskDedicatedHours(task, nextValue)
      }
      setIsDedicatedHoursEditing(false)
    } finally {
      setIsSavingDedicatedHours(false)
    }
  }

  return (
    <div
      className="tareas-task-card"
      onDoubleClick={(event) => {
        if (
          event.target instanceof HTMLElement
          && event.target.closest('a,button,input,textarea,select,label,.tareas-card-progress-band-text')
        ) {
          return
        }

        onOpenTaskSource(task)
      }}
    >
      <div className="tareas-card-header-band">
        <a
          className="tareas-task-card-title"
          title={task.title}
          href="#"
          onClick={(event) => {
            event.preventDefault()
            if (onOpenTaskFile) {
              onOpenTaskFile(task.filePath)
              return
            }

            onOpenTaskSource(task)
          }}
        >
          {task.title}
        </a>

        <NotiaButton
          size="icon"
          className="tareas-card-header-edit-btn"
          title="Editar tarea"
          onClick={() => onEditTask(task)}
        >
          <TaskManagerIcon name={TASK_ICON_NAME.edit} size={11} />
        </NotiaButton>
      </div>

      <div className="tareas-card-meta-tags">
        <div className="tareas-card-meta-tag-wrap">
          <NotiaButton
            ref={stateTagTriggerRef}
            variant="ghost"
            size="sm"
            className={`tareas-card-meta-tag-trigger tareas-estado tareas-estado-${toClassName(task.state)}${isStateMenuOpen ? ' is-open' : ''}`}
            title="Cambiar estado"
            aria-haspopup="menu"
            aria-expanded={isStateMenuOpen}
            onClick={() => {
              setActiveMetaMenu((current) => (current === 'state' ? null : 'state'))
            }}
          >
            <span>{task.state}</span>
            <TaskManagerIcon name={TASK_ICON_NAME.chevronDown} size={11} />
          </NotiaButton>
          {isStateMenuOpen ? (
            <div className="tareas-card-meta-menu" ref={stateTagPanelRef} role="menu" aria-label="Opciones de estado">
              {TASK_STATES.map((stateOption) => (
                <NotiaButton
                  key={`${task.filePath}-state-${stateOption}`}
                  variant={task.state === stateOption ? 'primary' : 'ghost'}
                  size="sm"
                  className={`tareas-card-meta-menu-option${task.state === stateOption ? ' is-selected' : ''}`}
                  onClick={() => handleStateSelection(stateOption)}
                >
                  {stateOption}
                </NotiaButton>
              ))}
            </div>
          ) : null}
        </div>

        <div className="tareas-card-meta-tag-wrap">
          <NotiaButton
            ref={priorityTagTriggerRef}
            variant="ghost"
            size="sm"
            className={`tareas-card-meta-tag-trigger tareas-prioridad tareas-prioridad-${toClassName(resolvedPriority)}${isPriorityMenuOpen ? ' is-open' : ''}`}
            title="Cambiar prioridad"
            aria-haspopup="menu"
            aria-expanded={isPriorityMenuOpen}
            onClick={() => {
              setActiveMetaMenu((current) => (current === 'priority' ? null : 'priority'))
            }}
          >
            <span>{resolvedPriority}</span>
            <TaskManagerIcon name={TASK_ICON_NAME.chevronDown} size={11} />
          </NotiaButton>
          {isPriorityMenuOpen ? (
            <div className="tareas-card-meta-menu" ref={priorityTagPanelRef} role="menu" aria-label="Opciones de prioridad">
              {TASK_PRIORITIES.map((priorityOption) => (
                <NotiaButton
                  key={`${task.filePath}-priority-${priorityOption}`}
                  variant={resolvedPriority === priorityOption ? 'primary' : 'ghost'}
                  size="sm"
                  className={`tareas-card-meta-menu-option${resolvedPriority === priorityOption ? ' is-selected' : ''}`}
                  onClick={() => handlePrioritySelection(priorityOption)}
                >
                  {priorityOption}
                </NotiaButton>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="tareas-card-detail-row">
        {task.preview ? (
          <p className="tareas-card-preview">{task.preview}</p>
        ) : (
          <p className="tareas-card-preview tareas-card-preview-empty">Sin detalle</p>
        )}

        <NotiaButton
          className="tareas-card-comment-btn tareas-card-detail-comment-btn"
          title="Agregar comentario"
          onClick={() => onAddTaskComment(task)}
        >
          <TaskManagerIcon name={TASK_ICON_NAME.comment} size={12} />
        </NotiaButton>
      </div>

      <div className="tareas-card-footer">
        {subtasks.length > 0 ? (
          <span
            className={`tareas-card-subtasks tareas-card-subtasks-toggle${isSubtasksExpanded ? ' is-expanded' : ''}`}
            onClick={() => onToggleSubtasks(task.filePath)}
          >
            {isSubtasksExpanded
              ? <TaskManagerIcon name={TASK_ICON_NAME.chevronDown} size={13} />
              : <TaskManagerIcon name={TASK_ICON_NAME.chevronRight} size={13} />}
            {subtasks.length}
            {' '}subtarea(s)
          </span>
        ) : <span className="tareas-card-subtasks">Sin subtareas</span>}

        <span className="tareas-add-link" onClick={() => onCreateTask({ parentTaskName: task.fileName, group: task.group })}>
          <TaskManagerIcon name={TASK_ICON_NAME.plus} size={12} />
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

                <span className="tareas-card-subtask-title-wrap">
                  <a
                    className={`tareas-card-subtask-title${checked ? ' is-done' : ''}`}
                    href="#"
                    onClick={(event) => {
                      event.preventDefault()
                      if (onOpenTaskFile) {
                        onOpenTaskFile(subtask.filePath)
                        return
                      }

                      onOpenTaskSource(subtask)
                    }}
                    title={subtask.title}
                  >
                    {subtask.title}
                  </a>
                </span>

                <NotiaButton
                  className="tareas-card-comment-btn"
                  title="Abrir markdown de subtarea"
                  onClick={() => onOpenTaskSource(subtask)}
                >
                  <TaskManagerIcon name={TASK_ICON_NAME.eye} size={12} />
                </NotiaButton>

                <NotiaButton
                  className="tareas-card-comment-btn"
                  title="Agregar comentario"
                  onClick={() => onAddTaskComment(subtask)}
                >
                  <TaskManagerIcon name={TASK_ICON_NAME.comment} size={12} />
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
            {isDedicatedHoursEditing ? (
              <span className="tareas-card-progress-inline-editor" onDoubleClick={(event) => event.stopPropagation()}>
                <input
                  className="tareas-card-progress-inline-input"
                  type="text"
                  value={dedicatedHoursDraft}
                  autoFocus
                  disabled={isSavingDedicatedHours}
                  onMouseDown={(event) => event.stopPropagation()}
                  onChange={(event) => setDedicatedHoursDraft(event.target.value)}
                  onBlur={() => void submitDedicatedHoursEdit()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitDedicatedHoursEdit()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelDedicatedHoursEdit()
                    }
                  }}
                />
                <span>/{formatHours(task.estimatedHours)}</span>
                <span className="tareas-card-progress-band-text-deviation"> +-&gt; {formatHours(task.deviationHours)}</span>
              </span>
            ) : (
              <span onDoubleClick={(event) => {
                event.stopPropagation()
                startDedicatedHoursEdit()
              }}
              >
                {formatHours(task.dedicatedHours)}/{formatHours(task.estimatedHours)}
                <span className="tareas-card-progress-band-text-deviation"> +-&gt; {formatHours(task.deviationHours)}</span>
              </span>
            )}
          </div>
        </div>

        <NotiaButton
          className="tareas-card-pomodoro-btn"
          title="Abrir pomodoro con esta tarea"
          onClick={() => onOpenPomodoroTask(task.filePath)}
        >
          <TaskManagerIcon name={TASK_ICON_NAME.clock} size={12} />
        </NotiaButton>
      </div>

      <div className="tareas-card-status-row">
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
        </div>
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
