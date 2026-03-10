import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, CornerDownRight, GripVertical } from 'lucide-react'
import type { TaskItem } from '../../types/taskManagerTypes'
import { NotiaButton } from '../../../../components/common/NotiaButton'

interface TaskTableViewProps {
  title: string
  tasks: TaskItem[]
  onChangeTaskState: (task: TaskItem, nextState: string) => Promise<void>
  onDeleteTask: (task: TaskItem) => Promise<void>
}

export function TaskTableView({ title, tasks, onChangeTaskState, onDeleteTask }: TaskTableViewProps) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(() => new Set())

  const taskMap = useMemo(() => {
    const map = new Map<string, TaskItem>()
    for (const task of tasks) {
      map.set(task.fileName.toLowerCase(), task)
      map.set(task.title.toLowerCase(), task)
    }
    return map
  }, [tasks])

  const childrenByParent = useMemo(() => {
    const map = new Map<string, TaskItem[]>()
    for (const task of tasks) {
      const parentName = task.parentTaskName.trim().toLowerCase()
      if (!parentName) {
        continue
      }

      const bucket = map.get(parentName) ?? []
      bucket.push(task)
      map.set(parentName, bucket)
    }

    for (const bucket of map.values()) {
      bucket.sort((left, right) => left.order - right.order)
    }

    return map
  }, [tasks])

  const topLevelTasks = useMemo(
    () => tasks
      .filter((task) => !task.parentTaskName.trim())
      .sort((left, right) => left.order - right.order),
    [tasks],
  )

  const toggleExpanded = (taskPath: string) => {
    setExpandedTasks((previous) => {
      const next = new Set(previous)
      if (next.has(taskPath)) {
        next.delete(taskPath)
      } else {
        next.add(taskPath)
      }
      return next
    })
  }

  const renderRows = (task: TaskItem, depth: number): ReactNode[] => {
    const children = resolveChildren(task, childrenByParent, taskMap)
    const hasChildren = children.length > 0
    const isExpanded = expandedTasks.has(task.filePath)
    const progressPercent = task.estimatedHours > 0 ? Math.round((task.dedicatedHours / task.estimatedHours) * 100) : 0

    const rows: ReactNode[] = [
      <tr key={task.filePath} className="tareas-row">
        <td className="tareas-cell-drag">
          <span className="tareas-drag-handle">
            <GripVertical size={12} />
          </span>
        </td>

        <td className="tareas-cell-toggle">
          {depth === 0 ? (
            <span
              className={`tareas-subtask-toggle${hasChildren ? '' : ' tareas-toggle-empty'}`}
              onClick={hasChildren ? () => toggleExpanded(task.filePath) : undefined}
            >
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          ) : null}
        </td>

        <td className="tareas-cell-name" style={{ paddingLeft: `${depth * 24 + 8}px` }}>
          <div className="tareas-task-title-wrap">
            {depth > 0 ? (
              <span className="tareas-subtask-indent">
                <CornerDownRight size={11} />
              </span>
            ) : null}
            <a className="tareas-task-link" href="#" onClick={(event) => event.preventDefault()} title={task.title}>
              {task.title}
            </a>
          </div>
        </td>

        <td>
          <span className={`tareas-estado tareas-estado-${toClassName(task.state)}`}>{task.state}</span>
        </td>

        <td>
          <span className="tareas-equipo-badge">{task.group || 'Sin grupo'}</span>
        </td>

        <td>
          <span className={`tareas-prioridad tareas-prioridad-${toClassName(task.priority || 'Media')}`}>{task.priority || 'Media'}</span>
        </td>

        <td className="tareas-cell-num">{formatHours(task.dedicatedHours)}</td>
        <td className="tareas-cell-num">{formatHours(task.estimatedHours)}</td>
        <td>{formatDateTime(task.startDate)}</td>
        <td>{formatDateTime(task.endDate)}</td>

        <td className="tareas-cell-pct">
          <span className="tareas-pct-text">{Math.max(0, progressPercent)} %</span>
          <span className={`tareas-pct-dot${progressPercent >= 100 ? ' full' : progressPercent > 0 ? ' partial' : ''}`} />
        </td>

        <td className="tareas-cell-actions">
          <div className="tareas-status-actions">
            <NotiaButton
              className="tareas-status-action-btn is-finish"
              onClick={() => {
                void onChangeTaskState(task, 'Pendiente')
              }}
            >
              Recuperar
            </NotiaButton>
            <NotiaButton
              className="tareas-status-action-btn is-dismiss"
              onClick={() => {
                void onDeleteTask(task)
              }}
            >
              Eliminar
            </NotiaButton>
          </div>
        </td>
      </tr>,
    ]

    if (!hasChildren || !isExpanded) {
      return rows
    }

    for (const child of children) {
      rows.push(...renderRows(child, depth + 1))
    }

    return rows
  }

  return (
    <div className="tareas-table-wrap">
      <div className="tareas-empty" style={{ padding: '0 0 8px 0' }}>{title}</div>
      <table className="tareas-table">
        <thead>
          <tr>
            <th />
            <th />
            <th>Tarea</th>
            <th>Estado</th>
            <th>Grupo</th>
            <th>Prioridad</th>
            <th className="tareas-th-num">Dedicado</th>
            <th className="tareas-th-num">Estimación</th>
            <th>Inicio</th>
            <th>Fin</th>
            <th className="tareas-th-num">%</th>
            <th>Acciones</th>
          </tr>
        </thead>

        <tbody>
          {topLevelTasks.length === 0 ? (
            <tr>
              <td className="tareas-empty" colSpan={12}>No hay tareas en esta sección.</td>
            </tr>
          ) : null}

          {topLevelTasks.map((task) => renderRows(task, 0))}
        </tbody>
      </table>
    </div>
  )
}

function resolveChildren(task: TaskItem, childrenByParent: Map<string, TaskItem[]>, taskMap: Map<string, TaskItem>): TaskItem[] {
  const directByTitle = childrenByParent.get(task.title.toLowerCase()) ?? []
  const directByFile = childrenByParent.get(task.fileName.toLowerCase()) ?? []
  const merged = [...directByTitle, ...directByFile]

  const seen = new Set<string>()
  const unique: TaskItem[] = []
  for (const child of merged) {
    if (seen.has(child.filePath)) {
      continue
    }

    const resolvedParent = taskMap.get(child.parentTaskName.toLowerCase())
    if (resolvedParent && resolvedParent.filePath !== task.filePath) {
      continue
    }

    seen.add(child.filePath)
    unique.push(child)
  }

  unique.sort((left, right) => left.order - right.order)
  return unique
}

function toClassName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-')
}

function formatHours(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

function formatDateTime(value: string): string {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return '-'
  }

  const parsed = new Date(trimmedValue)
  if (Number.isNaN(parsed.getTime())) {
    return '-'
  }

  return parsed.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(',', '')
}
