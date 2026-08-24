import type { Board, Group, TaskFormData, TaskItem, TaskPriority, TaskState } from '../types/taskManagerTypes'
import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'
import { loadTaskManagerSettings, saveTaskManagerSettings } from './taskManagerStorage'
import {
  createTask,
  loadTaskManagerSnapshot,
  moveTaskByState,
  syncTaskIndexesAndMetadata,
  updateTaskBody,
  updateTaskFrontmatter,
} from './taskManagerService'
import { dispatchTaskManagerMutation } from './taskManagerMutationEvents'
import { flushPendingTaskManagerLibraryTreeChanges } from './vaultRuntime'

export type TaskManagerAgentMutation =
  | { kind: 'create'; board: string; title: string; content: string; group: string; priority: TaskPriority; state: TaskState }
  | { kind: 'replace-content'; taskPath: string; content: string }
  | { kind: 'add-comment'; taskPath: string; comment: string }
  | { kind: 'add-subtask'; taskPath: string; title: string; content: string; priority?: TaskPriority }
  | { kind: 'move-group'; taskPath: string; group: string }
  | { kind: 'change-state'; taskPath: string; state: TaskState }
  | { kind: 'change-priority'; taskPath: string; priority: TaskPriority }
  | { kind: 'create-group'; board: string; name: string; color: string }
  | { kind: 'delete-group'; board: string; name: string }

const MAX_TASK_TEXT_CHARS = 30_000

export function resolveTaskManagerAgentGroups(groups: Group[], board: string | null): string[] {
  if (!board) {
    return []
  }
  return groups
    .filter((group) => (group.board ?? 'default') === board)
    .map((group) => group.name)
    .sort((left, right) => left.localeCompare(right, 'es'))
}

export async function getTaskManagerAgentOptions(_vaultPath: string, board: string | null): Promise<{
  activeBoard: string | null
  groups: string[]
  states: TaskState[]
  priorities: TaskPriority[]
}> {
  const settings = loadTaskManagerSettings()
  return {
    activeBoard: board,
    groups: resolveTaskManagerAgentGroups(settings.groups, board),
    states: ['Pendiente', 'Cancelada', 'En progreso', 'Finalizada', 'Bloqueada'],
    priorities: ['Baja', 'Media', 'Alta', 'Urgente'],
  }
}

function requireText(value: string, label: string, maxLength = MAX_TASK_TEXT_CHARS): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} es obligatorio.`)
  }
  if (normalized.length > maxLength) {
    throw new Error(`${label} supera el limite de ${maxLength} caracteres.`)
  }
  return normalized
}

function optionalText(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized.length > MAX_TASK_TEXT_CHARS) {
    throw new Error(`${label} supera el limite de ${MAX_TASK_TEXT_CHARS} caracteres.`)
  }
  return normalized
}

function requireGroupColor(value: string): string {
  const normalizedColor = value.trim()
  if (!/^#[0-9a-f]{6}$/i.test(normalizedColor)) {
    throw new Error('El color del grupo debe tener formato hexadecimal #RRGGBB.')
  }
  return normalizedColor.toLowerCase()
}

function requireBoard(board: string): string {
  const normalizedBoard = board.trim()
  const settings = loadTaskManagerSettings()
  if (!normalizedBoard || !settings.boards.some((candidate) => candidate.name === normalizedBoard)) {
    throw new Error(`El tablero "${normalizedBoard}" no existe.`)
  }
  return normalizedBoard
}

function findTask(tasks: TaskItem[], taskPath: string): TaskItem {
  const normalizedPath = normalizeFilesystemPath(taskPath).toLowerCase()
  const task = tasks.find((candidate) => {
    const candidatePath = normalizeFilesystemPath(candidate.filePath).toLowerCase()
    return candidatePath === normalizedPath || normalizedPath.endsWith(`/${candidatePath}`)
  })
  if (!task) {
    throw new Error('El ticket ya no existe o no pertenece al panel activo.')
  }
  return task
}

function resolveBoards(tasks: TaskItem[], requestedBoard?: string): Board[] {
  const settings = loadTaskManagerSettings()
  const boardNames = new Set([
    ...settings.boards.map((board) => board.name),
    ...tasks.map((task) => task.board),
    ...(requestedBoard ? [requestedBoard] : []),
  ].filter(Boolean))
  return [...boardNames].map((name) => (
    settings.boards.find((board) => board.name === name)
    ?? { name, color: '#2e6db0', activityHoursPerDay: 24 }
  ))
}

function validateGroup(board: string, group: string): string {
  const normalizedGroup = group.trim()
  const settings = loadTaskManagerSettings()
  const knownGroups = new Set(resolveTaskManagerAgentGroups(settings.groups, board))
  if (normalizedGroup && !knownGroups.has(normalizedGroup)) {
    throw new Error(`El grupo "${normalizedGroup}" no existe en el tablero "${board}".`)
  }
  return normalizedGroup
}

function replaceMarkdownBody(content: string, nextBody: string): string {
  const frontmatter = content.match(/^---\s*\r?\n[\s\S]*?\r?\n---/)?.[0]
  if (!frontmatter) {
    throw new Error('El ticket no tiene un frontmatter valido.')
  }
  return `${frontmatter}\n\n${nextBody.trim()}\n`
}

function appendComment(content: string, comment: string): string {
  const timestamp = new Date().toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(',', '')
  return `${content.trimEnd()}\n\n## Comentario - ${timestamp}\n${comment}\n`
}

