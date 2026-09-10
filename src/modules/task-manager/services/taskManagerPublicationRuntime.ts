import { invoke } from '@tauri-apps/api/core'
import {
  invokeTaskManagerPublicationMutation,
  setActiveTaskManagerPublicationBatchOperation,
} from './taskManagerPublicationClient'
import { enqueueTaskManagerMutation, type TaskManagerMutationContext } from './taskManagerMutationCoordinator'
import {
  beginTaskManagerMutationJournal,
  completeTaskManagerMutationJournal,
  recordTaskManagerMutationJournalChangedPaths,
} from './taskManagerMutationJournal'
import { resolveTaskManagerMutationJournalPath } from './taskManagerService'
import type { Board, Group, TaskItem, TaskManagerSettings } from '../types/taskManagerTypes'
import type { PublishedTaskManagerDevice } from '../../../services/preferences/taskManagerPublicationSettingsStorage'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'

export interface PublishedTaskManagerBoard {
  name: string
  color: string
  groups: Array<Pick<Group, 'name' | 'color'>>
  tasks: Array<Pick<TaskItem, 'title' | 'detail' | 'state' | 'startDate' | 'endDate' | 'group' | 'priority' | 'dedicatedHours' | 'estimatedHours' | 'deviationHours' | 'parentTaskName' | 'order'>>
}

export interface TaskManagerPublicationPayload {
  vaultPath: string
  theme: 'dark' | 'light'
  passwordHash: string
  approvedDevices: PublishedTaskManagerDevice[]
  maxClients: number
  port: number
  aiPreferences: AiPreferences
  settings: TaskManagerSettings
  boards: PublishedTaskManagerBoard[]
}

export interface TaskManagerPublicationStatusSnapshot {
  active: boolean
  authenticatedSessions: number
  websocketSessions: number
  maxAuthenticatedSessions: number
  maxWebsocketSessions: number
  publicationEpoch: string
  revision: number
  sequence: number
  lastOperationId: string | null
  lastActorId: string | null
  websocketFramesReceived: number
  websocketFramesSent: number
  websocketBytesReceived: number
  websocketBytesSent: number
  droppedEvents: number
  resyncRequired: number
  conflicts: number
  mutationsApplied: number
  mutationErrors: number
  aiStreamCancellations: number
  lastChangeAtUnixMs: number | null
  mutationLatencySamples: number
  mutationLatencyLastMs: number | null
  mutationLatencyP95Ms: number | null
  recoveryRequired: boolean
}

export interface TaskManagerPublicationCursor {
  publicationEpoch: string
  sequence: number
  revision: number
}

export interface TaskManagerPublicationBatchOptions {
  vaultPath?: string
  scopes?: string[]
  changedPaths?: string[]
  /** Runs before the batch releases remote mutations after a local failure. */
  onFailure?: (error: unknown, context: TaskManagerMutationContext) => Promise<void>
}

let activePublishedBatchOperationId: string | null = null

function createTaskManagerPublicationOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `published-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`
}

export function buildTaskManagerPublicationPayload(
  boards: Board[],
  groups: Group[],
  tasks: TaskItem[],
  publishedBoardNames: string[],
  vaultPath: string,
  theme: 'dark' | 'light',
  passwordHash: string,
  aiPreferences: AiPreferences,
  approvedDevices: PublishedTaskManagerDevice[] = [],
  port = 52471,
  maxClients = 64,
): TaskManagerPublicationPayload {
  const allowedBoardNames = new Set(publishedBoardNames.map((name) => name.trim().toLowerCase()))
  const isPublishedBoard = (boardName: string | undefined): boolean => allowedBoardNames.has(boardName?.trim().toLowerCase() ?? 'default')
  return {
    vaultPath,
    theme,
    passwordHash,
    approvedDevices,
    maxClients: Math.min(64, Math.max(1, Math.trunc(maxClients))),
    port,
    aiPreferences,
    settings: {
      activeVaultPath: null,
      boards: boards.filter((board) => isPublishedBoard(board.name)),
      groups: groups.filter((group) => isPublishedBoard(group.board)),
      pomodoro: {
        phase: 'work', runState: 'idle', remainingSeconds: 0, endTimestamp: null, completedWorkCycles: 0,
        selectedTaskPath: null, isDeviationActive: false, deviationStartedAt: null, deviationBaseRemainingSeconds: 0,
        phaseDeviationSeconds: 0, durations: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
      },
      activeTab: boards.find((board) => isPublishedBoard(board.name))?.name ?? 'default',
    },
    boards: boards
      .filter((board) => isPublishedBoard(board.name))
      .map((board) => ({
        name: board.name,
        color: board.color,
        groups: groups
          .filter((group) => group.board?.trim().toLowerCase() === board.name.trim().toLowerCase())
          .map((group) => ({ name: group.name, color: group.color })),
        tasks: tasks
          .filter((task) => task.board.trim().toLowerCase() === board.name.trim().toLowerCase())
          .filter((task) => !task.filePath.includes('/finished/') && !task.filePath.includes('/cancelled/'))
          .map(({ title, detail, state, startDate, endDate, group, priority, dedicatedHours, estimatedHours, deviationHours, parentTaskName, order }) => ({
            title, detail, state, startDate, endDate, group, priority, dedicatedHours, estimatedHours, deviationHours, parentTaskName, order,
          }))
          .sort((left, right) => left.order - right.order),
      })),
  }
}

