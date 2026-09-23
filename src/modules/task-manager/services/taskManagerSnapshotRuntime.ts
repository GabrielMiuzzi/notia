import { invoke } from '@tauri-apps/api/core'
import type { TaskItem } from '../types/taskManagerTypes'

export const TASK_MANAGER_SNAPSHOT_READ_VERSION = 1
export const MAX_TASK_MANAGER_SNAPSHOT_BYTES = 8 * 1024 * 1024
const MAX_TASK_MANAGER_SNAPSHOT_ROUTES = 4_000
const MAX_TASK_MANAGER_SNAPSHOT_REVISIONS = 2_768
const MAX_TASK_MANAGER_BOARDS = 64
const MAX_TASK_MANAGER_GROUPS = 512
const MAX_TASK_MANAGER_TICKETS = 2_000
const MAX_TASK_MANAGER_COMMENTS = 100
const MAX_TASK_RELATED_REFERENCES = 20
const MAX_TASK_REFERENCE_CHARS = 512
const MAX_TASK_DATE_CHARS = 64
const MAX_TASK_HOURS = 1_000_000
const MAX_TASK_ORDER = 1_000_000_000
const MAX_SERIALIZED_U64 = Number('18446744073709551615')
const MIN_SERIALIZED_I64 = Number('-9223372036854775808')
const MAX_SERIALIZED_I64 = Number('9223372036854775807')

export interface TaskManagerSnapshotContext {
  libraryId: string
  libraryUserId: string
  activeBoardId?: string | null
  allowedBoardIds?: string[]
}

export interface TaskManagerSnapshotBoard {
  libraryId: string
  boardId: string
  name: string
  color: string
  context?: string
  revision: number
}

export interface TaskManagerSnapshotGroup {
  libraryId: string
  groupId: string
  boardId: string
  name: string
  color: string
  revision: number
}

export interface TaskManagerSnapshotTicketSummary {
  libraryId: string
  ticketId: string
  boardId: string
  groupId?: string | null
  title: string
  state: string
  priority: string
  parentTicketId?: string | null
  detailPreview: string
  revision: number
  logicalPath: string
}

export interface TaskManagerSnapshotTicket {
  summary: TaskManagerSnapshotTicketSummary
  content: string
  tags: string[]
  dependencies: string[]
  checklist: string[]
  startDate?: string
  endDate?: string
  dynamicEndDate?: boolean
  dedicatedHours?: number
  estimatedHours?: number
  deviationHours?: number
  order?: number
  context?: string | null
  relatedDocuments?: string[]
  relatedTasks?: string[]
}

export interface TaskManagerSnapshotComment {
  libraryId: string
  commentId: string
  ticketId: string
  authorUserId: string
  body: string
  createdAtUnixMs: number
  revision: number
  logicalPath: string
}

export interface TaskManagerLibrarySnapshotDto {
  libraryId: string
  users: string[]
  boards: TaskManagerSnapshotBoard[]
  groups: TaskManagerSnapshotGroup[]
  tickets: TaskManagerSnapshotTicket[]
  comments: TaskManagerSnapshotComment[]
  generation: number
  config: {
    activityHoursPerDay: Record<string, number>
  }
}

export interface TaskManagerSnapshotRoute {
  entityType: string
  entityId: string
  logicalPath: string
}

export interface TaskManagerSnapshotRevision {
  entityType: string
  entityId: string
  revision: number
}

export interface TaskManagerSnapshotReadDto {
  version: number
  context: TaskManagerSnapshotContext
  snapshot: TaskManagerLibrarySnapshotDto
  routes: TaskManagerSnapshotRoute[]
  revisions: TaskManagerSnapshotRevision[]
}

export interface TaskManagerSnapshotErrorShape {
  code: string
  message: string
  retryable: boolean
  operationId?: string
}

export class TaskManagerSnapshotError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly operationId?: string

  constructor(error: TaskManagerSnapshotErrorShape) {
    super(error.message)
    this.name = 'TaskManagerSnapshotError'
    this.code = error.code
    this.retryable = error.retryable
    this.operationId = error.operationId
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string' && Array.from(value).length <= maxLength
}

function isCounter(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    && value <= MAX_SERIALIZED_U64
}

function isSignedInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= MIN_SERIALIZED_I64
    && value <= MAX_SERIALIZED_I64
}

function isBoundedNumber(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
}

