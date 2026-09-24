/**
 * Single entry point from the interface to the Rust backend.
 *
 * Every command and event of the application goes through here; nothing
 * else in the interface talks to the host. The app window uses Tauri IPC; a
 * browser uses the remote transport of a headless server, and the published
 * Task Manager the transport of its publication. The bootstrap installs the
 * right one before the interface renders.
 */
import { tauriTransport } from './tauriTransport'
import type { BackendKind, BackendPlatform, BackendTransport, Unsubscribe } from './types'

export type { BackendKind, BackendPlatform, BackendTransport, Unsubscribe } from './types'

let transport: BackendTransport = tauriTransport

/** Replaces the transport; only the bootstrap calls it, before rendering. */
export function installBackendTransport(next: BackendTransport): void {
  transport = next
}

/** Runs a backend command and resolves with its result or rejects with its error. */
export function callBackend<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  return transport.call<T>(command, args)
}

/** Listens to a backend event; resolves with the function that stops listening. */
export function subscribeBackend<T = unknown>(event: string, handler: (payload: T) => void): Promise<Unsubscribe> {
  return transport.subscribe<T>(event, handler)
}

/** URL the interface can load to show a file of the library. */
export function backendFileUrl(path: string): string {
  return transport.fileUrl(path)
}

export function backendKind(): BackendKind {
  return transport.kind
}

/** Operating system of the backend (the server's, for a remote client). */
export function backendPlatform(): BackendPlatform {
  return transport.platform()
}

/** Whether the backend offers `command` here (to hide what cannot work). */
export function backendSupports(command: string): boolean {
  return transport.supports(command)
}