export async function publishTaskManagerBoards(payload: TaskManagerPublicationPayload): Promise<string> {
  return invoke<string>('publish_task_manager_boards', { payload })
}

export async function hashTaskManagerPublicationPassword(password: string): Promise<string> {
  return invoke<string>('hash_task_manager_publication_password', { password })
}

export async function getTaskManagerPublicationUrl(): Promise<string> {
  return invoke<string>('get_task_manager_publication_url')
}
export async function getTaskManagerPublicationStatus(): Promise<TaskManagerPublicationStatusSnapshot> {
  return invoke<TaskManagerPublicationStatusSnapshot>('get_task_manager_publication_status')
}
export async function setTaskManagerPublicationRecovery(required: boolean): Promise<void> {
  if (typeof window !== 'undefined' && window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
    return
  }
  await invoke('set_task_manager_publication_recovery', { required })
}
export async function listPendingTaskManagerPublicationDevices(): Promise<PublishedTaskManagerDevice[]> { return invoke('list_pending_task_manager_publication_devices') }
export async function approveTaskManagerPublicationDevice(deviceId: string): Promise<PublishedTaskManagerDevice> { return invoke('approve_task_manager_publication_device', { deviceId }) }
export async function revokeTaskManagerPublicationDevice(deviceId: string): Promise<void> { await invoke('revoke_task_manager_publication_device', { deviceId }) }

export async function openTaskManagerPublication(): Promise<void> {
  await invoke('open_task_manager_publication')
}

export async function stopTaskManagerPublication(): Promise<void> {
  await invoke('stop_task_manager_publication')
}

export async function notifyTaskManagerPublicationChanged(
  vaultPath: string,
  settings?: TaskManagerSettings,
  changedPaths: string[] = [],
  context?: Pick<TaskManagerMutationContext, 'actorId' | 'operationId'>,
): Promise<TaskManagerPublicationCursor | null> {
  if (typeof window !== 'undefined' && window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
    return null
  }
  return invoke<TaskManagerPublicationCursor | null>('notify_task_manager_publication_changed', {
    vaultPath,
    settings,
    changedPaths,
    operationId: context?.operationId,
    actorId: context?.actorId,
  })
}

export async function syncTaskManagerPublicationSettings(
  vaultPath: string,
  settings: TaskManagerSettings,
  context?: Pick<TaskManagerMutationContext, 'actorId' | 'operationId'>,
): Promise<void> {
  const sharedSettings = {
    boards: settings.boards,
    groups: settings.groups,
  }

  if (typeof window !== 'undefined' && window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
    await invokeTaskManagerPublicationMutation({
      command: 'update_task_manager_publication_settings',
      args: { settings: sharedSettings },
    }, context?.operationId ?? activePublishedBatchOperationId ?? undefined)
    return
  }

  await notifyTaskManagerPublicationChanged(vaultPath, settings, [], context)
}

export async function beginTaskManagerPublicationBatch(operationId?: string): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false
  }
  if (!('__TAURI_INTERNALS__' in window)) {
    return false
  }
  if (window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
    if (activePublishedBatchOperationId) {
      throw new Error('Ya existe una operaciÃ³n publicada agrupada en curso.')
    }
    const batchOperationId = operationId ?? createTaskManagerPublicationOperationId()
    await invokeTaskManagerPublicationMutation(
      { command: 'begin_task_manager_publication_batch', args: {} },
      batchOperationId,
    )
    activePublishedBatchOperationId = batchOperationId
    setActiveTaskManagerPublicationBatchOperation(batchOperationId)
    return true
  }
  return invoke<boolean>('begin_task_manager_publication_batch')
}

