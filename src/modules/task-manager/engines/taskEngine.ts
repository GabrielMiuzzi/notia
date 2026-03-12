import {
  CHAT_FOLDER,
  CANCELLED_SUBTASKS_FOLDER,
  CANCELLED_TASK_INDEX_BASENAME,
  CANCELLED_TASKS_FOLDER,
  DEFAULT_BOARD_NAME,
  FINISHED_TASKS_FOLDER,
  FINISHED_SUBTASKS_FOLDER,
  FINISHED_TASK_INDEX_BASENAME,
  LEGACY_FINISHED_TASKS_FOLDER,
  ORDER_STEP,
  POMODORO_LOG_BASENAME,
  SUBTASK_TAG,
  TASK_INDEX_BASENAME,
  TASK_TAG,
  TASKS_ROOT_FOLDER,
} from '../constants/taskManagerConstants'
import type { Group, MarkdownFileDocument, TaskFormData, TaskFrontmatter, TaskItem } from '../types/taskManagerTypes'
import { parseMarkdownFrontmatter } from './frontmatterEngine'
import { normalizeTaskState } from '../utils/status'

const BOARD_TASK_INDEX_SUFFIX = 'TaskIndex'

export function isTaskInFinishedFolder(path: string): boolean {
  return path.startsWith(`${FINISHED_TASKS_FOLDER}/`)
    || path.startsWith(`${FINISHED_SUBTASKS_FOLDER}/`)
    || path.startsWith(`${LEGACY_FINISHED_TASKS_FOLDER}/`)
}

export function isTaskInCancelledFolder(path: string): boolean {
  return path.startsWith(`${CANCELLED_TASKS_FOLDER}/`)
    || path.startsWith(`${CANCELLED_SUBTASKS_FOLDER}/`)
}

export function isTaskInCompletedFolder(path: string): boolean {
  return isTaskInFinishedFolder(path) || isTaskInCancelledFolder(path)
}

export function isTaskMarkdownFile(path: string): boolean {
  const basename = getBasenameWithoutExtension(path)

  if (!path.startsWith(`${TASKS_ROOT_FOLDER}/`) || !path.endsWith('.md')) {
    return false
  }

  if (path.startsWith(`${CHAT_FOLDER}/`) || path === `${TASKS_ROOT_FOLDER}/${POMODORO_LOG_BASENAME}.md`) {
    return false
  }

  if (
    basename === TASK_INDEX_BASENAME
    || basename === FINISHED_TASK_INDEX_BASENAME
    || basename === CANCELLED_TASK_INDEX_BASENAME
    || basename.toLowerCase().endsWith(BOARD_TASK_INDEX_SUFFIX.toLowerCase())
  ) {
    return false
  }

  return true
}

export function getTasks(documents: MarkdownFileDocument[]): TaskItem[] {
  const tasks: TaskItem[] = []

  for (const document of documents) {
    if (!isTaskMarkdownFile(document.path)) {
      continue
    }

    const parsed = parseMarkdownFrontmatter(document.content)
    const frontmatter = parsed.frontmatter
    if (!frontmatter || !isTaskFrontmatter(frontmatter)) {
      continue
    }

    const basename = getBasenameWithoutExtension(document.path)
    const state = normalizeTaskState(frontmatter.estado)

    tasks.push({
      filePath: document.path,
      fileName: basename,
      title: frontmatter.tarea?.trim() || basename,
      detail: frontmatter.detalle ?? '',
      state,
      startDate: frontmatter.fechaInicio ?? '',
      endDate: frontmatter.fechaFin ?? '',
      dynamicEndDate: resolveDynamicEndDateFlag(frontmatter.fechaFinDinamica),
      board: resolveTaskBoard(document.path, frontmatter),
      group: frontmatter.equipo ?? '',
      priority: (frontmatter.prioridad as TaskItem['priority']) ?? '',
      dedicatedHours: Number(frontmatter.dedicado) || 0,
      estimatedHours: Number(frontmatter.estimacion) || 0,
      deviationHours: Number(frontmatter.desvio) || 0,
      parentTaskName: normalizeParentTaskName(frontmatter.parent ?? ''),
      order: Number(frontmatter.order) || 999999,
      preview: extractTaskBodyPreview(document.content),
    })
  }

  return tasks
}

