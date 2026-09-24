import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/**
 * What belongs to the window hosting the interface, not to the backend:
 * window controls, dragging, exit, the tray exit request and the host log.
 */

/** Whether a native window (Tauri) hosts this interface; a browser has none. */
export function hasHostWindow(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export interface HostLogEntry {
  level: string
  module: string
  message: string
  data?: string
}

/** Writes a line to the log of the host process; best effort. */
export function logToHost(entry: HostLogEntry): void {
  if (!hasHostWindow()) return
  void invoke('notia_log', { payload: entry }).catch(() => {
    // The host may not offer the log (published page); ignore.
  })
}

/** Called when the tray asks the application to exit (Windows). */
export function subscribeExitRequest(handler: () => void): Promise<UnlistenFn> {
  if (!hasHostWindow()) return Promise.resolve(() => undefined)
  return listen('notia:request-app-exit', () => handler())
}

export async function controlWindow(action: NotiaWindowAction): Promise<void> {
  if (!hasHostWindow()) return
  try {
    await invoke('window_control', {
      payload: { action },
    })
  } catch {
    // Ignore window command failures and keep UI responsive.
  }
}

export async function exitApplication(): Promise<boolean> {
  if (!hasHostWindow()) return false
  try {
    await invoke('exit_application')
    return true
  } catch {
    // Keep the application usable if the native exit command is unavailable.
    return false
  }
}

export async function startWindowDragging(): Promise<void> {
  if (!hasHostWindow()) return
  try {
    await invoke('start_window_dragging')
  } catch {
    // Ignore drag start failures and keep UI responsive.
  }
}

export async function startWindowDraggingWithRestore(): Promise<void> {
  if (!hasHostWindow()) return
  try {
    await invoke('start_window_dragging_with_restore')
  } catch {
    // Ignore drag start failures and keep UI responsive.
  }
}
