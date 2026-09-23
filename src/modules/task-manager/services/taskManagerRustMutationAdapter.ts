import { invoke } from '@tauri-apps/api/core'
import type { TaskPriority, TaskState } from '../types/taskManagerTypes'
import type { TaskManagerAgentMutation } from './taskManagerAgentMutationService'
import {
  readTaskManagerSnapshot,
  type TaskManagerLibrarySnapshotDto,
  type TaskManagerSnapshotReadDto,
  type TaskManagerSnapshotTicket,
} from './taskManagerSnapshotRuntime'

export interface TaskManagerRustMutationContext {
  libraryId: string
  libraryUserId: string
  allowedBoardNames?: readonly string[]
}

export interface TaskManagerMutationRequestDto {
  context: {
    libraryId: string
    libraryUserId: string
    activeBoardId?: string
    allowedBoardIds?: string[]
  }
  operationId: string
  idempotencyKey: string
  mutation: TaskMutationRequestMutation
}

export type TaskMutationRequestMutation =
  | { kind: 'create-board'; boardId: string; name: string; color: string; context: string | null }
  | { kind: 'update-board'; boardId: string; name: string | null; color: string | null; context: string | null }
  | { kind: 'delete-board'; boardId: string }
  | { kind: 'create-group'; boardId: string; groupId: string; name: string; color: string }
  | { kind: 'delete-group'; boardId: string; groupId: string }
  | { kind: 'update-group'; boardId: string; groupId: string; name: string; color: string }
  | { kind: 'reorder-groups'; boardId: string; groupIds: string[] }
  | { kind: 'create-ticket'; boardId: string; ticketId: string; groupId: string | null; title: string; content: string; state: TaskState; priority: TaskPriority; parentTicketId: string | null; tags: string[]; initialFields?: TaskUpdateFieldsRequest }
  | { kind: 'replace-ticket-content'; ticketId: string; content: string }
  | { kind: 'add-comment'; ticketId: string; commentId: string; body: string; createdAtUnixMs: number }
  | { kind: 'add-subtask'; parentTicketId: string; ticketId: string; title: string; content: string; priority: TaskPriority }
  | { kind: 'move-ticket'; ticketId: string; groupId: string | null }
  | { kind: 'change-state'; ticketId: string; state: TaskState }
  | { kind: 'change-priority'; ticketId: string; priority: TaskPriority }
  | { kind: 'update-ticket'; ticketId: string; fields: TaskUpdateFieldsRequest }
  | { kind: 'bulk-update'; ticketIds: string[]; fields: TaskUpdateFieldsRequest }
  | { kind: 'duplicate-ticket'; ticketId: string; newTicketId: string; title: string | null }
  | { kind: 'archive-ticket'; ticketId: string }
  | { kind: 'restore-ticket'; ticketId: string }
  | { kind: 'delete-ticket'; ticketId: string }

export interface TaskUpdateFieldsRequest {
  title?: string
  content?: string
  state?: TaskState
  priority?: TaskPriority
  groupId?: string | null
  tags?: string[]
  dependencies?: string[]
  checklist?: string[]
  startDate?: string
  endDate?: string
  dynamicEndDate?: boolean
  dedicatedHours?: number
  estimatedHours?: number
  deviationHours?: number
  order?: number
  context?: string
  parentTicketId?: string | null
}

export interface TaskMutationPreviewDto {
  libraryId: string
  libraryUserId: string
  operationId: string
  idempotencyKey: string
  mutation: TaskMutationRequestMutation
  allowedActions: string[]
}

export interface TaskMutationReceiptDto {
  libraryId: string
  libraryUserId: string
  operationId: string
  idempotencyKey: string
  changed: boolean
  affectedIds: string[]
  revisions: Array<{ entityType: string; entityId: string; revision: number }>
  replayed: boolean
}

export interface TaskManagerRustMutationAdapterOptions {
  operationId?: string
  idempotencyKey?: string
  now?: () => number
}

function createOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `task-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLocaleLowerCase()
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase('es')
}

function requireGeneratedId(operationId: string, kind: string, existing: Set<string>): string {
  const id = `${operationId}:${kind}`
  if (existing.has(id)) {
    throw new Error(`No se pudo generar un ID único para la mutación de Task Manager (${kind}).`)
  }
  return id
}

function snapshotFrom(value: TaskManagerSnapshotReadDto | TaskManagerLibrarySnapshotDto): TaskManagerLibrarySnapshotDto {
  return 'snapshot' in value ? value.snapshot : value
}

function routePathCandidates(snapshot: TaskManagerSnapshotReadDto, taskPath: string): string[] {
  const requested = normalizePath(taskPath)
  return snapshot.routes
    .filter((route) => route.entityType === 'ticket')
    .filter((route) => {
      const routePath = normalizePath(route.logicalPath)
      return routePath === requested || routePath.endsWith(`/${requested}`) || requested.endsWith(`/${routePath}`)
    })
    .map((route) => route.entityId)
}

function resolveTicket(snapshot: TaskManagerSnapshotReadDto, taskPath: string): TaskManagerSnapshotTicket {
  const library = snapshotFrom(snapshot)
  const routeIds = routePathCandidates(snapshot, taskPath)
  const path = normalizePath(taskPath)
  const ticketCandidates = library.tickets.filter((ticket) => {
    const ticketPath = normalizePath(ticket.summary.logicalPath)
    return ticketPath === path || ticketPath.endsWith(`/${path}`) || path.endsWith(`/${ticketPath}`)
  })
  const ids = [...new Set([...routeIds, ...ticketCandidates.map((ticket) => ticket.summary.ticketId)])]
  if (ids.length !== 1) {
    throw new Error(ids.length > 1
      ? 'La ruta del ticket es ambigua en el snapshot de Task Manager.'
      : 'El ticket ya no existe o no pertenece al snapshot de Task Manager.')
  }
  const ticket = library.tickets.find((candidate) => candidate.summary.ticketId === ids[0])
  if (!ticket) throw new Error('La ruta del ticket no pertenece al snapshot de Task Manager.')
  return ticket
}

function resolveBoard(snapshot: TaskManagerLibrarySnapshotDto, boardName: string) {
  const requested = boardName.trim()
  const exact = snapshot.boards.find((board) => board.name === requested || board.boardId === requested)
  const matching = exact ?? snapshot.boards.find((board) => (
    normalizeName(board.name) === normalizeName(requested) || normalizeName(board.boardId) === normalizeName(requested)
  ))
  if (!matching) throw new Error(`El tablero "${requested}" no existe en el snapshot de Task Manager.`)
  return matching
}

function assertAllowedBoard(boardName: string, allowedBoardNames: Set<string> | null): void {
  if (allowedBoardNames && !allowedBoardNames.has(normalizeName(boardName))) {
    throw new Error('El tablero no pertenece a la publicación autorizada.')
  }
}

function resolveGroup(snapshot: TaskManagerLibrarySnapshotDto, boardId: string, groupName: string): string | null {
  const requested = groupName.trim()
  if (!requested) return null
  const group = snapshot.groups.find((candidate) => (
    candidate.boardId === boardId
      && (candidate.name === requested || candidate.groupId === requested || normalizeName(candidate.name) === normalizeName(requested))
  ))
  if (!group) throw new Error(`El grupo "${requested}" no existe en el tablero solicitado.`)
  return group.groupId
}

function resolveAllowedBoardIds(
  snapshot: TaskManagerLibrarySnapshotDto,
  allowedBoardNames: readonly string[] | undefined,
): { allowedNames: Set<string> | null; allowedIds?: string[] } {
  if (allowedBoardNames === undefined) return { allowedNames: null }
  const allowedNames = new Set(allowedBoardNames.map(normalizeName).filter(Boolean))
  if (allowedNames.size === 0) throw new Error('No hay tableros autorizados para la mutación.')
  const allowedIds = snapshot.boards
    .filter((board) => allowedNames.has(normalizeName(board.name)))
    .map((board) => board.boardId)
  if (allowedIds.length === 0) throw new Error('Ninguno de los tableros autorizados existe en el snapshot.')
  return { allowedNames, allowedIds: [...new Set(allowedIds)] }
}

function mapUpdateFields(
  fields: Record<string, unknown>,
  boardId: string,
  snapshot: TaskManagerLibrarySnapshotDto,
  currentTicketId?: string,
): TaskUpdateFieldsRequest {
  const result: TaskUpdateFieldsRequest = {}
  const title = fields.title ?? fields.tarea
  const content = fields.content ?? fields.detail ?? fields.detalle
  const state = fields.state ?? fields.estado
  const priority = fields.priority ?? fields.prioridad
  const group = fields.groupId ?? fields.group ?? fields.equipo
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) throw new Error('El titulo del ticket no es válido.')
    result.title = title.trim()
  }
  if (content !== undefined) {
    if (typeof content !== 'string') throw new Error('El contenido del ticket no es válido.')
    result.content = content
  }
  if (state !== undefined) {
    if (!['Pendiente', 'Cancelada', 'En progreso', 'Finalizada', 'Bloqueada'].includes(String(state))) throw new Error('El estado del ticket no es válido.')
    result.state = state as TaskState
  }
  if (priority !== undefined) {
    if (!['Baja', 'Media', 'Alta', 'Urgente'].includes(String(priority))) throw new Error('La prioridad del ticket no es válida.')
    result.priority = priority as TaskPriority
  }
  if (group !== undefined) {
    if (typeof group !== 'string') throw new Error('El grupo del ticket no es válido.')
    const groupId = resolveGroup(snapshot, boardId, group)
    result.groupId = groupId
  }
  for (const key of ['tags', 'dependencies', 'checklist'] as const) {
    const value = fields[key]
    if (value !== undefined) {
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`El campo ${key} no es válido.`)
      result[key] = value.map((item) => item.trim()).filter(Boolean)
    }
  }
  const startDate = fields.fechaInicio ?? fields.startDate
  const endDate = fields.fechaFin ?? fields.endDate
  const dynamicEndDate = fields.fechaFinDinamica ?? fields.dynamicEndDate
  const dedicatedHours = fields.dedicado ?? fields.dedicatedHours
  const estimatedHours = fields.estimacion ?? fields.estimatedHours
  const deviationHours = fields.desvio ?? fields.deviationHours
  const order = fields.order
  const context = fields.contexto ?? fields.context
  if (startDate !== undefined) {
    if (typeof startDate !== 'string') throw new Error('La fecha de inicio del ticket no es válida.')
    result.startDate = startDate
  }
  if (endDate !== undefined) {
    if (typeof endDate !== 'string') throw new Error('La fecha de fin del ticket no es válida.')
    result.endDate = endDate
  }
  if (dynamicEndDate !== undefined) {
    if (typeof dynamicEndDate !== 'boolean') throw new Error('La fecha dinámica del ticket no es válida.')
    result.dynamicEndDate = dynamicEndDate
  }
  for (const [value, key] of [
    [dedicatedHours, 'dedicatedHours'],
    [estimatedHours, 'estimatedHours'],
    [deviationHours, 'deviationHours'],
    [order, 'order'],
  ] as const) {
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`El campo ${key} no es válido.`)
      result[key] = value
    }
  }
  if (context !== undefined) {
    if (typeof context !== 'string') throw new Error('El contexto del ticket no es válido.')
    result.context = context
  }
  if (fields.parent !== undefined || fields.parentTicketId !== undefined) {
    const parent = fields.parentTicketId ?? fields.parent
    if (parent === null || parent === '') {
      result.parentTicketId = null
    } else if (typeof parent === 'string') {
      const normalized = normalizeName(parent.replace(/^\[\[|\]\]$/g, ''))
      const candidate = snapshot.tickets.find((item) => (
        item.summary.ticketId !== currentTicketId
          && (normalizeName(item.summary.title) === normalized
            || normalizePath(item.summary.logicalPath).endsWith(`/${normalized}.md`))
      ))
      if (!candidate) throw new Error('La tarea padre no existe en el snapshot de Task Manager.')
      result.parentTicketId = candidate.summary.ticketId
    } else {
      throw new Error('La tarea padre del ticket no es válida.')
    }
  }
  if (Object.keys(result).length === 0) throw new Error('La actualización no contiene campos compatibles.')
  return result
}

export function mapTaskManagerAgentMutationToRequest(
  mutation: TaskManagerAgentMutation,
  snapshot: TaskManagerSnapshotReadDto,
  context: TaskManagerRustMutationContext,
  ids: { operationId: string; idempotencyKey?: string; now?: () => number },
): TaskManagerMutationRequestDto {
  const library = snapshotFrom(snapshot)
  if (library.libraryId !== context.libraryId || snapshot.context.libraryUserId !== context.libraryUserId) {
    throw new Error('El snapshot de Task Manager no pertenece al contexto solicitado.')
  }
  const { allowedNames, allowedIds } = resolveAllowedBoardIds(library, context.allowedBoardNames)
  const operationId = ids.operationId
  const idempotencyKey = ids.idempotencyKey ?? `task-manager:${operationId}`
  const ticketIds = new Set(library.tickets.map((ticket) => ticket.summary.ticketId))
  const commentIds = new Set(library.comments.map((comment) => comment.commentId))
  const generated = (kind: string): string => requireGeneratedId(operationId, kind, new Set([...ticketIds, ...commentIds]))
  const requestContext = {
    libraryId: context.libraryId,
    libraryUserId: context.libraryUserId,
    ...(allowedIds ? { allowedBoardIds: allowedIds } : {}),
  }

  if (mutation.kind === 'create-group') {
    const board = resolveBoard(library, mutation.board)
    assertAllowedBoard(board.name, allowedNames)
    return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'create-group', boardId: board.boardId, groupId: generated('group'), name: mutation.name, color: mutation.color } }
  }
  if (mutation.kind === 'create-board') {
    if (library.boards.some((board) => normalizeName(board.name) === normalizeName(mutation.name))) {
      throw new Error(`Ya existe un tablero llamado "${mutation.name}".`)
    }
    return {
      context: requestContext,
      operationId,
      idempotencyKey,
      mutation: {
        kind: 'create-board',
        boardId: normalizeName(mutation.name),
        name: mutation.name,
        color: mutation.color,
        context: mutation.contexto || null,
      },
    }
  }
  if (mutation.kind === 'update-board') {
    const board = resolveBoard(library, mutation.previousName)
    assertAllowedBoard(board.name, allowedNames)
    return {
      context: requestContext,
      operationId,
      idempotencyKey,
      mutation: {
        kind: 'update-board',
        boardId: board.boardId,
        name: mutation.name === mutation.previousName ? null : mutation.name,
        color: mutation.color === board.color ? null : mutation.color,
        context: mutation.contexto || null,
      },
    }
  }
  if (mutation.kind === 'delete-board') {
    const board = resolveBoard(library, mutation.board)
    assertAllowedBoard(board.name, allowedNames)
    return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'delete-board', boardId: board.boardId } }
  }
  if (mutation.kind === 'delete-group') {
    const board = resolveBoard(library, mutation.board)
    assertAllowedBoard(board.name, allowedNames)
    const groupId = resolveGroup(library, board.boardId, mutation.name)
    if (!groupId) throw new Error('El grupo solicitado no existe.')
    return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'delete-group', boardId: board.boardId, groupId } }
  }
  if (mutation.kind === 'update-group') {
    const board = resolveBoard(library, mutation.previousBoard)
    assertAllowedBoard(board.name, allowedNames)
    const groupId = resolveGroup(library, board.boardId, mutation.previousName)
    if (!groupId) throw new Error('El grupo solicitado no existe.')
    return {
      context: requestContext,
      operationId,
      idempotencyKey,
      mutation: { kind: 'update-group', boardId: board.boardId, groupId, name: mutation.name, color: mutation.color },
    }
  }
  if (mutation.kind === 'reorder-groups') {
    const board = resolveBoard(library, mutation.board)
    assertAllowedBoard(board.name, allowedNames)
    const groupIds = mutation.groupNames.map((name) => resolveGroup(library, board.boardId, name)).filter((id): id is string => id !== null)
    return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'reorder-groups', boardId: board.boardId, groupIds } }
  }
  if (mutation.kind === 'create') {
    const board = resolveBoard(library, mutation.board)
    assertAllowedBoard(board.name, allowedNames)
    const parentTicketId = mutation.parentTaskName?.trim()
      ? mapUpdateFields({ parent: mutation.parentTaskName }, board.boardId, library).parentTicketId ?? null
      : null
    const initialFields = mutation.fields && Object.keys(mutation.fields).length > 0
      ? mapUpdateFields(mutation.fields, board.boardId, library)
      : undefined
    return {
      context: requestContext,
      operationId,
      idempotencyKey,
      mutation: {
        kind: 'create-ticket', boardId: board.boardId, ticketId: generated('ticket'), groupId: resolveGroup(library, board.boardId, mutation.group),
        title: mutation.title, content: mutation.content, state: mutation.state, priority: mutation.priority, parentTicketId, tags: [],
        ...(initialFields ? { initialFields } : {}),
      },
    }
  }

  if (mutation.kind === 'bulk-update') {
    const tickets = mutation.taskPaths.map((taskPath) => resolveTicket(snapshot, taskPath))
    tickets.forEach((item) => {
      const board = library.boards.find((candidate) => candidate.boardId === item.summary.boardId)
      if (!board) throw new Error('Uno de los tickets pertenece a un tablero inexistente en el snapshot.')
      assertAllowedBoard(board.name, allowedNames)
    })
    const firstTicket = tickets[0]
    if (!firstTicket) throw new Error('La actualización masiva debe incluir al menos un ticket.')
    return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'bulk-update', ticketIds: tickets.map((item) => item.summary.ticketId), fields: mapUpdateFields(mutation.fields, firstTicket.summary.boardId, library, firstTicket.summary.ticketId) } }
  }

  const ticket = resolveTicket(snapshot, 'taskPath' in mutation ? mutation.taskPath : '')
  const ticketBoard = library.boards.find((board) => board.boardId === ticket.summary.boardId)
  if (!ticketBoard) throw new Error('El ticket pertenece a un tablero inexistente en el snapshot.')
  assertAllowedBoard(ticketBoard.name, allowedNames)
  const ticketId = ticket.summary.ticketId
  if (mutation.kind === 'replace-content') return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'replace-ticket-content', ticketId, content: mutation.content } }
  if (mutation.kind === 'add-comment') return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'add-comment', ticketId, commentId: generated('comment'), body: mutation.comment, createdAtUnixMs: ids.now?.() ?? Date.now() } }
  if (mutation.kind === 'add-subtask') return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'add-subtask', parentTicketId: ticketId, ticketId: generated('subtask'), title: mutation.title, content: mutation.content, priority: mutation.priority ?? ticket.summary.priority as TaskPriority } }
  if (mutation.kind === 'move-group') return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'move-ticket', ticketId, groupId: resolveGroup(library, ticket.summary.boardId, mutation.group) } }
  if (mutation.kind === 'change-state') return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'change-state', ticketId, state: mutation.state } }
  if (mutation.kind === 'change-priority') return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'change-priority', ticketId, priority: mutation.priority } }
  if (mutation.kind === 'update-fields') return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'update-ticket', ticketId, fields: mapUpdateFields(mutation.fields, ticket.summary.boardId, library, ticketId) } }
  if (mutation.kind === 'duplicate') return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'duplicate-ticket', ticketId, newTicketId: generated('duplicate'), title: mutation.title } }
  if (mutation.kind === 'archive') return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'archive-ticket', ticketId } }
  if (mutation.kind === 'restore') return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'restore-ticket', ticketId } }
  if (mutation.kind === 'delete') return { context: requestContext, operationId, idempotencyKey, mutation: { kind: 'delete-ticket', ticketId } }
  throw new Error('La mutación de Task Manager no está soportada por el adaptador Rust.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSerializedU64(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    && value <= Number('18446744073709551615')
}

function validatePreview(value: unknown, request: TaskManagerMutationRequestDto): TaskMutationPreviewDto {
  if (!isRecord(value)
    || value.libraryId !== request.context.libraryId
    || value.libraryUserId !== request.context.libraryUserId
    || value.operationId !== request.operationId
    || value.idempotencyKey !== request.idempotencyKey
    || !Array.isArray(value.allowedActions)) {
    throw new Error('La respuesta de preview de Task Manager no es válida.')
  }
  return value as unknown as TaskMutationPreviewDto
}

export function validateTaskManagerMutationReceipt(value: unknown, request: TaskManagerMutationRequestDto): TaskMutationReceiptDto {
  if (!isRecord(value)
    || value.libraryId !== request.context.libraryId
    || value.libraryUserId !== request.context.libraryUserId
    || value.operationId !== request.operationId
    || value.idempotencyKey !== request.idempotencyKey
    || typeof value.changed !== 'boolean'
    || typeof value.replayed !== 'boolean'
    || !Array.isArray(value.affectedIds)
    || !value.affectedIds.every((id) => typeof id === 'string')
    || !Array.isArray(value.revisions)
    || !value.revisions.every((revision) => (
      isRecord(revision)
      && typeof revision.entityType === 'string'
      && typeof revision.entityId === 'string'
      && isSerializedU64(revision.revision)
    ))) {
    throw new Error('El receipt de Task Manager no es válido.')
  }
  return value as unknown as TaskMutationReceiptDto
}

export async function executeTaskManagerRustMutation(
  mutation: TaskManagerAgentMutation,
  context: TaskManagerRustMutationContext,
  options: TaskManagerRustMutationAdapterOptions = {},
): Promise<TaskMutationReceiptDto> {
  const snapshot = await readTaskManagerSnapshot({ libraryId: context.libraryId, libraryUserId: context.libraryUserId })
  const operationId = options.operationId ?? createOperationId()
  const request = mapTaskManagerAgentMutationToRequest(mutation, snapshot, context, {
    operationId,
    idempotencyKey: options.idempotencyKey,
    now: options.now,
  })
  const preview = validatePreview(await invoke<unknown>('task_manager_preview_mutation', { request }), request)
  if (preview.operationId !== request.operationId || preview.idempotencyKey !== request.idempotencyKey) {
    throw new Error('El preview de Task Manager no coincide con la operación solicitada.')
  }
  const receipt = validateTaskManagerMutationReceipt(await invoke<unknown>('task_manager_apply_mutation', {
    request: { context: request.context, operationId: request.operationId, idempotencyKey: request.idempotencyKey, confirmed: true },
  }), request)
  return receipt
}