function isStringArray(value: unknown, maxItems = 20, maxLength = 30_000): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => isBoundedString(item, maxLength))
}

function isContext(value: unknown): value is TaskManagerSnapshotContext {
  if (!isRecord(value) || !isBoundedString(value.libraryId, 128) || !isBoundedString(value.libraryUserId, 128)) {
    return false
  }
  return (value.activeBoardId === undefined || value.activeBoardId === null || isBoundedString(value.activeBoardId, 128))
    && (value.allowedBoardIds === undefined || isStringArray(value.allowedBoardIds, MAX_TASK_MANAGER_BOARDS))
}

function isSnapshotBoard(board: unknown): board is TaskManagerSnapshotBoard {
  return isRecord(board)
    && isBoundedString(board.libraryId, 128)
    && isBoundedString(board.boardId, 128)
    && isBoundedString(board.name, 120)
    && isBoundedString(board.color, 32)
    && (board.context === undefined || board.context === null || isBoundedString(board.context, 128))
    && isCounter(board.revision)
}

function isSnapshotGroup(group: unknown): group is TaskManagerSnapshotGroup {
  return isRecord(group)
    && isBoundedString(group.libraryId, 128)
    && isBoundedString(group.groupId, 128)
    && isBoundedString(group.boardId, 128)
    && isBoundedString(group.name, 120)
    && isBoundedString(group.color, 32)
    && isCounter(group.revision)
}

function isSnapshotTicket(ticket: unknown): ticket is TaskManagerSnapshotTicket {
  return isRecord(ticket)
    && isRecord(ticket.summary)
    && isBoundedString(ticket.summary.libraryId, 128)
    && isBoundedString(ticket.summary.ticketId, 128)
    && isBoundedString(ticket.summary.boardId, 128)
    && (ticket.summary.groupId === undefined || ticket.summary.groupId === null || isBoundedString(ticket.summary.groupId, 128))
    && isBoundedString(ticket.summary.title, 180)
    && isBoundedString(ticket.summary.state, 64)
    && isBoundedString(ticket.summary.priority, 64)
    && (ticket.summary.parentTicketId === undefined || ticket.summary.parentTicketId === null || isBoundedString(ticket.summary.parentTicketId, 128))
    && isBoundedString(ticket.summary.detailPreview, 180)
    && isCounter(ticket.summary.revision)
    && isBoundedString(ticket.summary.logicalPath, 512)
    && isBoundedString(ticket.content, 30_000)
    && isStringArray(ticket.tags)
    && isStringArray(ticket.dependencies)
    && isStringArray(ticket.checklist)
    && (ticket.startDate === undefined || isBoundedString(ticket.startDate, MAX_TASK_DATE_CHARS))
    && (ticket.endDate === undefined || isBoundedString(ticket.endDate, MAX_TASK_DATE_CHARS))
    && (ticket.dynamicEndDate === undefined || typeof ticket.dynamicEndDate === 'boolean')
    && (ticket.dedicatedHours === undefined || isBoundedNumber(ticket.dedicatedHours, MAX_TASK_HOURS))
    && (ticket.estimatedHours === undefined || isBoundedNumber(ticket.estimatedHours, MAX_TASK_HOURS))
    && (ticket.deviationHours === undefined || isBoundedNumber(ticket.deviationHours, MAX_TASK_HOURS))
    && (ticket.order === undefined || isBoundedNumber(ticket.order, MAX_TASK_ORDER))
    && (ticket.context === undefined || ticket.context === null || isBoundedString(ticket.context, 128))
    && (ticket.relatedDocuments === undefined || isStringArray(ticket.relatedDocuments, MAX_TASK_RELATED_REFERENCES, MAX_TASK_REFERENCE_CHARS))
    && (ticket.relatedTasks === undefined || isStringArray(ticket.relatedTasks, MAX_TASK_RELATED_REFERENCES, MAX_TASK_REFERENCE_CHARS))
}

function isSnapshotComment(comment: unknown): comment is TaskManagerSnapshotComment {
  return isRecord(comment)
    && isBoundedString(comment.libraryId, 128)
    && isBoundedString(comment.commentId, 128)
    && isBoundedString(comment.ticketId, 128)
    && isBoundedString(comment.authorUserId, 128)
    && isBoundedString(comment.body, 30_000)
    && isSignedInteger(comment.createdAtUnixMs)
    && isCounter(comment.revision)
    && isBoundedString(comment.logicalPath, 512)
}

