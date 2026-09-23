import { invoke } from '@tauri-apps/api/core'
import { join } from '../../utils/files/pathUtils'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type { InkMathPreferences } from '../preferences/inkMathSettingsStorage'
import type { TelegramPreferences } from '../preferences/telegramSettingsStorage'
import type { LibraryContext } from '../contexts/libraryContexts'

const NOTIA_CONFIG_DIR = '.notia'
const NOTIA_CONFIG_FILE = 'notiaConfig.json'

export interface NotiaLibraryConfig {
  version: number
  contextDefaultsVersion?: number
  panelDesplegable?: {
    refreshIntervalMs: number
  }
  inkMath?: InkMathPreferences
  ia?: AiPreferences
  telegram?: TelegramPreferences
  contexts?: LibraryContext[]
  /** LlamaCloud credential for finance document extraction, normalized per library. */
  llamacloud?: {
    apiKey: string
  }
}

interface LibraryConfigResult {
  ok: boolean
  config?: NotiaLibraryConfig | null
  error?: string | null
}

export function getLibraryConfigPath(libraryPath: string): string {
  return join(libraryPath, NOTIA_CONFIG_DIR, NOTIA_CONFIG_FILE)
}

export function getLibraryConfigDir(libraryPath: string): string {
  return join(libraryPath, NOTIA_CONFIG_DIR)
}

async function invokeLibraryConfig(
  command: 'backend_read_library_config' | 'backend_write_library_config' | 'backend_ensure_library_config',
  libraryId: string,
  config?: NotiaLibraryConfig,
): Promise<LibraryConfigResult> {
  try {
    return await invoke<LibraryConfigResult>(command, {
      payload: { libraryId, ...(config ? { config } : {}) },
    })
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo acceder a la configuracion de la biblioteca.',
    }
  }
}

/**
 * Reads the library configuration normalized by the backend. Returns `null`
 * when the library has none yet or it cannot be read.
 */
export async function readLibraryConfig(libraryId: string): Promise<NotiaLibraryConfig | null> {
  const result = await invokeLibraryConfig('backend_read_library_config', libraryId)
  return result.ok ? result.config ?? null : null
}

/** Stores the configuration; the backend normalizes it before persisting. */
export async function writeLibraryConfig(
  libraryId: string,
  config: NotiaLibraryConfig,
): Promise<{ ok: boolean; error?: string }> {
  const result = await invokeLibraryConfig('backend_write_library_config', libraryId, config)
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'Error al escribir configuracion.' }
}

/** Creates the default configuration when the library has none. */
export async function ensureLibraryConfigExists(libraryId: string): Promise<void> {
  const result = await invokeLibraryConfig('backend_ensure_library_config', libraryId)
  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo crear la configuracion de la libreria.')
  }
}
