import { callBackend } from '../../../services/transport'

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

/**
 * Publishes the boards chosen in the device preferences. The backend builds
 * what is served from the Task Manager store (`task_manager_publication_source.rs`)
 * and announces every later change to the published clients itself.
 */
export async function publishTaskManagerBoards(libraryId: string, theme: 'dark' | 'light'): Promise<string> {
  return callBackend<string>('backend_publish_task_manager', { payload: { libraryId, theme } })
}

export async function getTaskManagerPublicationUrl(): Promise<string> {
  return callBackend<string>('get_task_manager_publication_url')
}

export async function getTaskManagerPublicationStatus(): Promise<TaskManagerPublicationStatusSnapshot> {
  return callBackend<TaskManagerPublicationStatusSnapshot>('get_task_manager_publication_status')
}

export async function openTaskManagerPublication(): Promise<void> {
  await callBackend('open_task_manager_publication')
}

export async function stopTaskManagerPublication(): Promise<void> {
  await callBackend('stop_task_manager_publication')
}
