import { join } from '../../utils/files/pathUtils'
import { readTextFile, writeTextFile, createDirectory, pathExists } from '../files/filesystemEngine'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type { InkMathPreferences } from '../preferences/inkMathSettingsStorage'
import { normalizeTelegramPreferences, type TelegramPreferences } from '../preferences/telegramSettingsStorage'

const NOTIA_CONFIG_DIR = '.notia'
const NOTIA_CONFIG_FILE = 'notiaConfig.json'

export interface NotiaLibraryConfig {
  version: number
  panelDesplegable?: {
    refreshIntervalMs: number
  }
  inkMath?: InkMathPreferences
  ia?: AiPreferences
  telegram?: TelegramPreferences
}

interface LibraryConfigOptions {
  androidDirectoryUri?: string
}

const DEFAULT_LIBRARY_CONFIG: NotiaLibraryConfig = {
  version: 1,
  panelDesplegable: {
    refreshIntervalMs: 30000,
  },
}

function normalizeLibraryConfig(value: unknown): NotiaLibraryConfig {
  if (!value || typeof value !== 'object') {
    return DEFAULT_LIBRARY_CONFIG
  }

  const candidate = value as Partial<NotiaLibraryConfig>
  return {
    version: typeof candidate.version === 'number' ? candidate.version : 1,
    panelDesplegable: candidate.panelDesplegable ?? DEFAULT_LIBRARY_CONFIG.panelDesplegable,
    inkMath: candidate.inkMath,
    ia: candidate.ia,
    telegram: candidate.telegram ? normalizeTelegramPreferences(candidate.telegram) : undefined,
  }
}

export function getLibraryConfigPath(libraryPath: string): string {
  return join(libraryPath, NOTIA_CONFIG_DIR, NOTIA_CONFIG_FILE)
}

export function getLibraryConfigDir(libraryPath: string): string {
  return join(libraryPath, NOTIA_CONFIG_DIR)
}

export async function libraryConfigExists(
  libraryPath: string,
  options?: LibraryConfigOptions,
): Promise<boolean> {
  const configPath = getLibraryConfigPath(libraryPath)
  return pathExists(configPath, options)
}

export async function readLibraryConfig(
  libraryPath: string,
  options?: LibraryConfigOptions,
): Promise<NotiaLibraryConfig | null> {
  const configPath = getLibraryConfigPath(libraryPath)
  
  try {
    const result = await readTextFile(configPath, options)
    if (!result.ok) {
      return null
    }
    
    const parsed = JSON.parse(result.content)
    return normalizeLibraryConfig(parsed)
  } catch {
    return null
  }
}

export async function writeLibraryConfig(
  libraryPath: string,
  config: NotiaLibraryConfig,
  options?: LibraryConfigOptions,
  assumeDirectoryExists?: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const configDir = getLibraryConfigDir(libraryPath)
  const configPath = getLibraryConfigPath(libraryPath)
  
  try {
    // Only check for directory existence if the caller hasn't confirmed it.
    // When called from ensureLibraryConfigExists, the directory is created
    // in the same flow, so we can skip the redundant pathExists check.
    if (!assumeDirectoryExists) {
      const exists = await libraryConfigExists(libraryPath, options)
      if (!exists) {
        const dirResult = await createDirectory(configDir, options)
        if (!dirResult.ok) {
          return { ok: false, error: 'No se pudo crear el directorio de configuracion.' }
        }
      }
    }
    
    const content = JSON.stringify(config, null, 2)
    const result = await writeTextFile(configPath, content, options)
    
    return result
  } catch (error) {
    return { 
      ok: false, 
      error: error instanceof Error ? error.message : 'Error al escribir configuracion.' 
    }
  }
}

export async function ensureLibraryConfigExists(
  libraryPath: string,
  options?: LibraryConfigOptions,
): Promise<void> {
  const configDir = getLibraryConfigDir(libraryPath)

  // Try to read the config file directly. If it exists, we are done.
  // This avoids a separate pathExists call that would trigger a full
  // SAF tree cache refresh on Android.
  const existingConfig = await readLibraryConfig(libraryPath, options)
  if (existingConfig) {
    return
  }

  // Config file does not exist — create the directory first, then write
  // the default config. We pass assumeDirectoryExists=true because we
  // just created the directory in the line above.
  const dirResult = await createDirectory(configDir, options)
  if (!dirResult.ok) {
    // If the directory already exists, createDirectory may fail — try
    // to write the config file anyway.
  }
  await writeLibraryConfig(libraryPath, DEFAULT_LIBRARY_CONFIG, options, true)
}

export async function updateLibraryConfig(
  libraryPath: string,
  updates: Partial<NotiaLibraryConfig>,
  options?: LibraryConfigOptions,
): Promise<{ ok: boolean; error?: string }> {
  const currentConfig = await readLibraryConfig(libraryPath, options)
  const newConfig: NotiaLibraryConfig = {
    ...DEFAULT_LIBRARY_CONFIG,
    ...currentConfig,
    ...updates,
    version: 1,
  }
  
  return writeLibraryConfig(libraryPath, newConfig, options)
}
