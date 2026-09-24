import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { TextField } from '@mui/material'
import { TASK_ICON_NAME, TaskManagerIcon } from '../../engines/taskIconEngine'
import { TASK_PRIORITIES, TASK_STATES } from '../../constants/taskManagerConstants'
import type { Group, TaskCreationRequest, TaskItem, TaskPriority, TaskState } from '../../types/taskManagerTypes'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { TaskManagerModal } from '../common/TaskManagerModal'
import { TaskSourceDialog, type TaskSourceDialogState } from '../dialogs/TaskSourceDialog'
import type { LibraryContext } from '../../../../services/contexts/libraryContexts'
import { useSubmenuEngine } from '../../../../hooks/useSubmenuEngine'

interface TaskBoardViewProps {
  boardName: string
  tasks: TaskItem[]
  groups: Group[]
  onCreateTask: (request?: TaskCreationRequest) => void
  onEditTask: (task: TaskItem) => void
  onChangeTaskState: (task: TaskItem, nextState: string) => Promise<void>
  onChangeTaskPriority: (task: TaskItem, nextPriority: TaskPriority) => Promise<void>
  onChangeTaskDedicatedHours: (task: TaskItem, nextDedicatedHours: number) => Promise<void>
  onToggleSubtaskDone: (task: TaskItem, done: boolean) => Promise<void>
  onAddTaskComment: (task: TaskItem, comment: string) => Promise<void>
  onLoadTaskSource: (taskPath: string) => Promise<string>
  onSaveTaskSource: (taskPath: string, content: string) => Promise<void>
  onOpenTaskFile?: (taskPath: string) => void
  /** Opens a library file linked from the task editor. */
  onOpenLinkedFile?: (path: string) => void
  /** Library of the board, for the task editor's links and properties. */
  libraryId?: string
  contexts?: readonly LibraryContext[]
  onCreateGroup: () => void
  onEditGroup: (group: Group) => void
  onOpenPomodoroTask: (taskPath: string) => void
  onReorderGroups: (boardName: string, orderedGroupNames: string[]) => Promise<void>
  /** Drop of a task: the destination list as displayed, including the task. */
  onPlaceTask: (placement: { taskPath: string; orderedPaths: string[]; group: string; parentTaskName: string }) => Promise<void>
}

const STATUS_ACTIONS = [
  { id: 'dismiss', label: 'Desestimar', nextState: 'Cancelada', cls: 'is-dismiss' },
  { id: 'start-stop', label: 'Iniciar', nextState: 'En progreso', cls: 'is-start-stop' },
  { id: 'finish', label: 'Finalizar', nextState: 'Finalizada', cls: 'is-finish' },
] as const
const TOUCH_DRAG_DELAY_MS = 350
const TOUCH_DRAG_CANCEL_DISTANCE_PX = 10
const EMPTY_TASKS: TaskItem[] = []
const UNGROUPED_NAME = 'Sin grupo'
const UNGROUPED_COLOR = '#64748b'

/** Where a dragged task would land: its index among the other tasks of the group. */
interface TaskDropTarget {
  groupName: string
  index: number
}

/** A move sent to the backend, shown in place until the board reloads. */
interface PendingPlacement {
  taskPath: string
  orderedPaths: string[]
  groupName: string
  parentTaskPath: string | null
}

interface BoardColumn {
  group: Group
  /** Configured groups can be dragged, edited and reordered; "Sin grupo" cannot. */
  managed: boolean
}

/** What a long press picked up: a top-level task or a group header. */
type TouchDragItem = { kind: 'task'; taskPath: string } | { kind: 'group'; groupName: string }

interface TouchDragState {
  pointerId: number
  item: TouchDragItem
  originX: number
  originY: number
  timerId: number | null
  active: boolean
}

interface TaskCommentDialogState {
  task: TaskItem
  text: string
}