function isTaskFrontmatter(frontmatter: TaskFrontmatter): boolean {
  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags
    : typeof frontmatter.tags === 'string'
      ? [frontmatter.tags]
      : []

  const normalizedTags = tags.map((tag) => tag.replace(/^#/, '').trim().toLowerCase()).filter(Boolean)
  if (normalizedTags.includes(TASK_TAG) || normalizedTags.includes(SUBTASK_TAG)) {
    return true
  }

  return Boolean(frontmatter.tarea?.trim())
}

export function groupTopLevelTasks(tasks: TaskItem[], groups: Group[]): Record<string, TaskItem[]> {
  const groupedTasks: Record<string, TaskItem[]> = {}
  for (const group of groups) {
    groupedTasks[group.name] = []
  }

  for (const task of tasks) {
    if (task.parentTaskName) {
      continue
    }

    const groupName = task.group || 'Sin grupo'
    if (!groupedTasks[groupName]) {
      groupedTasks[groupName] = []
    }

    groupedTasks[groupName].push(task)
  }

  return groupedTasks
}

export function buildTaskContent(data: TaskFormData, order: number): string {
  const safeTitle = data.title.replace(/"/g, '\\"')
  const safeDetail = data.detail.replace(/"/g, '\\"')
  const safeEndDate = data.endDate.replace(/"/g, '\\"')
  const safeParentTaskName = data.parentTaskName.trim().replace(/"/g, '\\"')
  const parentLink = safeParentTaskName ? `[[${safeParentTaskName}]]` : ''
  const taskTag = safeParentTaskName ? SUBTASK_TAG : TASK_TAG

  return [
    '---',
    `tarea: "${safeTitle}"`,
    `detalle: "${safeDetail}"`,
    `estado: "${data.state}"`,
    'fechaInicio: ""',
    `fechaFin: "${safeEndDate}"`,
    `fechaFinDinamica: ${data.dynamicEndDate}`,
    `tablero: "${data.board}"`,
    `equipo: "${data.group}"`,
    `prioridad: "${data.priority}"`,
    'dedicado: 0',
    `estimacion: ${data.estimatedHours}`,
    'desvio: 0',
    `parent: "${parentLink}"`,
    'childs: []',
    `tags: [${taskTag}]`,
    `order: ${order}`,
    '---',
    '',
    data.detail || '',
    '',
  ].join('\n')
}

export function resolveNewTaskOrder(tasks: TaskItem[], data: TaskFormData): number {
  const goesToTop = data.state === 'En progreso' || data.priority === 'Urgente'

  if (data.parentTaskName.trim()) {
    return ORDER_STEP
  }

  const siblingOrders = tasks
    .filter((task) => !task.parentTaskName)
    .filter((task) => task.board === normalizeBoardName(data.board) && task.group === data.group)
    .map((task) => task.order)

  if (siblingOrders.length === 0) {
    return ORDER_STEP
  }

  return goesToTop ? Math.min(...siblingOrders) - ORDER_STEP : Math.max(...siblingOrders) + ORDER_STEP
}

export function resolveTaskPath(baseVaultPath: string, taskName: string, boardName: string, parentTaskName = ''): string {
  const normalizedTaskName = sanitizePathName(taskName)
  const folderPath = parentTaskName.trim() ? getBoardSubtasksFolder(boardName) : getBoardFolder(boardName)
  return `${baseVaultPath}/${folderPath}/${normalizedTaskName}.md`
}

export function getBoardFolder(boardName: string): string {
  return `${TASKS_ROOT_FOLDER}/${normalizeBoardName(boardName)}`
}

export function getBoardSubtasksFolder(boardName: string): string {
  return `${getBoardFolder(boardName)}/subTasks`
}

export function resolveTaskEndDate(endDate: string, estimatedHours: number): string {
  const explicitEndDate = parseTaskDate(endDate)
  if (explicitEndDate) {
    return explicitEndDate.toISOString()
  }

  if (estimatedHours <= 0) {
    return ''
  }

  return new Date(Date.now() + estimatedHours * 60 * 60 * 1000).toISOString()
}

export function parseTaskDate(value: string): Date | null {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return null
  }

  const parsed = new Date(trimmedValue)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function extractTaskBodyPreview(content: string, maxLength = 180): string {
  const bodyWithoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const lines = bodyWithoutFrontmatter
    .split(/\r?\n/)
    .map((line) => line.trim())

  while (lines.length > 0 && !lines[0]) {
    lines.shift()
  }

  if (lines[0]?.startsWith('# ')) {
    lines.shift()
  }

  while (lines.length > 0 && !lines[0]) {
    lines.shift()
  }

  const normalizedBody = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (!normalizedBody) {
    return ''
  }

  if (normalizedBody.length <= maxLength) {
    return normalizedBody
  }

  return `${normalizedBody.slice(0, maxLength - 1).trimEnd()}…`
}

function resolveTaskBoard(path: string, frontmatter: TaskFrontmatter): string {
  const fromFrontmatter = (frontmatter.tablero || '').trim().toLowerCase()
  if (fromFrontmatter) {
    return fromFrontmatter
  }

  const rootPrefix = `${TASKS_ROOT_FOLDER}/`
  if (!path.includes(rootPrefix)) {
    return DEFAULT_BOARD_NAME
  }

  const relativePath = path.slice(path.indexOf(rootPrefix) + rootPrefix.length)
  const boardCandidate = relativePath.split('/')[0]?.trim().toLowerCase() || ''
  if (!boardCandidate || boardCandidate === 'finished' || boardCandidate === 'cancelled' || boardCandidate === 'completadas') {
    return DEFAULT_BOARD_NAME
  }

  return boardCandidate
}

function resolveDynamicEndDateFlag(value: TaskFrontmatter['fechaFinDinamica']): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false
    }
  }

  return true
}

function normalizeParentTaskName(value: string): string {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return ''
  }

  const linkMatch = trimmedValue.match(/^\[\[(.+?)\]\]$/)
  const rawReference = linkMatch ? linkMatch[1].trim() : trimmedValue
  const withoutAlias = rawReference.split('|')[0].trim()
  const withoutHeading = withoutAlias.split('#')[0].trim()
  const lastSegment = withoutHeading.split('/').pop() ?? withoutHeading

  return lastSegment.replace(/\.md$/i, '').trim()
}

function normalizeBoardName(value: string): string {
  const normalized = value.trim().toLowerCase()
  return normalized || DEFAULT_BOARD_NAME
}

function getBasenameWithoutExtension(path: string): string {
  const fileName = path.split('/').pop() ?? path
  return fileName.replace(/\.md$/i, '')
}

function sanitizePathName(value: string): string {
  return value.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim()
}
