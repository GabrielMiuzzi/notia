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

export async function startWindowDragging(): Promise<void> {
  try {
    await invoke('start_window_dragging')
  } catch {
    // Ignore drag start failures and keep UI responsive.
  }
}