function snapshotTicketValidationIssue(ticket: unknown): string {
  if (!isRecord(ticket)) return 'estructura'
  if (!isRecord(ticket.summary)) return 'summary'
  for (const [field, limit] of [
    ['libraryId', 128], ['ticketId', 128], ['boardId', 128], ['title', 180],
    ['state', 64], ['priority', 64], ['detailPreview', 180], ['logicalPath', 512],
  ] as const) {
    if (!isBoundedString(ticket.summary[field], limit)) return `summary.${field}`
  }
  if (ticket.summary.groupId !== undefined && ticket.summary.groupId !== null && !isBoundedString(ticket.summary.groupId, 128)) return 'summary.groupId'
  if (ticket.summary.parentTicketId !== undefined && ticket.summary.parentTicketId !== null && !isBoundedString(ticket.summary.parentTicketId, 128)) return 'summary.parentTicketId'
  if (!isCounter(ticket.summary.revision)) return 'summary.revision'
  if (!isBoundedString(ticket.content, 30_000)) return 'content'
  if (!isStringArray(ticket.tags)) return 'tags'
  if (!isStringArray(ticket.dependencies)) return 'dependencies'
  if (!isStringArray(ticket.checklist)) return 'checklist'
  if (ticket.startDate !== undefined && !isBoundedString(ticket.startDate, MAX_TASK_DATE_CHARS)) return 'startDate'
  if (ticket.endDate !== undefined && !isBoundedString(ticket.endDate, MAX_TASK_DATE_CHARS)) return 'endDate'
  if (ticket.dynamicEndDate !== undefined && typeof ticket.dynamicEndDate !== 'boolean') return 'dynamicEndDate'
  if (ticket.dedicatedHours !== undefined && !isBoundedNumber(ticket.dedicatedHours, MAX_TASK_HOURS)) return 'dedicatedHours'
  if (ticket.estimatedHours !== undefined && !isBoundedNumber(ticket.estimatedHours, MAX_TASK_HOURS)) return 'estimatedHours'
  if (ticket.deviationHours !== undefined && !isBoundedNumber(ticket.deviationHours, MAX_TASK_HOURS)) return 'deviationHours'
  if (ticket.order !== undefined && !isBoundedNumber(ticket.order, MAX_TASK_ORDER)) return 'order'
  if (ticket.context !== undefined && ticket.context !== null && !isBoundedString(ticket.context, 128)) return 'context'
  if (ticket.relatedDocuments !== undefined && !isStringArray(ticket.relatedDocuments, MAX_TASK_RELATED_REFERENCES, MAX_TASK_REFERENCE_CHARS)) return 'relatedDocuments'
  if (ticket.relatedTasks !== undefined && !isStringArray(ticket.relatedTasks, MAX_TASK_RELATED_REFERENCES, MAX_TASK_REFERENCE_CHARS)) return 'relatedTasks'
  return 'estructura'
}

function isSnapshot(value: unknown): value is TaskManagerLibrarySnapshotDto {
  if (!isRecord(value)
    || !isBoundedString(value.libraryId, 128)
    || !isStringArray(value.users, 256)
    || !Array.isArray(value.boards)
    || value.boards.length > MAX_TASK_MANAGER_BOARDS
    || !Array.isArray(value.groups)
    || value.groups.length > MAX_TASK_MANAGER_GROUPS
    || !Array.isArray(value.tickets)
    || value.tickets.length > MAX_TASK_MANAGER_TICKETS
    || !Array.isArray(value.comments)
    || value.comments.length > MAX_TASK_MANAGER_COMMENTS
    || !isCounter(value.generation)
    || !isRecord(value.config)
    || !isRecord(value.config.activityHoursPerDay)) {
    return false
  }

  return value.boards.every(isSnapshotBoard)
    && value.groups.every(isSnapshotGroup)
    && value.tickets.every(isSnapshotTicket)
    && value.comments.every(isSnapshotComment)
    && Object.values(value.config.activityHoursPerDay).every((hours) => typeof hours === 'number' && Number.isFinite(hours) && hours >= 0 && hours <= 24)
}

