import { convertFileSrc } from '@tauri-apps/api/core'
import { tauriTransport } from './tauriTransport'
import type { BackendPlatform, BackendTransport } from './types'

/** Scheme of the window that serves the files of the host's library. */
const HOST_FILE_SCHEME = 'notiahost'

const KNOWN_PLATFORMS: BackendPlatform[] = ['windows', 'linux', 'android', 'macos']

export interface HostTransportOptions {
  /** Operating system of the host (`/api/health`). */
  hostPlatform: string | null
  /** Commands a client does not offer. */
  hostOnlyCommands: string[]
}

/**
 * Backend of a client window: the same Tauri IPC, but the backend of this
 * device runs the commands on its host. It is `remote` for the interface:
 * dictation sends the recorded audio (the host recognizes it) and what
 * only works on the host's device is hidden. Files come through the
 * `notiahost` scheme, which the backend fetches from the host.
 */
export function createHostTransport(options: HostTransportOptions): BackendTransport {
  const hidden = new Set(options.hostOnlyCommands)
  const platform = KNOWN_PLATFORMS.find((known) => known === options.hostPlatform) ?? 'unknown'
  return {
    ...tauriTransport,
    kind: 'remote',
    platform: () => platform,
    fileUrl: (path: string) => convertFileSrc(path, HOST_FILE_SCHEME),
    supports: (command: string) => !hidden.has(command),
  }
}
