import { callBackend } from '../transport'

/**
 * «Modo de ejecución» of this device (`connection.rs`): Host serves its
 * library to clients; Client uses the library of a host. The backend
 * stores and applies the mode, starts the server or the link with the
 * host, and reports how they are. The interface only shows it.
 */
export type RunMode = 'host' | 'client'
export type ClientKind = 'copy' | 'remote'
export type HostLinkState = 'unknown' | 'online' | 'offline'

export interface HostServerStatus {
  listening: boolean
  port: number
  error: string | null
}

export interface HostLink {
  state: HostLinkState
  /** Library the host serves. */
  library: string | null
  /** Operating system of the host. */
  platform: string | null
  signedIn: boolean
  message: string | null
}

/** Last sync of the copy a «Con copia» client keeps. */
export interface CopyStatus {
  downloaded: number
  uploaded: number
  deleted: number
  /** Files that did not travel (too large, or the host did not give them). */
  skipped: string[]
  atMs: number
  error: string | null
}

export interface ConnectionView {
  mode: RunMode
  clientKind: ClientKind
  hostAddress: string
  /** Android has no server: it can only use its own library or a host's. */
  canHost: boolean
  server: HostServerStatus
  link: HostLink
  /** Commands a client does not offer (they only work on the host). */
  hostOnlyCommands: string[]
  /** Whether this device can keep a copy to work offline. */
  canKeepCopy: boolean
  /** Android: the copy lives in a folder the person chooses. */
  copyNeedsFolder: boolean
  /** Name of the chosen folder of the copy (Android). */
  copyFolder: string | null
  /** The window works on the copy, without the host. */
  offlineCopy: boolean
  copy: CopyStatus | null
  /** Notes are edited together with the other windows of the host. */
  collaboration: boolean
  /** Name of this device, shown to the others in a shared note. */
  deviceName: string
}

export interface OfflineCopy {
  libraryId: string
  libraryName: string
}

export interface SavedConnection {
  connection: ConnectionView
  /** The interface reloads: it reaches the backend another way now. */
  reload: boolean
}

/** Where the window of a client opens (`client_open`). */
export type ClientOpening = 'host' | 'copy' | 'offline'

export interface OpenedClient {
  opening: ClientOpening
  /** Why the host is not used, when it is not. */
  message: string | null
  connection: ConnectionView
}

export interface HostProbe {
  ok: boolean
  library: string | null
  latencyMs: number
  message: string | null
}

/** Event of the backend when the host starts or stops answering, or the session ends. */
export const HOST_LINK_EVENT = 'notia:host-link'

/** Event of the backend after each sync of the copy. */
export const COPY_SYNC_EVENT = 'notia:copy-sync'

export function fetchConnection(): Promise<ConnectionView> {
  return callBackend<ConnectionView>('connection_settings')
}

export function saveConnection(input: {
  mode: RunMode
  clientKind: ClientKind
  hostAddress: string
  trustNewCertificate?: boolean
}): Promise<SavedConnection> {
  return callBackend<SavedConnection>('save_connection_settings', { payload: input })
}

/** «Probar conexión»: the saved host, or `hostAddress` before saving it. */
export function testHostConnection(hostAddress?: string): Promise<HostProbe> {
  return callBackend<HostProbe>('test_host_connection', { payload: hostAddress ? { hostAddress } : {} })
}

/**
 * Opens the window of a client: the host when it answers; otherwise its
 * copy, at once when the copy is ready. The copy syncs in the background.
 */
export function openClient(): Promise<OpenedClient> {
  return callBackend<OpenedClient>('client_open')
}

/** Android: picks the folder of the copy (empty, or an earlier copy). */
export function pickCopyFolder(): Promise<ConnectionView> {
  return callBackend<ConnectionView>('pick_copy_folder')
}

/** Opens the copy as a library of this device while the host does not answer. */
export function enterOfflineCopy(): Promise<OfflineCopy> {
  return callBackend<OfflineCopy>('enter_offline_copy')
}

/** Back to the host; the next sync reconciles what changed meanwhile. */
export function leaveOfflineCopy(): Promise<void> {
  return callBackend<void>('leave_offline_copy')
}

/** Syncs the copy now (the last modified file wins on both sides). */
export function syncCopyNow(): Promise<CopyStatus> {
  return callBackend<CopyStatus>('sync_copy_now')
}
