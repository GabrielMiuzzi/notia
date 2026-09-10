import type { Board, Group, TaskFormData, TaskItem, TaskManagerSettings, TaskPriority, TaskState } from '../types/taskManagerTypes'
import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'
import { appendTaskComment } from '../engines/taskCommentEngine'
import { loadTaskManagerSettings, saveTaskManagerSettings } from './taskManagerStorage'
import {
  createTask,
  loadTaskManagerSnapshot,
  moveTaskByState,
  readTaskMarkdownSource,
  readTaskMarkdownSourceWithRevision,
  resolveTaskManagerMutationJournalPath,
  resolveTaskManagerSnapshotChangedPaths,
  writeTaskMarkdownSource,
  syncTaskIndexesAndMetadata,
  updateTaskBody,
  updateTaskFrontmatter,
} from './taskManagerService'
import { writeTaskManagerSharedMetadata } from './taskManagerSharedMetadata'
import { dispatchTaskManagerMutation } from './taskManagerMutationEvents'
import {
  beginTaskManagerPublicationBatch,
  endTaskManagerPublicationBatch,
  notifyTaskManagerPublicationChanged,
  setTaskManagerPublicationRecovery,
  syncTaskManagerPublicationSettings,
} from './taskManagerPublicationRuntime'
import { enqueueTaskManagerMutation } from './taskManagerMutationCoordinator'
import type { TaskManagerMutationContext } from './taskManagerMutationCoordinator'
import { flushPendingTaskManagerLibraryTreeChanges } from './vaultRuntime'
import {
  beginTaskManagerMutationJournal,
  completeTaskManagerMutationJournal,
  recordTaskManagerMutationJournalChangedPaths,
} from './taskManagerMutationJournal'

export type TaskManagerAgentMutation =
  | { kind: 'create'; board: string; title: string; content: string; group: string; priority: TaskPriority; state: TaskState }
  | { kind: 'replace-content'; taskPath: string; content: string }
  | { kind: 'add-comment'; taskPath: string; comment: string }
  | { kind: 'add-subtask'; taskPath: string; title: string; content: string; priority?: TaskPriority }
  | { kind: 'move-group'; taskPath: string; group: string }
  | { kind: 'change-state'; taskPath: string; state: TaskState }
  | { kind: 'change-priority'; taskPath: string; priority: TaskPriority }
  | { kind: 'update-fields'; taskPath: string; fields: Record<string, unknown> }
  | { kind: 'bulk-update'; taskPaths: string[]; fields: Record<string, unknown> }
  | { kind: 'duplicate'; taskPath: string; title: string }
  | { kind: 'archive'; taskPath: string }
  | { kind: 'restore'; taskPath: string }
  | { kind: 'create-group'; board: string; name: string; color: string }
  | { kind: 'delete-group'; board: string; name: string }

const MAX_TASK_TEXT_CHARS = 30_000

function sharedSettingsFingerprint(settings: TaskManagerSettings): string {
  return JSON.stringify({ boards: settings.boards, groups: settings.groups })
}

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

