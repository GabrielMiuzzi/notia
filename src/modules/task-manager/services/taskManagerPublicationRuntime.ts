import { invoke } from '@tauri-apps/api/core'
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
  port: number
  aiPreferences: AiPreferences
  settings: TaskManagerSettings
  boards: PublishedTaskManagerBoard[]
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
): TaskManagerPublicationPayload {
  const allowedBoardNames = new Set(publishedBoardNames.map((name) => name.trim().toLowerCase()))
  const isPublishedBoard = (boardName: string | undefined): boolean => allowedBoardNames.has(boardName?.trim().toLowerCase() ?? 'default')
  return {
    vaultPath,
    theme,
    passwordHash,
    approvedDevices,
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
export async function listPendingTaskManagerPublicationDevices(): Promise<PublishedTaskManagerDevice[]> { return invoke('list_pending_task_manager_publication_devices') }
export async function approveTaskManagerPublicationDevice(deviceId: string): Promise<PublishedTaskManagerDevice> { return invoke('approve_task_manager_publication_device', { deviceId }) }
export async function revokeTaskManagerPublicationDevice(deviceId: string): Promise<void> { await invoke('revoke_task_manager_publication_device', { deviceId }) }

export async function openTaskManagerPublication(): Promise<void> {
  await invoke('open_task_manager_publication')
}

export async function stopTaskManagerPublication(): Promise<void> {
  await invoke('stop_task_manager_publication')
}

export async function notifyTaskManagerPublicationChanged(vaultPath: string): Promise<void> {
  if (typeof window !== 'undefined' && window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
    return
  }
  await invoke('notify_task_manager_publication_changed', { vaultPath })
}