interface BoardTaskDerivations {
  boardTasks: TaskItem[]
  groupedTopLevelTasks: Record<string, TaskItem[]>
  topLevelTasks: TaskItem[]
  subtasksByParentPath: Map<string, TaskItem[]>
  parentTaskBySubtaskPath: Map<string, TaskItem>
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
  onOpenLinkedFile,
  libraryId,
  contexts,
  onCreateGroup,
  onEditGroup,
  onOpenPomodoroTask,
  onReorderGroups,
  onPlaceTask,
}: TaskBoardViewProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(groups.map((group) => getGroupKey(group))))
  const previousGroupKeysRef = useRef<Set<string>>(new Set(groups.map((group) => getGroupKey(group))))
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<string>>(() => new Set())
  const [commentDialog, setCommentDialog] = useState<TaskCommentDialogState | null>(null)
  const [sourceDialog, setSourceDialog] = useState<TaskSourceDialogState | null>(null)
  const [draggedGroupName, setDraggedGroupName] = useState<string | null>(null)
  const [draggedTaskPath, setDraggedTaskPath] = useState<string | null>(null)
  const [draggedTaskHeight, setDraggedTaskHeight] = useState<number>(0)
  const [draggedSubtaskPath, setDraggedSubtaskPath] = useState<string | null>(null)
  const [groupDropTargetName, setGroupDropTargetName] = useState<string | null>(null)
  const [taskDropTarget, setTaskDropTargetState] = useState<TaskDropTarget | null>(null)
  const taskDropTargetRef = useRef<TaskDropTarget | null>(null)
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null)
  const [subtaskDropTarget, setSubtaskDropTarget] = useState<{ parentTaskPath: string; index: number } | null>(null)
  const [isTouchDragging, setIsTouchDragging] = useState(false)
  const touchDragRef = useRef<TouchDragState | null>(null)
  const draggedTaskPathRef = useRef<string | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)

  // While a long press drags, the finger must not scroll the page: scrolling
  // would cancel the pointer. React touch listeners are passive, so this one
  // is registered by hand. Before the long press, touches scroll as usual.
  useEffect(() => {
    const board = boardRef.current
    if (!board) {
      return
    }
    const blockScrollWhileDragging = (event: TouchEvent) => {
      if (touchDragRef.current?.active && event.cancelable) {
        event.preventDefault()
      }
    }
    board.addEventListener('touchmove', blockScrollWhileDragging, { passive: false })
    return () => board.removeEventListener('touchmove', blockScrollWhileDragging)
  }, [])

  const startTopLevelTaskDrag = useCallback((taskPath: string) => {
    draggedTaskPathRef.current = taskPath
    setDraggedTaskPath(taskPath)
  }, [])

  /** Dragover fires continuously; only a new position re-renders the board. */
  const setTaskDropTarget = useCallback((next: TaskDropTarget | null) => {
    const current = taskDropTargetRef.current
    if (current?.groupName === next?.groupName && current?.index === next?.index) {
      return
    }
    taskDropTargetRef.current = next
    setTaskDropTargetState(next)
  }, [])

  const clearTopLevelTaskDrag = useCallback(() => {
    draggedTaskPathRef.current = null
    setDraggedTaskPath(null)
    setDraggedTaskHeight(0)
    setTaskDropTarget(null)
  }, [setTaskDropTarget])

  useEffect(() => {
    const currentGroupKeys = new Set(groups.map((group) => getGroupKey(group)))
    const addedGroupKeys = Array.from(currentGroupKeys).filter((groupKey) => !previousGroupKeysRef.current.has(groupKey))
    previousGroupKeysRef.current = currentGroupKeys

    if (addedGroupKeys.length === 0) {
      return
    }

    setExpandedGroups((previous) => {
      const next = new Set(previous)
      for (const groupKey of addedGroupKeys) {
        next.add(groupKey)
      }
      return next
    })
  }, [groups])

  const baseDerivations = useMemo<BoardTaskDerivations>(() => {
    const nextBoardTasks = tasks
      .filter((task) => task.board === boardName)
      .filter((task) => !task.filePath.includes('/finished/') && !task.filePath.includes('/cancelled/'))

    const nextTopLevelTasks: TaskItem[] = []
    const topLevelByNormalizedParentName = new Map<string, TaskItem>()
    const nextGroupedTopLevelTasks: Record<string, TaskItem[]> = {}
    const nextSubtasksByParentPath = new Map<string, TaskItem[]>()
    const nextParentTaskBySubtaskPath = new Map<string, TaskItem>()

    for (const group of groups) {
      nextGroupedTopLevelTasks[group.name] = []
    }

    for (const task of nextBoardTasks) {
      if (task.parentTaskName.trim()) {
        continue
      }

      nextTopLevelTasks.push(task)
      nextSubtasksByParentPath.set(task.filePath, [])
      topLevelByNormalizedParentName.set(task.fileName.trim().toLowerCase(), task)
      topLevelByNormalizedParentName.set(task.title.trim().toLowerCase(), task)

      if (task.state === 'Finalizada' || task.state === 'Cancelada') {
        continue
      }

      const groupName = task.group || 'Sin grupo'
      if (!nextGroupedTopLevelTasks[groupName]) {
        nextGroupedTopLevelTasks[groupName] = []
      }
      nextGroupedTopLevelTasks[groupName].push(task)
    }

    nextTopLevelTasks.sort((left, right) => left.order - right.order)
    for (const groupedTasks of Object.values(nextGroupedTopLevelTasks)) {
      groupedTasks.sort((left, right) => left.order - right.order)
    }

    for (const task of nextBoardTasks) {
      const normalizedParentTaskName = task.parentTaskName.trim().toLowerCase()
      if (!normalizedParentTaskName) {
        continue
      }

      const parentTask = topLevelByNormalizedParentName.get(normalizedParentTaskName)
      if (!parentTask) {
        continue
      }

      const subtasks = nextSubtasksByParentPath.get(parentTask.filePath)
      if (!subtasks) {
        continue
      }

      subtasks.push(task)
      nextParentTaskBySubtaskPath.set(task.filePath, parentTask)
    }

    for (const subtasks of nextSubtasksByParentPath.values()) {
      subtasks.sort((left, right) => left.order - right.order)
    }

    return {
      boardTasks: nextBoardTasks,
      groupedTopLevelTasks: nextGroupedTopLevelTasks,
      parentTaskBySubtaskPath: nextParentTaskBySubtaskPath,
      subtasksByParentPath: nextSubtasksByParentPath,
      topLevelTasks: nextTopLevelTasks,
    }
  }, [boardName, groups, tasks])

  const { boardTasks, groupedTopLevelTasks, parentTaskBySubtaskPath, subtasksByParentPath, topLevelTasks } = useMemo(
    () => applyPendingPlacement(baseDerivations, pendingPlacement),
    [baseDerivations, pendingPlacement],
  )

  const columns = useMemo<BoardColumn[]>(() => {
    const nextColumns = groups.map((group) => ({ group, managed: true }))
    if (groupedTopLevelTasks[UNGROUPED_NAME]?.length) {
      nextColumns.push({ group: { name: UNGROUPED_NAME, color: UNGROUPED_COLOR, board: boardName }, managed: false })
    }
    return nextColumns
  }, [boardName, groupedTopLevelTasks, groups])

  const toggleGroup = useCallback((group: Group) => {
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
  }, [])

  const toggleSubtasks = useCallback((taskPath: string) => {
    setExpandedSubtasks((previous) => {
      const next = new Set(previous)
      if (next.has(taskPath)) {
        next.delete(taskPath)
      } else {
        next.add(taskPath)
      }
      return next
    })
  }, [])

  const openCommentDialog = useCallback((task: TaskItem) => {
    setCommentDialog({ task, text: '' })
  }, [])

  const handleSubtaskDragOverTarget = useCallback((parentTaskPath: string, targetIndex: number) => {
    setSubtaskDropTarget((previous) => {
      if (previous?.parentTaskPath === parentTaskPath && previous.index === targetIndex) {
        return previous
      }

      return { parentTaskPath, index: targetIndex }
    })
  }, [])

  const handleSubtaskDragLeaveTarget = useCallback((parentTaskPath: string, targetIndex: number) => {
    setSubtaskDropTarget((previous) => {
      if (previous?.parentTaskPath === parentTaskPath && previous.index === targetIndex) {
        return null
      }

      return previous
    })
  }, [])

  const handleSubtaskDragEnd = useCallback(() => {
    setDraggedSubtaskPath(null)
    setSubtaskDropTarget(null)
  }, [])

  const managedGroupNames = groups.map((group) => group.name)

  const clearGroupDrag = useCallback(() => {
    setDraggedGroupName(null)
    setGroupDropTargetName(null)
  }, [])

  /** The dragged group takes the place of the group it is dropped on. */
  const handleGroupDrop = useCallback(async (targetGroupName: string, sourceGroupName = draggedGroupName) => {
    clearGroupDrag()
    const targetIndex = managedGroupNames.indexOf(targetGroupName)
    if (!sourceGroupName || sourceGroupName === targetGroupName || targetIndex < 0) {
      return
    }

    const ordered = managedGroupNames.filter((name) => name !== sourceGroupName)
    ordered.splice(targetIndex, 0, sourceGroupName)
    await onReorderGroups(boardName, ordered)
  }, [boardName, clearGroupDrag, draggedGroupName, managedGroupNames, onReorderGroups])

  /** Shows the move right away and sends it; the reload replaces the preview. */
  const placeTask = useCallback(async (placement: PendingPlacement, parentTaskName: string, group: string) => {
    setPendingPlacement(placement)
    try {
      await onPlaceTask({ taskPath: placement.taskPath, orderedPaths: placement.orderedPaths, group, parentTaskName })
    } finally {
      setPendingPlacement((current) => (current === placement ? null : current))
    }
  }, [onPlaceTask])

  /** `targetIndex` counts the tasks of the target group other than the dragged one. */
  const handleTopLevelTaskDrop = useCallback(async (
    targetGroupName: string,
    targetIndex: number,
    sourceTaskPath = draggedTaskPathRef.current,
  ) => {
    clearTopLevelTaskDrag()
    const draggedTask = sourceTaskPath ? topLevelTasks.find((task) => task.filePath === sourceTaskPath) : undefined
    if (!draggedTask) {
      return
    }

    const targetTasks = groupedTopLevelTasks[targetGroupName] ?? EMPTY_TASKS
    const otherTasks = targetTasks.filter((task) => task.filePath !== draggedTask.filePath)
    const nextIndex = Math.max(0, Math.min(targetIndex, otherTasks.length))
    if (targetTasks.indexOf(draggedTask) === nextIndex) {
      return
    }
    otherTasks.splice(nextIndex, 0, draggedTask)

    await placeTask({
      taskPath: draggedTask.filePath,
      orderedPaths: otherTasks.map((task) => task.filePath),
      groupName: targetGroupName,
      parentTaskPath: null,
    }, '', targetGroupName === UNGROUPED_NAME ? '' : targetGroupName)
  }, [clearTopLevelTaskDrag, groupedTopLevelTasks, placeTask, topLevelTasks])

  /** `targetIndex` is the row the subtask is dropped on, counting the dragged one. */
  const handleSubtaskDrop = useCallback(async (targetParentTask: TaskItem, targetIndex: number) => {
    const draggedSubtask = draggedSubtaskPath ? boardTasks.find((task) => task.filePath === draggedSubtaskPath) : undefined
    setDraggedSubtaskPath(null)
    setSubtaskDropTarget(null)
    if (!draggedSubtask || !parentTaskBySubtaskPath.has(draggedSubtask.filePath)) {
      return
    }

    const targetSubtasks = subtasksByParentPath.get(targetParentTask.filePath) ?? EMPTY_TASKS
    const sourceIndex = targetSubtasks.indexOf(draggedSubtask)
    const otherSubtasks = targetSubtasks.filter((task) => task !== draggedSubtask)
    const shiftedIndex = sourceIndex >= 0 && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
    const nextIndex = Math.max(0, Math.min(shiftedIndex, otherSubtasks.length))
    if (sourceIndex === nextIndex) {
      return
    }
    otherSubtasks.splice(nextIndex, 0, draggedSubtask)

    await placeTask({
      taskPath: draggedSubtask.filePath,
      orderedPaths: otherSubtasks.map((task) => task.filePath),
      groupName: targetParentTask.group || UNGROUPED_NAME,
      parentTaskPath: targetParentTask.filePath,
    }, targetParentTask.fileName, targetParentTask.group)
  }, [boardTasks, draggedSubtaskPath, parentTaskBySubtaskPath, placeTask, subtasksByParentPath])

  /** Index among the other tasks of the group, from the vertical centre of each card. */
  const resolveTaskDropTarget = useCallback((groupNode: HTMLElement, clientY: number): TaskDropTarget | null => {
    const groupName = groupNode.dataset.group
    if (!groupName) {
      return null
    }
    const draggedPath = draggedTaskPathRef.current
    const list = groupNode.querySelector<HTMLElement>(':scope > .tareas-card-list')
    if (!list) {
      const otherCount = (groupedTopLevelTasks[groupName] ?? EMPTY_TASKS).filter((task) => task.filePath !== draggedPath).length
      return { groupName, index: otherCount }
    }
    let index = 0
    for (const node of list.querySelectorAll<HTMLElement>(':scope > .tareas-task-drag-wrap[data-task-path]')) {
      if (node.dataset.taskPath === draggedPath) {
        continue
      }
      const bounds = node.getBoundingClientRect()
      if (clientY < bounds.top + bounds.height / 2) {
        break
      }
      index += 1
    }
    return { groupName, index }
  }, [groupedTopLevelTasks])

  const submitCommentDialog = async () => {
    if (!commentDialog) {
      return
    }

    await onAddTaskComment(commentDialog.task, commentDialog.text)
    setCommentDialog(null)
  }

  const openTaskSourceDialog = useCallback(async (task: TaskItem) => {
    setSourceDialog({ task, originalSource: '', source: '', isLoading: true, isSaving: false, loadError: null })
    try {
      const source = await onLoadTaskSource(task.filePath)
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
  }, [onLoadTaskSource])

  const saveTaskSourceDialog = async () => {
    if (!sourceDialog) {
      return
    }

    setSourceDialog((previous) => previous ? { ...previous, isSaving: true } : previous)
    try {
      await onSaveTaskSource(sourceDialog.task.filePath, sourceDialog.source)
      setSourceDialog(null)
    } catch {
      setSourceDialog((previous) => previous ? { ...previous, isSaving: false } : previous)
    }
  }

  const clearTouchDrag = useCallback(() => {
    const touchDrag = touchDragRef.current
    if (touchDrag && touchDrag.timerId !== null) {
      window.clearTimeout(touchDrag.timerId)
    }
    touchDragRef.current = null
    setIsTouchDragging(false)
    clearTopLevelTaskDrag()
    clearGroupDrag()
  }, [clearGroupDrag, clearTopLevelTaskDrag])

  useEffect(() => () => {
    const touchDrag = touchDragRef.current
    if (touchDrag && touchDrag.timerId !== null) {
      window.clearTimeout(touchDrag.timerId)
    }
  }, [])

  const resolveTouchDropTarget = useCallback((clientX: number, clientY: number) => {
    const groupNode = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.tareas-group[data-group]')
    return groupNode ? resolveTaskDropTarget(groupNode, clientY) : null
  }, [resolveTaskDropTarget])

  const resolveTouchGroupTarget = useCallback((clientX: number, clientY: number) => (
    document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.tareas-group[data-group]')?.dataset.group ?? null
  ), [])

  const handleTouchPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      return
    }
    const target = event.target
    if (!(target instanceof HTMLElement) || target.closest('button, input, textarea, select, a, [contenteditable="true"]')) {
      return
    }
    const taskPath = target.closest<HTMLElement>('.tareas-task-drag-wrap[data-task-path]')?.dataset.taskPath
    const groupName = target.closest<HTMLElement>('.tareas-group-header[data-drag-group]')?.dataset.dragGroup
    const item: TouchDragItem | null = taskPath
      ? { kind: 'task', taskPath }
      : groupName ? { kind: 'group', groupName } : null
    if (!item) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const touchDrag: TouchDragState = {
      pointerId: event.pointerId,
      item,
      originX: event.clientX,
      originY: event.clientY,
      timerId: null,
      active: false,
    }
    touchDrag.timerId = window.setTimeout(() => {
      touchDrag.active = true
      touchDrag.timerId = null
      setIsTouchDragging(true)
      if (item.kind === 'group') {
        setDraggedGroupName(item.groupName)
        return
      }
      startTopLevelTaskDrag(item.taskPath)
      setDraggedTaskHeight(0)
    }, TOUCH_DRAG_DELAY_MS)
    touchDragRef.current = touchDrag
  }, [startTopLevelTaskDrag])

  const handleTouchPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const touchDrag = touchDragRef.current
    if (!touchDrag || touchDrag.pointerId !== event.pointerId) {
      return
    }
    if (!touchDrag.active) {
      if (Math.hypot(event.clientX - touchDrag.originX, event.clientY - touchDrag.originY) > TOUCH_DRAG_CANCEL_DISTANCE_PX) {
        clearTouchDrag()
      }
      return
    }
    event.preventDefault()
    if (touchDrag.item.kind === 'group') {
      const groupName = resolveTouchGroupTarget(event.clientX, event.clientY)
      setGroupDropTargetName((previous) => (previous === groupName ? previous : groupName))
      return
    }
    const target = resolveTouchDropTarget(event.clientX, event.clientY)
    if (target) {
      setTaskDropTarget(target)
    }
  }, [clearTouchDrag, resolveTouchDropTarget, resolveTouchGroupTarget, setTaskDropTarget])

  const handleTouchPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const touchDrag = touchDragRef.current
    if (!touchDrag || touchDrag.pointerId !== event.pointerId) {
      return
    }
    const { active, item } = touchDrag
    // Read the shown position before clearing the drag state it depends on.
    const target = active && item.kind === 'task'
      ? taskDropTargetRef.current ?? resolveTouchDropTarget(event.clientX, event.clientY)
      : null
    clearTouchDrag()
    if (!active) {
      return
    }
    if (item.kind === 'group') {
      const groupName = resolveTouchGroupTarget(event.clientX, event.clientY)
      if (groupName) {
        void handleGroupDrop(groupName, item.groupName)
      }
      return
    }
    if (target) {
      void handleTopLevelTaskDrop(target.groupName, target.index, item.taskPath)
    }
  }, [clearTouchDrag, handleGroupDrop, handleTopLevelTaskDrop, resolveTouchDropTarget, resolveTouchGroupTarget])

  const handleTouchPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const touchDrag = touchDragRef.current
    if (!touchDrag || event.pointerType !== 'touch' || touchDrag.pointerId !== event.pointerId) {
      return
    }
    clearTouchDrag()
  }, [clearTouchDrag])

  return (
    <>
      <div className="tareas-board-shell">
        <div
          ref={boardRef}
          className={`tareas-board${isTouchDragging ? ' is-touch-dragging' : ''}`}
          onContextMenu={(event) => {
            if (touchDragRef.current) {
              event.preventDefault()
            }
          }}
          onPointerDown={handleTouchPointerDown}
          onPointerMove={handleTouchPointerMove}
          onPointerUp={handleTouchPointerEnd}
          onPointerCancel={handleTouchPointerCancel}
        >
          {columns.map(({ group, managed }) => {
            const groupTasks = groupedTopLevelTasks[group.name] ?? EMPTY_TASKS
            const groupKey = getGroupKey(group)
            const isExpanded = expandedGroups.has(groupKey)
            const isGroupDropTarget = managed && groupDropTargetName === group.name && draggedGroupName !== group.name
            const draggedIndex = draggedTaskPath ? groupTasks.findIndex((task) => task.filePath === draggedTaskPath) : -1
            // Dropping a task where it already is changes nothing: no slot.
            const slotIndex = taskDropTarget?.groupName === group.name && taskDropTarget.index !== draggedIndex
              ? taskDropTarget.index
              : null
            const dropSlot = (
              <div
                className="tareas-task-drop-slot"
                style={draggedTaskHeight > 0 ? { height: `${draggedTaskHeight}px` } : undefined}
              />
            )
            let otherIndex = 0

            return (
              <div
                key={groupKey}
                className={`tareas-group${isGroupDropTarget ? ' is-drop-target' : ''}`}
                data-group={group.name}
                onDragOver={(event) => {
                  if (draggedTaskPathRef.current && !draggedSubtaskPath) {
                    event.preventDefault()
                    if (event.dataTransfer) {
                      event.dataTransfer.dropEffect = 'move'
                    }
                    if (!isExpanded) {
                      setExpandedGroups((previous) => new Set(previous).add(groupKey))
                    }
                    setTaskDropTarget(resolveTaskDropTarget(event.currentTarget, event.clientY))
                    return
                  }
                  if (!managed || !draggedGroupName) {
                    return
                  }
                  event.preventDefault()
                  if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = 'move'
                  }
                  if (groupDropTargetName !== group.name) {
                    setGroupDropTargetName(group.name)
                  }
                }}
                onDragLeave={(event) => {
                  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
                    return
                  }
                  if (groupDropTargetName === group.name) {
                    setGroupDropTargetName(null)
                  }
                }}
                onDrop={(event) => {
                  if (draggedTaskPathRef.current && !draggedSubtaskPath) {
                    event.preventDefault()
                    const shown = taskDropTargetRef.current
                    const target = shown?.groupName === group.name
                      ? shown
                      : resolveTaskDropTarget(event.currentTarget, event.clientY)
                    if (target) {
                      void handleTopLevelTaskDrop(target.groupName, target.index)
                    }
                    return
                  }
                  if (!managed || !draggedGroupName) {
                    return
                  }
                  event.preventDefault()
                  void handleGroupDrop(group.name)
                }}
              >
                <div
                  className={`tareas-group-header${draggedGroupName === group.name ? ' is-dragging' : ''}`}
                  data-drag-group={managed ? group.name : undefined}
                  data-group-color={group.color.toLowerCase()}
                  style={{ '--tareas-group-color-base': group.color } as CSSProperties}
                  onClick={() => toggleGroup(group)}
                  draggable={managed}
                  onDragStart={managed ? (event) => {
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', group.name)
                    }
                    setDraggedGroupName(group.name)
                  } : undefined}
                  onDragEnd={managed ? clearGroupDrag : undefined}
                >
                  <span className="tareas-toggle">
                    {isExpanded
                      ? <TaskManagerIcon name={TASK_ICON_NAME.chevronDown} size={13} />
                      : <TaskManagerIcon name={TASK_ICON_NAME.chevronRight} size={13} />}
                  </span>
                  <span className="tareas-badge">{group.name}</span>
                  <span className="tareas-count">{groupTasks.length}</span>
                  {managed ? (
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
                  ) : null}
                </div>

                {isExpanded ? (
                  <div className="tareas-card-list">
                    {groupTasks.map((task) => {
                      const isDragged = task.filePath === draggedTaskPath
                      const slotBefore = !isDragged && slotIndex === otherIndex
                      if (!isDragged) {
                        otherIndex += 1
                      }
                      return (
                        <Fragment key={task.filePath}>
                          {slotBefore ? dropSlot : null}
                          <div
                            className={`tareas-task-drag-wrap${isDragged ? ' is-dragging' : ''}`}
                            data-task-path={task.filePath}
                            draggable
                            onDragStart={(event) => {
                              if (event.dataTransfer) {
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', task.filePath)
                              }
                              startTopLevelTaskDrag(task.filePath)
                              setDraggedTaskHeight(event.currentTarget.getBoundingClientRect().height)
                            }}
                            onDragEnd={clearTopLevelTaskDrag}
                          >
                            <TaskCard
                              task={task}
                              subtasks={subtasksByParentPath.get(task.filePath) ?? EMPTY_TASKS}
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
                              activeSubtaskDropIndex={
                                subtaskDropTarget?.parentTaskPath === task.filePath ? subtaskDropTarget.index : null
                              }
                              onSubtaskDragStart={setDraggedSubtaskPath}
                              onSubtaskDragEnd={handleSubtaskDragEnd}
                              onSubtaskDragOverTarget={handleSubtaskDragOverTarget}
                              onSubtaskDragLeaveTarget={handleSubtaskDragLeaveTarget}
                              onSubtaskDrop={handleSubtaskDrop}
                            />
                          </div>
                        </Fragment>
                      )
                    })}
                    {slotIndex !== null && slotIndex >= otherIndex ? dropSlot : null}
                    <div className="tareas-task-card tareas-task-card-add">
                      <span className="tareas-add-link" onClick={() => onCreateTask({ kind: 'task', group: managed ? group.name : '' })}>
                        <TaskManagerIcon name={TASK_ICON_NAME.plus} size={12} />
                        Nueva tarea
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="tareas-new-group">
          <span className="tareas-add-link" onClick={onCreateGroup}>
            <TaskManagerIcon name={TASK_ICON_NAME.plus} size={12} />
            Nuevo grupo
          </span>
        </div>
      </div>

      <TaskManagerModal open={Boolean(commentDialog)} onClose={() => setCommentDialog(null)} size="md" >
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
      </TaskManagerModal>

      {sourceDialog ? (
        <TaskSourceDialog
          state={sourceDialog}
          libraryId={libraryId}
          contexts={contexts}
          onSourceChange={(source) => {
            setSourceDialog((previous) => previous ? { ...previous, source } : previous)
          }}
          onSave={() => void saveTaskSourceDialog()}
          onClose={() => setSourceDialog(null)}
          onOpenLinkedFile={onOpenLinkedFile}
        />
      ) : null}
    </>
  )
}

interface TaskCardProps {
  task: TaskItem
  subtasks: TaskItem[]
  isSubtasksExpanded: boolean
  onToggleSubtasks: (taskPath: string) => void
  onCreateTask: (request?: TaskCreationRequest) => void
  onEditTask: (task: TaskItem) => void
  onChangeTaskState: (task: TaskItem, nextState: string) => Promise<void>
  onChangeTaskPriority: (task: TaskItem, nextPriority: TaskPriority) => Promise<void>
  onChangeTaskDedicatedHours: (task: TaskItem, nextDedicatedHours: number) => Promise<void>
  onToggleSubtaskDone: (task: TaskItem, done: boolean) => Promise<void>
  onAddTaskComment: (task: TaskItem) => void
  onOpenTaskSource: (task: TaskItem) => void
  onOpenTaskFile?: (taskPath: string) => void
  onOpenPomodoroTask: (taskPath: string) => void
  activeSubtaskDropIndex: number | null
  onSubtaskDragStart: (taskPath: string) => void
  onSubtaskDragEnd: () => void
  onSubtaskDragOverTarget: (parentTaskPath: string, targetIndex: number) => void
  onSubtaskDragLeaveTarget: (parentTaskPath: string, targetIndex: number) => void
  onSubtaskDrop: (task: TaskItem, targetIndex: number) => Promise<void>
}

function TaskCardComponent({
  task,
  subtasks,
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
  activeSubtaskDropIndex,
  onSubtaskDragStart,
  onSubtaskDragEnd,
  onSubtaskDragOverTarget,
  onSubtaskDragLeaveTarget,
  onSubtaskDrop,
}: TaskCardProps) {
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

        <span className="tareas-add-link" onClick={() => onCreateTask({ kind: 'subtask', parentTaskName: task.fileName, group: task.group })}>
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
            onSubtaskDragOverTarget(task.filePath, subtasks.length)
          }}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void onSubtaskDrop(task, subtasks.length)
          }}
        >
          {subtasks.map((subtask, index) => {
            const checked = subtask.state === 'Finalizada'
            return (
              <div
                className={`tareas-card-subtask-row${activeSubtaskDropIndex === index ? ' is-drop-target' : ''}`}
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
                  onSubtaskDragOverTarget(task.filePath, index)
                }}
                onDragLeave={() => onSubtaskDragLeaveTarget(task.filePath, index)}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void onSubtaskDrop(task, index)
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
          {activeSubtaskDropIndex === subtasks.length ? (
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
                <span className="tareas-card-progress-band-text-deviation" aria-label={`desvío ${formatHours(task.deviationHours)}`}>→ {formatHours(task.deviationHours)}</span>
              </span>
            ) : (
              <span onDoubleClick={(event) => {
                event.stopPropagation()
                startDedicatedHoursEdit()
              }}
              >
                {formatHours(task.dedicatedHours)}/{formatHours(task.estimatedHours)}
                <span className="tareas-card-progress-band-text-deviation" aria-label={`desvío ${formatHours(task.deviationHours)}`}>→ {formatHours(task.deviationHours)}</span>
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
          {orderedStatusActions(task.state).map((action, index) => {
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
                className={`tareas-status-action-btn ${action.cls}${index === 0 ? ' is-primary' : ''}${task.state === nextState ? ' is-active' : ''}`}
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

const TaskCard = memo(TaskCardComponent)
TaskCard.displayName = 'TaskCard'

/**
 * Shows a move already sent to the backend in its destination list, so the
 * card does not jump back while the board reloads. Presentation only: the
 * next snapshot from the backend replaces it.
 */
function applyPendingPlacement(derivations: BoardTaskDerivations, pending: PendingPlacement | null): BoardTaskDerivations {
  if (!pending) {
    return derivations
  }
  const taskByPath = new Map(derivations.boardTasks.map((task) => [task.filePath, task]))
  const orderedTasks = pending.orderedPaths.flatMap((path) => taskByPath.get(path) ?? [])
  const withoutMoved = (list: TaskItem[]) => list.filter((task) => task.filePath !== pending.taskPath)

  if (pending.parentTaskPath === null) {
    const groupedTopLevelTasks = Object.fromEntries(
      Object.entries(derivations.groupedTopLevelTasks).map(([groupName, list]) => [groupName, withoutMoved(list)]),
    )
    groupedTopLevelTasks[pending.groupName] = orderedTasks
    return { ...derivations, groupedTopLevelTasks }
  }

  const subtasksByParentPath = new Map(
    Array.from(derivations.subtasksByParentPath, ([parentPath, list]) => [parentPath, withoutMoved(list)]),
  )
  subtasksByParentPath.set(pending.parentTaskPath, orderedTasks)
  return { ...derivations, subtasksByParentPath }
}

function getGroupKey(group: Group): string {
  return `${group.board ?? 'default'}::${group.name}`
}

/** Actions in display order: the one that moves the task forward goes first. */
function orderedStatusActions(state: string) {
  const byId = Object.fromEntries(STATUS_ACTIONS.map((action) => [action.id, action]))
  return state === 'En progreso'
    ? [byId.finish, byId['start-stop'], byId.dismiss]
    : [byId['start-stop'], byId.finish, byId.dismiss]
}

function toClassName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-')
}

function formatHours(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}