function findSnapshotDocumentContent(snapshot: Awaited<ReturnType<typeof loadTaskManagerSnapshot>>, taskPath: string): string | undefined {
  const normalizedPath = normalizeFilesystemPath(taskPath).toLowerCase()
  return snapshot.documents.find((document) => {
    const documentPath = normalizeFilesystemPath(document.path).toLowerCase()
    return documentPath === normalizedPath || normalizedPath.endsWith(`/${documentPath}`)
  })?.content
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

async function persistAgentSharedSettings(
  vaultPath: string,
  settings: TaskManagerSettings,
  mutationContext: TaskManagerMutationContext,
): Promise<void> {
  saveTaskManagerSettings(settings, { syncPublication: false })
  if (typeof window !== 'undefined' && window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
    await syncTaskManagerPublicationSettings(vaultPath, settings, mutationContext)
    return
  }
  await writeTaskManagerSharedMetadata(vaultPath, settings)
}

function replaceMarkdownBody(content: string, nextBody: string): string {
  const frontmatter = content.match(/^---\s*\r?\n[\s\S]*?\r?\n---/)?.[0]
  if (!frontmatter) {
    throw new Error('El ticket no tiene un frontmatter valido.')
  }
  return `${frontmatter}\n\n${nextBody.trim()}\n`
}

export async function executeTaskManagerAgentMutation(
  vaultPath: string,
  mutation: TaskManagerAgentMutation,
): Promise<void> {
  return enqueueTaskManagerMutation((mutationContext) => (
    executeTaskManagerAgentMutationQueued(vaultPath, mutation, mutationContext)
  ))
}

async function executeTaskManagerAgentMutationQueued(
  vaultPath: string,
  mutation: TaskManagerAgentMutation,
  mutationContext: TaskManagerMutationContext,
): Promise<void> {
  const initialSnapshot = await loadTaskManagerSnapshot(vaultPath)
  const initialSharedSettings = loadTaskManagerSettings()
  const isPublishedClient = typeof window !== 'undefined' && window.__NOTIA_PUBLISHED_TASK_MANAGER__ === true
  const journalPath = isPublishedClient ? undefined : await resolveTaskManagerMutationJournalPath(vaultPath)
  let journalActive = false
  let publicationBatchActive = false
  try {
    if (journalPath) {
      await beginTaskManagerMutationJournal(journalPath, mutationContext.operationId, ['task-manager'])
      journalActive = true
    }
    publicationBatchActive = await beginTaskManagerPublicationBatch()
    const changedPaths = await executeTaskManagerAgentMutationInternal(vaultPath, mutation, mutationContext)
    if (journalPath) {
      try {
        await recordTaskManagerMutationJournalChangedPaths(
          journalPath,
          mutationContext.operationId,
          changedPaths,
        )
      } catch (journalError) {
        console.warn('[task-manager] no se pudo registrar el alcance de la mutación del agente', journalError)
      }
    }
    if (publicationBatchActive) {
      await endTaskManagerPublicationBatch()
      publicationBatchActive = false
    }
    if (journalPath) {
      try {
        await completeTaskManagerMutationJournal(journalPath, mutationContext.operationId, 'committed')
        journalActive = false
        await setTaskManagerPublicationRecovery(false)
      } catch (journalError) {
        console.warn('[task-manager] no se pudo cerrar el journal de la mutación aplicada', journalError)
      }
    }
  } catch (error) {
    try {
      await setTaskManagerPublicationRecovery(true)
    } catch (recoveryError) {
      console.warn('[task-manager] no se pudo marcar la publicación en recuperación', recoveryError)
    }
    try {
      const recoverySnapshot = await loadTaskManagerSnapshot(vaultPath)
      const changedPaths = resolveTaskManagerSnapshotChangedPaths(initialSnapshot, recoverySnapshot)
      const recoverySettings = loadTaskManagerSettings()
      const sharedSettingsChanged = sharedSettingsFingerprint(initialSharedSettings)
        !== sharedSettingsFingerprint(recoverySettings)
      const sourceChanged = sharedSettingsChanged
        || initialSnapshot.documents.length !== recoverySnapshot.documents.length
        || changedPaths.length > 0
        || initialSnapshot.documents.some((document, index) => {
          const recoveryDocument = recoverySnapshot.documents[index]
          return recoveryDocument?.path !== document.path || recoveryDocument.content !== document.content
        })
      if (sourceChanged) {
        if (journalActive && journalPath) {
          try {
            await recordTaskManagerMutationJournalChangedPaths(
              journalPath,
              mutationContext.operationId,
              changedPaths,
            )
          } catch (journalError) {
            console.warn('[task-manager] no se pudo registrar el alcance parcial de la mutación del agente', journalError)
          }
        }
        try {
          await setTaskManagerPublicationRecovery(true)
        } catch (recoveryError) {
          console.warn('[task-manager] no se pudo marcar la publicación en recuperación', recoveryError)
        }
        try {
          await notifyTaskManagerPublicationChanged(
            vaultPath,
            recoverySettings,
            changedPaths,
            mutationContext,
          )
        } catch (publicationError) {
          console.warn('[task-manager] no se pudo anunciar la recuperación al runtime de publicación', publicationError)
        }
        dispatchTaskManagerMutation(vaultPath, changedPaths)
      } else if (journalActive && journalPath) {
        try {
          await setTaskManagerPublicationRecovery(true)
        } catch (recoveryError) {
          console.warn('[task-manager] no se pudo preparar el estado de recuperación', recoveryError)
        }
        try {
          await completeTaskManagerMutationJournal(journalPath, mutationContext.operationId, 'rolled-back')
          journalActive = false
          await setTaskManagerPublicationRecovery(false)
        } catch (journalError) {
          console.warn('[task-manager] no se pudo marcar el rollback de la mutación', journalError)
        }
      }
    } catch (recoveryError) {
      console.warn('[task-manager] no se pudo publicar la recuperación de una mutación parcial', recoveryError)
    }
    throw error
  } finally {
    if (publicationBatchActive) {
      try {
        await endTaskManagerPublicationBatch()
        publicationBatchActive = false
      } catch (batchError) {
        console.warn('[task-manager] no se pudo cerrar el lote de publicación del agente', batchError)
      }
    }
  }
}

async function executeTaskManagerAgentMutationInternal(
  vaultPath: string,
  mutation: TaskManagerAgentMutation,
  mutationContext: TaskManagerMutationContext,
): Promise<string[]> {
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
    await persistAgentSharedSettings(
      vaultPath,
      { ...settings, groups: [...settings.groups, { name, color, board }] },
      mutationContext,
    )
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
    await persistAgentSharedSettings(vaultPath, {
      ...settings,
      groups: settings.groups.filter((group) => !(group.name === name && (group.board ?? 'default') === board)),
    }, mutationContext)
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
  } else if (mutation.kind === 'bulk-update') {
    const tasks = mutation.taskPaths.map((taskPath) => findTask(snapshot.tasks, taskPath))
    if (tasks.length === 0 || tasks.length > 50) throw new Error('La actualización masiva debe incluir entre 1 y 50 tickets.')
    const originalSources = await Promise.all(tasks.map(async (task) => {
      const source = await readTaskMarkdownSourceWithRevision(vaultPath, task.filePath)
      return {
        path: task.filePath,
        content: source.content,
      }
    }))
    const originalSourcesByPath = new Map(originalSources.map((source) => [source.path, source]))
    const appliedTasks: typeof tasks = []
    try {
      for (const task of tasks) {
        await updateTaskFrontmatter(vaultPath, task.filePath, mutation.fields, {
          baseContent: findSnapshotDocumentContent(snapshot, task.filePath),
        })
        appliedTasks.push(task)
        affectedBoard = affectedBoard ?? task.board
      }
    } catch (error) {
      const rollbackErrors: string[] = []
      for (const task of appliedTasks) {
        try {
          const source = originalSourcesByPath.get(task.filePath)
          if (!source) {
            throw new Error('No se encontrÃ³ la fuente original para el rollback.')
          }
          const currentSource = await readTaskMarkdownSourceWithRevision(vaultPath, source.path)
          await writeTaskMarkdownSource(vaultPath, source.path, source.content, currentSource.revision)
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : 'error desconocido')
        }
      }
      const reason = error instanceof Error ? error.message : 'error desconocido'
      throw new Error(rollbackErrors.length > 0
        ? `La actualizacion masiva fallo (${reason}) y el rollback quedo incompleto en ${rollbackErrors.length} ticket(s).`
        : `La actualizacion masiva fallo (${reason}); se revirtieron ${appliedTasks.length} ticket(s).`)
    }
  } else if (mutation.kind === 'duplicate') {
    const sourceTask = findTask(snapshot.tasks, mutation.taskPath)
    const title = requireText(mutation.title, 'El titulo', 180)
    const sourceContent = await readTaskMarkdownSource(vaultPath, sourceTask.filePath)
    const formData: TaskFormData = {
      title,
      detail: sourceTask.detail,
      state: sourceTask.state,
      endDate: sourceTask.endDate,
      dynamicEndDate: sourceTask.dynamicEndDate,
      board: sourceTask.board,
      group: sourceTask.group,
      priority: sourceTask.priority || 'Media',
      estimatedHours: sourceTask.estimatedHours,
      parentTaskName: sourceTask.parentTaskName,
    }
    const duplicatedPath = await createTask(vaultPath, formData, snapshot.tasks)
    const body = sourceContent.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n([\s\S]*)$/)?.[1] ?? ''
    if (body.trim()) {
      await updateTaskBody(vaultPath, duplicatedPath, (current) => replaceMarkdownBody(current, body))
    }
    affectedBoard = sourceTask.board
  } else {
    const task = findTask(snapshot.tasks, mutation.taskPath)
    affectedBoard = task.board
    if (mutation.kind === 'replace-content') {
      const content = requireText(mutation.content, 'El contenido')
      await updateTaskBody(vaultPath, task.filePath, (current) => replaceMarkdownBody(current, content))
    } else if (mutation.kind === 'add-comment') {
      const comment = requireText(mutation.comment, 'El comentario', 10_000)
      await updateTaskBody(vaultPath, task.filePath, (current) => appendTaskComment(current, comment))
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
      }, {
        baseContent: findSnapshotDocumentContent(snapshot, task.filePath),
      })
    } else if (mutation.kind === 'change-state') {
      await moveTaskByState(vaultPath, task, mutation.state, new Set(snapshot.tasks.map((item) => item.filePath)))
    } else if (mutation.kind === 'update-fields') {
      await updateTaskFrontmatter(vaultPath, task.filePath, mutation.fields, {
        baseContent: findSnapshotDocumentContent(snapshot, task.filePath),
      })
    } else if (mutation.kind === 'archive') {
      await moveTaskByState(vaultPath, task, 'Finalizada', new Set(snapshot.tasks.map((item) => item.filePath)))
    } else if (mutation.kind === 'restore') {
      await moveTaskByState(vaultPath, task, 'Pendiente', new Set(snapshot.tasks.map((item) => item.filePath)))
    } else {
      await updateTaskFrontmatter(vaultPath, task.filePath, { prioridad: mutation.priority }, {
        baseContent: findSnapshotDocumentContent(snapshot, task.filePath),
      })
    }
  }

  const refreshedSnapshot = await loadTaskManagerSnapshot(vaultPath)
  const boards = resolveBoards(refreshedSnapshot.tasks, affectedBoard)
  await syncTaskIndexesAndMetadata(vaultPath, boards.map((board) => board.name), boards)
  flushPendingTaskManagerLibraryTreeChanges()
  const changedPaths = resolveTaskManagerSnapshotChangedPaths(snapshot, refreshedSnapshot)
  await notifyTaskManagerPublicationChanged(
    vaultPath,
    loadTaskManagerSettings(),
    changedPaths,
    mutationContext,
  )
  dispatchTaskManagerMutation(
    vaultPath,
    changedPaths,
  )
  return changedPaths
}
