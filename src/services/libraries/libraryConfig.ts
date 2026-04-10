import { join } from '../../utils/files/pathUtils'
import { readTextFile, writeTextFile, createDirectory, pathExists } from '../files/filesystemEngine'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type { InkdocPreferences } from '../preferences/inkdocSettingsStorage'

const NOTIA_CONFIG_DIR = '.notia'
const NOTIA_CONFIG_FILE = 'notiaConfig.json'

export interface NotiaLibraryConfig {
  version: number
  panelDesplegable?: {
    refreshIntervalMs: number
  }
  inkdocs?: InkdocPreferences
  ia?: AiPreferences
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
    inkdocs: candidate.inkdocs,
    ia: candidate.ia,
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
): Promise<{ ok: boolean; error?: string }> {
  const configDir = getLibraryConfigDir(libraryPath)
  const configPath = getLibraryConfigPath(libraryPath)
  
  try {
    // Check if config already exists - if so, just update the file
    const exists = await libraryConfigExists(libraryPath, options)
    if (!exists) {
      // Only create directory if it doesn't exist
      const dirResult = await createDirectory(configDir, options)
      if (!dirResult.ok) {
        return { ok: false, error: 'No se pudo crear el directorio de configuracion.' }
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
  const exists = await libraryConfigExists(libraryPath, options)
  if (!exists) {
    await writeLibraryConfig(libraryPath, DEFAULT_LIBRARY_CONFIG, options)
  }
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
