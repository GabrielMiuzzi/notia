import { join } from '../../utils/files/pathUtils'
import { readTextFile, writeTextFile, createDirectory, createFile, pathExists } from '../files/filesystemEngine'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type { InkMathPreferences } from '../preferences/inkMathSettingsStorage'
import { normalizeTelegramPreferences, type TelegramPreferences } from '../preferences/telegramSettingsStorage'
import { DEFAULT_LIBRARY_CONTEXTS, ensureDefaultLibraryContexts, normalizeLibraryContexts, type LibraryContext } from '../contexts/libraryContexts'

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

interface LibraryConfigOptions {
  androidDirectoryUri?: string
}

const MAX_LLAMACLOUD_API_KEY_LENGTH = 256

/** Never store an empty/whitespace credential; the key is a secret. */
function normalizeLlamacloudCredential(value: unknown): { apiKey: string } | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const candidate = value as { apiKey?: unknown }
  if (typeof candidate.apiKey !== 'string') {
    return undefined
  }
  const apiKey = candidate.apiKey.trim()
  if (!apiKey || apiKey.length > MAX_LLAMACLOUD_API_KEY_LENGTH) {
    return undefined
  }
  return { apiKey }
}

const DEFAULT_LIBRARY_CONFIG: NotiaLibraryConfig = {
  version: 1,
  contextDefaultsVersion: 1,
  panelDesplegable: {
    refreshIntervalMs: 30000,
  },
  contexts: DEFAULT_LIBRARY_CONTEXTS.map((context) => ({ ...context })),
}

function normalizeLibraryConfig(value: unknown): NotiaLibraryConfig {
  if (!value || typeof value !== 'object') {
    return DEFAULT_LIBRARY_CONFIG
  }

  const candidate = value as Partial<NotiaLibraryConfig>
  return {
    version: typeof candidate.version === 'number' ? candidate.version : 1,
    contextDefaultsVersion: 1,
    panelDesplegable: candidate.panelDesplegable ?? DEFAULT_LIBRARY_CONFIG.panelDesplegable,
    inkMath: candidate.inkMath,
    ia: candidate.ia,
    telegram: candidate.telegram ? normalizeTelegramPreferences(candidate.telegram) : undefined,
    contexts: candidate.contextDefaultsVersion === 1
      ? normalizeLibraryContexts(candidate.contexts)
      : ensureDefaultLibraryContexts(candidate.contexts),
    llamacloud: normalizeLlamacloudCredential(candidate.llamacloud),
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
    const normalized = normalizeLibraryConfig(parsed)
    if (!parsed || typeof parsed !== 'object' || (parsed as { contextDefaultsVersion?: unknown }).contextDefaultsVersion !== 1) {
      await writeTextFile(configPath, JSON.stringify(normalized, null, 2), options)
    }
    return normalized
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
    const configExists = await libraryConfigExists(libraryPath, options)
    if (!configExists && !assumeDirectoryExists) {
      const dirResult = await createDirectory(configDir, options)
      if (!dirResult.ok) {
        return { ok: false, error: 'No se pudo crear el directorio de configuracion.' }
      }
    }
    
    const content = JSON.stringify(config, null, 2)
    const result = configExists
      ? await writeTextFile(configPath, content, options)
      : await createFile(configPath, content, options)
    
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

  // Android SAF creates the complete relative path in one native command.
  // Splitting `.notia` and the config file into separate commands forces the
  // provider to enumerate the just-created hidden directory between calls.
  if (!options?.androidDirectoryUri) {
    // If the directory already exists, createDirectory may fail; the file
    // creation below remains authoritative, as in the previous flow.
    await createDirectory(configDir, options)
  }
  const writeResult = await writeLibraryConfig(libraryPath, DEFAULT_LIBRARY_CONFIG, options, true)
  if (!writeResult.ok) {
    throw new Error(writeResult.error ?? 'No se pudo crear la configuracion de la libreria.')
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
