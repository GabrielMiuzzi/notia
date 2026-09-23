import type { Group, TaskManagerSettings, TaskPriority, TaskState } from '../types/taskManagerTypes'
import { loadTaskManagerSettings } from './taskManagerStorage'
import {
  loadTaskManagerSnapshot,
  resolveTaskManagerMutationJournalPath,
  resolveTaskManagerSnapshotChangedPaths,
} from './taskManagerService'
import { dispatchTaskManagerMutation } from './taskManagerMutationEvents'
import {
  beginTaskManagerPublicationBatch,
  endTaskManagerPublicationBatch,
  notifyTaskManagerPublicationChanged,
  setTaskManagerPublicationRecovery,
} from './taskManagerPublicationRuntime'
import { enqueueTaskManagerMutation } from './taskManagerMutationCoordinator'
import type { TaskManagerMutationContext } from './taskManagerMutationCoordinator'
import { flushPendingTaskManagerLibraryTreeChanges } from './vaultRuntime'
import {
  beginTaskManagerMutationJournal,
  completeTaskManagerMutationJournal,
  recordTaskManagerMutationJournalChangedPaths,
} from './taskManagerMutationJournal'
import {
  executeTaskManagerRustMutation,
  type TaskManagerRustMutationContext,
  type TaskMutationReceiptDto,
} from './taskManagerRustMutationAdapter'

export type TaskManagerAgentMutation =
  | {
    kind: 'create'
    board: string
    title: string
    content: string
    group: string
    priority: TaskPriority
    state: TaskState
    /** File name or title of the parent task for a subtask. */
    parentTaskName?: string
    /** Schedule, estimate and context applied in the same confirmed create. */
    fields?: Record<string, unknown>
  }
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
  | { kind: 'delete'; taskPath: string }
  | { kind: 'create-group'; board: string; name: string; color: string }
  | { kind: 'delete-group'; board: string; name: string }
  | { kind: 'create-board'; name: string; color: string; contexto: string; activityHoursPerDay: number }
  | { kind: 'update-board'; previousName: string; name: string; color: string; contexto: string; activityHoursPerDay: number }
  | { kind: 'delete-board'; board: string }
  | { kind: 'update-group'; board: string; previousName: string; previousBoard: string; name: string; color: string }
  | { kind: 'reorder-groups'; board: string; groupNames: string[] }

export interface TaskManagerAgentMutationAuthorization {
  allowedBoardNames?: readonly string[]
}

export interface TaskManagerAgentMutationContext {
  libraryId?: string
  libraryUserId?: string
  published?: boolean
  android?: boolean
  publicationSettings?: TaskManagerSettings
}

type TaskManagerAgentMutationOptions = TaskManagerAgentMutationAuthorization & TaskManagerAgentMutationContext

export function shouldUseTaskManagerRustBackend(context?: TaskManagerAgentMutationContext): boolean {
  return Boolean(context?.libraryId?.trim())
    && Boolean(context?.libraryUserId?.trim())
}

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

export async function executeTaskManagerAgentMutation(
  vaultPath: string,
  mutation: TaskManagerAgentMutation,
  authorization: TaskManagerAgentMutationOptions = {},
  context?: TaskManagerAgentMutationContext,
): Promise<TaskMutationReceiptDto | void> {
  const options: TaskManagerAgentMutationOptions = { ...authorization, ...context }
  return enqueueTaskManagerMutation((mutationContext) => (
    executeTaskManagerAgentMutationQueued(vaultPath, mutation, mutationContext, options)
  ))
}

async function executeTaskManagerAgentMutationQueued(
  vaultPath: string,
  mutation: TaskManagerAgentMutation,
  mutationContext: TaskManagerMutationContext,
  options: TaskManagerAgentMutationOptions,
): Promise<TaskMutationReceiptDto | void> {
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
    publicationBatchActive = await beginTaskManagerPublicationBatch(mutationContext.operationId)
    const execution = await executeTaskManagerAgentMutationInternal(vaultPath, mutation, mutationContext, options)
    const changedPaths = execution.changedPaths
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
      await endTaskManagerPublicationBatch(mutationContext.operationId)
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
    return execution.receipt
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
        await endTaskManagerPublicationBatch(mutationContext.operationId)
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
  options: TaskManagerAgentMutationOptions,
): Promise<{ changedPaths: string[]; receipt?: TaskMutationReceiptDto }> {
  const snapshot = await loadTaskManagerSnapshot(vaultPath)
  if (!shouldUseTaskManagerRustBackend(options)) {
    throw new Error('El Task Manager necesita una biblioteca registrada y un usuario activo.')
  }
  const backendContext: TaskManagerRustMutationContext = {
    libraryId: options.libraryId!.trim(),
    libraryUserId: options.libraryUserId!.trim(),
    allowedBoardNames: options.allowedBoardNames,
  }
  const receipt = await executeTaskManagerRustMutation(mutation, backendContext, {
    operationId: mutationContext.operationId,
    idempotencyKey: `task-manager:${mutationContext.operationId}`,
  })
  const refreshedSnapshot = await loadTaskManagerSnapshot(vaultPath)
  const changedPaths = resolveTaskManagerSnapshotChangedPaths(snapshot, refreshedSnapshot)
  flushPendingTaskManagerLibraryTreeChanges()
  await notifyTaskManagerPublicationChanged(
    vaultPath,
    options.publicationSettings ?? loadTaskManagerSettings(),
    changedPaths,
    mutationContext,
  )
  dispatchTaskManagerMutation(vaultPath, changedPaths)
  return { changedPaths, receipt }
}