export async function endTaskManagerPublicationBatch(operationId?: string): Promise<TaskManagerPublicationCursor | null> {
  if (typeof window === 'undefined') {
    return null
  }
  if (!('__TAURI_INTERNALS__' in window)) {
    return null
  }
  if (window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
    const batchOperationId = activePublishedBatchOperationId ?? operationId
    try {
      await invokeTaskManagerPublicationMutation(
        { command: 'end_task_manager_publication_batch', args: {} },
        batchOperationId,
      )
      // The WebSocket client applies the ACK cursor; result is {ok, changed},
      // unlike the native command's cursor DTO.
      return null
    } finally {
      if (!batchOperationId || activePublishedBatchOperationId === batchOperationId) {
        activePublishedBatchOperationId = null
        setActiveTaskManagerPublicationBatchOperation(null)
      }
    }
  }
  return invoke<TaskManagerPublicationCursor | null>('end_task_manager_publication_batch')
}

export async function withTaskManagerPublicationBatch<T>(
  runner: (context: TaskManagerMutationContext) => Promise<T>,
  after?: (result: T, context: TaskManagerMutationContext) => Promise<void>,
  options?: TaskManagerPublicationBatchOptions,
): Promise<T> {
  return enqueueTaskManagerMutation(async (context) => {
    const shouldJournal = Boolean(options?.vaultPath)
      && !(typeof window !== 'undefined' && window.__NOTIA_PUBLISHED_TASK_MANAGER__ === true)
    const journalPath = shouldJournal && options?.vaultPath
      ? await resolveTaskManagerMutationJournalPath(options.vaultPath)
      : undefined
    let journalActive = false
    let publicationBatchActive = false
    try {
      if (journalPath) {
        await beginTaskManagerMutationJournal(
          journalPath,
          context.operationId,
          options?.scopes ?? ['task-manager'],
        )
        journalActive = true
      }
      publicationBatchActive = await beginTaskManagerPublicationBatch(context.operationId)
      const result = await runner(context)
      if (journalPath && journalActive && options?.changedPaths) {
        try {
          await recordTaskManagerMutationJournalChangedPaths(
            journalPath,
            context.operationId,
            options.changedPaths,
          )
        } catch (journalError) {
          console.warn('[task-manager] no se pudo registrar el alcance del lote', journalError)
        }
      }
      if (after) {
        await after(result, context)
      }
      if (publicationBatchActive) {
        await endTaskManagerPublicationBatch(context.operationId)
        publicationBatchActive = false
      }
      if (journalPath && journalActive) {
        await completeTaskManagerMutationJournal(journalPath, context.operationId, 'committed')
        journalActive = false
        try {
          await setTaskManagerPublicationRecovery(false)
        } catch (recoveryError) {
          console.warn('[task-manager] no se pudo confirmar el estado verificado del lote', recoveryError)
        }
      }
      return result
    } catch (error) {
      if (journalActive) {
        try {
          await setTaskManagerPublicationRecovery(true)
        } catch (recoveryError) {
          console.warn('[task-manager] no se pudo marcar la recuperaciÃ³n del batch', recoveryError)
        }
      }
      if (options?.onFailure) {
        try {
          await options.onFailure(error, context)
        } catch (recoveryError) {
          console.warn('[task-manager] no se pudo reconciliar un lote parcial de publicacion', recoveryError)
          if (journalActive) {
            try {
              await setTaskManagerPublicationRecovery(true)
            } catch (setRecoveryError) {
              console.warn('[task-manager] no se pudo mantener la recuperacion activa', setRecoveryError)
            }
          }
        }
      }
      throw error
    } finally {
      if (publicationBatchActive) {
        try {
          await endTaskManagerPublicationBatch(context.operationId)
          publicationBatchActive = false
        } catch (batchError) {
          console.warn('[task-manager] no se pudo cerrar el lote de publicaciÃ³n', batchError)
          if (journalActive) {
            try {
              await setTaskManagerPublicationRecovery(true)
            } catch (recoveryError) {
              console.warn('[task-manager] no se pudo marcar la recuperaciÃ³n del lote', recoveryError)
            }
          }
        }
      }
    }
  })
}