function snapshotValidationIssue(value: unknown): string {
  if (!isRecord(value)) return 'snapshot ausente'
  if (!isBoundedString(value.libraryId, 128)) return 'libraryId inválido'
  if (!isStringArray(value.users, 256)) return 'usuarios inválidos'
  if (!Array.isArray(value.boards) || value.boards.length > MAX_TASK_MANAGER_BOARDS) return 'boards inválidos'
  const invalidBoard = value.boards.findIndex((board) => !isSnapshotBoard(board))
  if (invalidBoard >= 0) return `boards[${invalidBoard}] inválido`
  if (!Array.isArray(value.groups) || value.groups.length > MAX_TASK_MANAGER_GROUPS) return 'groups inválidos'
  const invalidGroup = value.groups.findIndex((group) => !isSnapshotGroup(group))
  if (invalidGroup >= 0) return `groups[${invalidGroup}] inválido`
  if (!Array.isArray(value.tickets) || value.tickets.length > MAX_TASK_MANAGER_TICKETS) return 'tickets inválidos'
  const invalidTicket = value.tickets.findIndex((ticket) => !isSnapshotTicket(ticket))
  if (invalidTicket >= 0) return `tickets[${invalidTicket}].${snapshotTicketValidationIssue(value.tickets[invalidTicket])} inválido`
  if (!Array.isArray(value.comments) || value.comments.length > MAX_TASK_MANAGER_COMMENTS) return 'comments inválidos'
  const invalidComment = value.comments.findIndex((comment) => !isSnapshotComment(comment))
  if (invalidComment >= 0) return `comments[${invalidComment}] inválido`
  if (!isCounter(value.generation)) return 'generation inválida'
  if (!isRecord(value.config) || !isRecord(value.config.activityHoursPerDay)) return 'config inválida'
  if (!Object.values(value.config.activityHoursPerDay).every((hours) => typeof hours === 'number' && Number.isFinite(hours) && hours >= 0 && hours <= 24)) return 'activityHoursPerDay inválido'
  return 'snapshot incompatible'
}

function isSnapshotReadDto(value: unknown): value is TaskManagerSnapshotReadDto {
  return isRecord(value)
    && value.version === TASK_MANAGER_SNAPSHOT_READ_VERSION
    && isContext(value.context)
    && isSnapshot(value.snapshot)
    && value.snapshot.libraryId === value.context.libraryId
    && Array.isArray(value.routes)
    && value.routes.length <= MAX_TASK_MANAGER_SNAPSHOT_ROUTES
    && value.routes.every((route) => isRecord(route)
      && isBoundedString(route.entityType, 32)
      && isBoundedString(route.entityId, 128)
      && isBoundedString(route.logicalPath, 512))
    && Array.isArray(value.revisions)
    && value.revisions.length <= MAX_TASK_MANAGER_SNAPSHOT_REVISIONS
    && value.revisions.every((revision) => isRecord(revision)
      && isBoundedString(revision.entityType, 32)
      && isBoundedString(revision.entityId, 128)
      && isCounter(revision.revision))
}

function snapshotReadValidationIssue(value: unknown): string {
  if (!isRecord(value)) return 'respuesta ausente'
  if (value.version !== TASK_MANAGER_SNAPSHOT_READ_VERSION) return 'versión incompatible'
  if (!isContext(value.context)) return 'contexto inválido'
  if (!isSnapshot(value.snapshot)) return snapshotValidationIssue(value.snapshot)
  if (value.snapshot.libraryId !== value.context.libraryId) return 'biblioteca inconsistente'
  if (!Array.isArray(value.routes) || value.routes.length > MAX_TASK_MANAGER_SNAPSHOT_ROUTES) return 'rutas inválidas'
  const invalidRoute = value.routes.findIndex((route) => !(isRecord(route)
    && isBoundedString(route.entityType, 32)
    && isBoundedString(route.entityId, 128)
    && isBoundedString(route.logicalPath, 512)))
  if (invalidRoute >= 0) return `routes[${invalidRoute}] inválida`
  if (!Array.isArray(value.revisions) || value.revisions.length > MAX_TASK_MANAGER_SNAPSHOT_REVISIONS) return 'revisiones inválidas'
  const invalidRevision = value.revisions.findIndex((revision) => !(isRecord(revision)
    && isBoundedString(revision.entityType, 32)
    && isBoundedString(revision.entityId, 128)
    && isCounter(revision.revision)))
  if (invalidRevision >= 0) return `revisions[${invalidRevision}] inválida`
  return 'contrato incompatible'
}

