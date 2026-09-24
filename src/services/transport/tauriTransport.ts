import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import type { BackendPlatform, BackendTransport } from './types'

/** Command of the Tauri host that forwards every call to the backend registry. */
export const APP_INVOKE_COMMAND = 'app_invoke'

function encodePathSegments(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function toFallbackFileUrl(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')

  if (/^[A-Za-z]:\//.test(normalizedPath)) {
    const drivePrefix = normalizedPath.slice(0, 2)
    const drivePath = normalizedPath.slice(2)
    return `file:///${drivePrefix}${encodePathSegments(drivePath)}`
  }

  if (normalizedPath.startsWith('/')) {
    return `file://${encodePathSegments(normalizedPath)}`
  }

  return `file://${encodePathSegments(`/${normalizedPath}`)}`
}

const PLATFORM_BY_DEVICE: Record<ReturnType<typeof getRuntimeDevice>, BackendPlatform> = {
  Windows: 'windows',
  Linux: 'linux',
  Android: 'android',
  macOS: 'macos',
  Unknown: 'unknown',
}

/** Backend running in the same process, reached through Tauri IPC. */
export const tauriTransport: BackendTransport = {
  kind: 'local',
  // The backend runs on this same device.
  platform: () => PLATFORM_BY_DEVICE[getRuntimeDevice()],
  call: <T>(command: string, args?: Record<string, unknown>) =>
    invoke<T>(APP_INVOKE_COMMAND, { command, args: args ?? {} }),
  subscribe: <T>(event: string, handler: (payload: T) => void) =>
    listen<T>(event, (message) => handler(message.payload)),
  fileUrl: (path: string) => {
    try {
      return convertFileSrc(path)
    } catch {
      return toFallbackFileUrl(path)
    }
  },
  supports: () => true,
}