export async function executeTaskManagerAgentMutation(
  vaultPath: string,
  mutation: TaskManagerAgentMutation,
): Promise<void> {
  const snapshot = await loadTaskManagerSnapshot(vaultPath)
  let affectedBoard: string | undefined

  if (mutation.kind === 'create-group') {
    const board = requireBoard(mutation.board)
    const name = requireText(mutation.name, 'El nombre del grupo', 120)
    const color = requireGroupColor(mutation.color)
    const settings = loadTaskManagerSettings()
    if (settings.groups.some((group) => group.name === name && (group.board ?? 'default') === board)) {
      throw new Error(`Ya existe un grupo llamado "${name}" en el tablero "${board}".`)
    }
    saveTaskManagerSettings({ ...settings, groups: [...settings.groups, { name, color, board }] })
    affectedBoard = board
  } else if (mutation.kind === 'delete-group') {
    const board = requireBoard(mutation.board)
    const name = requireText(mutation.name, 'El nombre del grupo', 120)
    const settings = loadTaskManagerSettings()
    if (!settings.groups.some((group) => group.name === name && (group.board ?? 'default') === board)) {
      throw new Error(`El grupo "${name}" no existe en el tablero "${board}".`)
    }
    const assignedTickets = snapshot.tasks.filter((task) => task.board === board && task.group === name)
    if (assignedTickets.length > 0) {
      throw new Error(`No se puede eliminar el grupo "${name}": tiene ${assignedTickets.length} ticket(s) asignado(s).`)
    }
    saveTaskManagerSettings({
      ...settings,
      groups: settings.groups.filter((group) => !(group.name === name && (group.board ?? 'default') === board)),
    })
    affectedBoard = board
  } else if (mutation.kind === 'create') {
    const title = requireText(mutation.title, 'El titulo', 180)
    const content = optionalText(mutation.content, 'El contenido')
    const group = validateGroup(mutation.board, mutation.group)
    const formData: TaskFormData = {
      title,
      detail: '',
      state: mutation.state,
      endDate: '',
      dynamicEndDate: false,
      board: mutation.board,
      group,
      priority: mutation.priority,
      estimatedHours: 0,
      parentTaskName: '',
    }
    const createdTaskPath = await createTask(vaultPath, formData, snapshot.tasks)
    if (content) {
      await updateTaskBody(vaultPath, createdTaskPath, (current) => (
        replaceMarkdownBody(current, content)
      ))
    }
    affectedBoard = mutation.board
  } else {
    const task = findTask(snapshot.tasks, mutation.taskPath)
    affectedBoard = task.board
    if (mutation.kind === 'replace-content') {
      const content = requireText(mutation.content, 'El contenido')
      await updateTaskBody(vaultPath, task.filePath, (current) => replaceMarkdownBody(current, content))
    } else if (mutation.kind === 'add-comment') {
      const comment = requireText(mutation.comment, 'El comentario', 10_000)
      await updateTaskBody(vaultPath, task.filePath, (current) => appendComment(current, comment))
    } else if (mutation.kind === 'add-subtask') {
      const title = requireText(mutation.title, 'El titulo', 180)
      const content = optionalText(mutation.content, 'El contenido')
      const formData: TaskFormData = {
        title,
        detail: '',
        state: 'Pendiente',
        endDate: '',
        dynamicEndDate: false,
        board: task.board,
        group: task.group,
        priority: mutation.priority ?? (task.priority || 'Media'),
        estimatedHours: 0,
        parentTaskName: task.title,
      }
      const createdTaskPath = await createTask(vaultPath, formData, snapshot.tasks)
      if (content) {
        await updateTaskBody(vaultPath, createdTaskPath, (current) => (
          replaceMarkdownBody(current, content)
        ))
      }
    } else if (mutation.kind === 'move-group') {
      await updateTaskFrontmatter(vaultPath, task.filePath, {
        equipo: validateGroup(task.board, mutation.group),
      })
    } else if (mutation.kind === 'change-state') {
      await moveTaskByState(vaultPath, task, mutation.state, new Set(snapshot.tasks.map((item) => item.filePath)))
    } else {
      await updateTaskFrontmatter(vaultPath, task.filePath, { prioridad: mutation.priority })
    }
  }

  const refreshedSnapshot = await loadTaskManagerSnapshot(vaultPath)
  const boards = resolveBoards(refreshedSnapshot.tasks, affectedBoard)
  await syncTaskIndexesAndMetadata(vaultPath, boards.map((board) => board.name), boards)
  flushPendingTaskManagerLibraryTreeChanges()
  dispatchTaskManagerMutation(vaultPath)
}