export function parseTaskManagerSnapshotReadDto(value: unknown): TaskManagerSnapshotReadDto {
  if (!isSnapshotReadDto(value)) {
    throw new TaskManagerSnapshotError({
      code: 'invalid-response',
      message: `La respuesta de Task Manager no tiene un formato válido (${snapshotReadValidationIssue(value)}).`,
      retryable: false,
    })
  }

  try {
    if (JSON.stringify(value).length > MAX_TASK_MANAGER_SNAPSHOT_BYTES) {
      throw new Error('oversized')
    }
  } catch {
    throw new TaskManagerSnapshotError({
      code: 'invalid-response',
      message: 'La respuesta de Task Manager supera el tamaño permitido.',
      retryable: false,
    })
  }

  return value
}

export function mapTaskManagerSnapshotTickets(
  value: TaskManagerSnapshotReadDto | TaskManagerLibrarySnapshotDto,
): TaskItem[] {
  const snapshot = 'snapshot' in value ? value.snapshot : value
  // The UI identifies boards and groups by display name and parents by file
  // name, as the Markdown frontmatter does; ids are backend identities.
  const boardNamesById = new Map(snapshot.boards.map((board) => [board.boardId, board.name]))
  const groupNamesById = new Map(snapshot.groups.map((group) => [group.groupId, group.name]))
  const fileNamesById = new Map(snapshot.tickets.map((ticket) => [
    ticket.summary.ticketId,
    ticket.summary.logicalPath.split('/').pop()?.replace(/\.md$/i, '') ?? '',
  ]))

  return snapshot.tickets.map((ticket) => {
    const logicalPath = ticket.summary.logicalPath
    const fileName = logicalPath.split('/').pop()?.replace(/\.md$/i, '') ?? ''
    const parentFileName = ticket.summary.parentTicketId
      ? fileNamesById.get(ticket.summary.parentTicketId) ?? ''
      : ''
    const item: TaskItem = {
      id: ticket.summary.ticketId,
      filePath: logicalPath,
      fileName,
      title: ticket.summary.title,
      detail: ticket.content,
      state: ticket.summary.state as TaskItem['state'],
      startDate: ticket.startDate ?? '',
      endDate: ticket.endDate ?? '',
      dynamicEndDate: ticket.dynamicEndDate ?? true,
      board: boardNamesById.get(ticket.summary.boardId) ?? ticket.summary.boardId,
      group: ticket.summary.groupId
        ? groupNamesById.get(ticket.summary.groupId) ?? ticket.summary.groupId
        : '',
      priority: ticket.summary.priority as TaskItem['priority'],
      dedicatedHours: ticket.dedicatedHours ?? 0,
      estimatedHours: ticket.estimatedHours ?? 0,
      deviationHours: ticket.deviationHours ?? 0,
      parentTaskName: parentFileName,
      order: ticket.order ?? 999_999,
      preview: ticket.summary.detailPreview,
    }
    if (ticket.context !== undefined && ticket.context !== null) {
      item.contexto = ticket.context
    }
    if (ticket.relatedDocuments !== undefined) {
      item.relatedDocuments = [...ticket.relatedDocuments]
    }
    if (ticket.relatedTasks !== undefined) {
      item.relatedTasks = [...ticket.relatedTasks]
    }
    return item
  })
}

export function parseTaskManagerSnapshotError(error: unknown): TaskManagerSnapshotError {
  let value: unknown = error
  if (typeof error === 'string') {
    try {
      value = JSON.parse(error) as unknown
    } catch {
      value = undefined
    }
  }
  if (isRecord(value)
    && typeof value.code === 'string'
    && typeof value.message === 'string'
    && typeof value.retryable === 'boolean') {
    return new TaskManagerSnapshotError({
      code: value.code,
      message: value.message,
      retryable: value.retryable,
      operationId: typeof value.operationId === 'string' ? value.operationId : undefined,
    })
  }
  return new TaskManagerSnapshotError({
    code: 'unknown',
    message: error instanceof Error ? error.message : 'No se pudo leer el snapshot de Task Manager.',
    retryable: false,
  })
}

export async function readTaskManagerSnapshot(
  context: TaskManagerSnapshotContext,
): Promise<TaskManagerSnapshotReadDto> {
  try {
    return parseTaskManagerSnapshotReadDto(await invoke<unknown>('task_manager_snapshot', {
      payload: context,
    }))
  } catch (error) {
    if (error instanceof TaskManagerSnapshotError) {
      throw error
    }
    throw parseTaskManagerSnapshotError(error)
  }
}
