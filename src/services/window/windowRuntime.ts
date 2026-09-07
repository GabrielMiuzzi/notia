import { invoke } from '@tauri-apps/api/core'

export async function controlWindow(action: NotiaWindowAction): Promise<void> {
  try {
    await invoke('window_control', {
      payload: { action },
    })
  } catch {
    // Ignore window command failures and keep UI responsive.
  }
}

export async function exitApplication(): Promise<boolean> {
  try {
    await invoke('exit_application')
    return true
  } catch {
    // Keep the application usable if the native exit command is unavailable.
    return false
  }
}

export async function startWindowDragging(): Promise<void> {
  try {
    await invoke('start_window_dragging')
  } catch {
    // Ignore drag start failures and keep UI responsive.
  }
}

export async function startWindowDraggingWithRestore(): Promise<void> {
  try {
    await invoke('start_window_dragging_with_restore')
  } catch {
    // Ignore drag start failures and keep UI responsive.
  }
}
