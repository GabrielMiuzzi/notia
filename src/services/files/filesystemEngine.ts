import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'

export interface FilesystemOperationResult {
  ok: boolean
  error?: string
}

export interface FilesystemReadTextResult extends FilesystemOperationResult {
  content: string
}

export interface FilesystemMarkdownDocument {
  path: string
  content: string
}

export interface FilesystemTreeNode {
  id: string
  name: string
  path?: string
  type: 'folder' | 'file'
  expanded?: boolean
  children?: FilesystemTreeNode[]
}

export interface FilesystemPickDirectoryResult {
  path: string
  uri?: string
}

export type FilesystemCreateEntryKind = 'folder' | 'note' | 'inkdoc'
export type FilesystemEntryOperationMode = 'copy' | 'move'

export interface FilesystemEntryOperationPayload {
  action: 'delete' | 'rename' | 'paste'
  targetPath?: string
  newName?: string
  sourcePath?: string
  targetDirectoryPath?: string
  mode?: FilesystemEntryOperationMode
}

interface SearchLibraryFilesResult {
  paths: string[]
}

interface PathExistsResult {
  exists: boolean
}

interface IsDirectoryPathResult {
  isDirectory: boolean
}

interface ReadLibraryTreeOptions {
  androidDirectoryUri?: string
}

interface CreateLibraryEntryOptions {
  androidDirectoryUri?: string
}

const ANDROID_PICK_DIRECTORY_COMMANDS = [
  'pick_android_directory_tree',
  'mobile_directory_picker::pick_android_directory_tree',
] as const

function normalizePath(pathValue: string): string {
  return normalizeFilesystemPath(pathValue)
}

function resolveParentDirectoryPath(pathValue: string): string {
  const normalized = pathValue.replace(/[\\/]+$/, '')
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (separatorIndex <= 0) {
    return normalized
  }

  return normalized.slice(0, separatorIndex)
}

function normalizeDirectorySelection(value: unknown): FilesystemPickDirectoryResult | null {
  if (typeof value === 'string') {
    const normalizedPath = normalizePath(value)
    if (!normalizedPath.trim()) {
      return null
    }
    return { path: normalizedPath }
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as { path?: unknown; uri?: unknown }
  if (typeof candidate.path !== 'string' || !candidate.path.trim()) {
    return null
  }

  const normalizedPath = normalizePath(candidate.path)
  const uri = typeof candidate.uri === 'string' && candidate.uri.trim()
    ? candidate.uri
    : undefined

  return {
    path: normalizedPath,
    uri,
  }
}

export function normalizeFilesystemTreeNodes(value: unknown): FilesystemTreeNode[] {
  if (!Array.isArray(value)) {
    return []
  }

  const nodes: FilesystemTreeNode[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const candidate = item as FilesystemTreeNode
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || (candidate.type !== 'folder' && candidate.type !== 'file')
    ) {
      continue
    }

    nodes.push({
      id: candidate.id,
      name: candidate.name,
      path: typeof candidate.path === 'string' ? normalizePath(candidate.path) : undefined,
      type: candidate.type,
      expanded: candidate.type === 'folder' ? Boolean(candidate.expanded) : undefined,
      children: candidate.type === 'folder'
        ? normalizeFilesystemTreeNodes(candidate.children ?? [])
        : undefined,
    })
  }

  return nodes
}

export function getPathBaseName(pathValue: string): string {
  const normalized = normalizePath(pathValue).replace(/[\\/]+$/, '')
  if (!normalized) {
    return pathValue
  }

  const segments = normalized.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? pathValue
}

export async function isDirectoryPath(pathValue: string): Promise<boolean> {
  const normalizedPath = normalizePath(pathValue)
  if (!normalizedPath.trim()) {
    return false
  }

  try {
    const result = await invoke<IsDirectoryPathResult>('is_directory_path', {
      payload: { path: normalizedPath },
    })
    return Boolean(result.isDirectory)
  } catch {
    return false
  }
}

export async function pathExists(pathValue: string): Promise<boolean> {
  const normalizedPath = normalizePath(pathValue)
  if (!normalizedPath.trim()) {
    return false
  }

  try {
    const result = await invoke<PathExistsResult>('path_exists', {
      payload: { path: normalizedPath },
    })
    return Boolean(result.exists)
  } catch {
    return false
  }
}

async function resolveDirectoryFromSelection(selectedPath: string): Promise<string | null> {
  const normalizedPath = normalizePath(selectedPath)
  if (!normalizedPath.trim()) {
    return null
  }

  if (await isDirectoryPath(normalizedPath)) {
    return normalizedPath
  }

  const parentPath = resolveParentDirectoryPath(normalizedPath)
  if (!parentPath || parentPath === normalizedPath) {
    return null
  }

  return (await isDirectoryPath(parentPath)) ? parentPath : null
}

async function pickAndroidDirectory(): Promise<FilesystemPickDirectoryResult | null> {
  let fallbackError: unknown = null

  for (const command of ANDROID_PICK_DIRECTORY_COMMANDS) {
    try {
      const selected = await invoke<unknown>(command)
      return normalizeDirectorySelection(selected)
    } catch (error) {
      fallbackError = error
    }
  }

  if (fallbackError) {
    throw fallbackError
  }

  return null
}

export async function pickDirectory(title: string): Promise<FilesystemPickDirectoryResult | null> {
  if (getRuntimeDevice() === 'Android') {
    try {
      return await pickAndroidDirectory()
    } catch (error) {
      if (
        error instanceof Error
        && (
          error.message.includes('command pick_android_directory_tree not found')
          || error.message.includes('command mobile_directory_picker::pick_android_directory_tree not found')
        )
      ) {
        throw new Error('El backend Android esta desactualizado. Recompila e instala la app nuevamente.')
      }
      if (error instanceof Error && error.message.trim()) {
        throw new Error(error.message)
      }
      throw new Error(String(error))
    }
  }

  let selectedPath: string | string[] | null = null
  try {
    selectedPath = await open({
      directory: true,
      multiple: false,
      pickerMode: 'document',
      title,
    })
  } catch {
    selectedPath = await open({
      directory: false,
      multiple: false,
      pickerMode: 'document',
      title,
    })
  }

  if (typeof selectedPath !== 'string' || !selectedPath.trim()) {
    return null
  }

  const resolvedPath = await resolveDirectoryFromSelection(selectedPath)
  if (!resolvedPath) {
    return null
  }

  return { path: resolvedPath }
}

export async function readLibraryTree(
  directoryPath: string,
  options?: ReadLibraryTreeOptions,
): Promise<FilesystemTreeNode[]> {
  const normalizedDirectoryPath = normalizePath(directoryPath)
  if (!normalizedDirectoryPath.trim()) {
    return []
  }

  try {
    if (getRuntimeDevice() === 'Android') {
      const rawTree = await invoke<unknown>('read_android_library_tree', {
        payload: {
          directoryPath: normalizedDirectoryPath,
          directoryUri: options?.androidDirectoryUri,
        },
      })
      return normalizeFilesystemTreeNodes(rawTree)
    }

    const rawTree = await invoke<unknown>('read_library_tree', {
      payload: { directoryPath: normalizedDirectoryPath },
    })
    return normalizeFilesystemTreeNodes(rawTree)
  } catch {
    return []
  }
}

export async function searchLibraryFiles(
  directoryPath: string,
  query: string,
): Promise<string[]> {
  const normalizedDirectoryPath = normalizePath(directoryPath)
  const normalizedQuery = query.trim()
  if (!normalizedDirectoryPath.trim() || !normalizedQuery) {
    return []
  }

  try {
    const result = await invoke<SearchLibraryFilesResult>('search_library_files', {
      payload: {
        directoryPath: normalizedDirectoryPath,
        query: normalizedQuery,
      },
    })

    if (!result || !Array.isArray(result.paths)) {
      return []
    }

    return result.paths
      .filter((pathValue): pathValue is string => typeof pathValue === 'string')
      .map((pathValue) => normalizePath(pathValue))
  } catch {
    return []
  }
}

export async function readMarkdownDocuments(
  directoryPath: string,
): Promise<FilesystemMarkdownDocument[]> {
  const normalizedDirectoryPath = normalizePath(directoryPath)
  if (!normalizedDirectoryPath.trim()) {
    return []
  }

  try {
    const response = await invoke<FilesystemMarkdownDocument[]>('read_markdown_files', {
      payload: { directoryPath: normalizedDirectoryPath },
    })
    if (!Array.isArray(response)) {
      return []
    }

    return response.filter((item): item is FilesystemMarkdownDocument => (
      Boolean(item)
      && typeof item.path === 'string'
      && typeof item.content === 'string'
    )).map((item) => ({
      path: normalizePath(item.path),
      content: item.content,
    }))
  } catch {
    return []
  }
}

export async function readTextFile(filePath: string): Promise<FilesystemReadTextResult> {
  const normalizedPath = normalizePath(filePath)
  if (!normalizedPath.trim()) {
    return { ok: false, content: '', error: 'Invalid file path.' }
  }

  try {
    return await invoke<FilesystemReadTextResult>('read_library_file', {
      payload: { filePath: normalizedPath },
    })
  } catch {
    return { ok: false, content: '', error: 'Could not read file.' }
  }
}

export async function writeTextFile(
  filePath: string,
  content: string,
): Promise<FilesystemOperationResult> {
  const normalizedPath = normalizePath(filePath)
  if (!normalizedPath.trim()) {
    return { ok: false, error: 'Invalid file data.' }
  }

  try {
    return await invoke<FilesystemOperationResult>('write_library_file', {
      payload: { filePath: normalizedPath, content },
    })
  } catch {
    return { ok: false, error: 'Could not write file.' }
  }
}

export async function createLibraryEntry(
  directoryPath: string,
  name: string,
  kind: FilesystemCreateEntryKind,
  options?: CreateLibraryEntryOptions,
): Promise<FilesystemOperationResult> {
  const normalizedDirectoryPath = normalizePath(directoryPath)
  if (!normalizedDirectoryPath.trim()) {
    return { ok: false, error: 'Invalid entry data.' }
  }

  try {
    return await invoke<FilesystemOperationResult>('create_library_entry', {
      payload: {
        directoryPath: normalizedDirectoryPath,
        directoryUri: options?.androidDirectoryUri,
        name,
        kind,
      },
    })
  } catch {
    return { ok: false, error: 'Could not create entry.' }
  }
}

export async function createFile(
  filePath: string,
  content: string,
): Promise<FilesystemOperationResult> {
  const normalizedPath = normalizePath(filePath)
  if (!normalizedPath.trim()) {
    return { ok: false, error: 'Invalid file data.' }
  }

  try {
    return await invoke<FilesystemOperationResult>('create_library_file', {
      payload: {
        filePath: normalizedPath,
        content,
      },
    })
  } catch {
    return { ok: false, error: 'Could not create file.' }
  }
}

export async function createDirectory(
  directoryPath: string,
): Promise<FilesystemOperationResult> {
  const normalizedPath = normalizePath(directoryPath)
  if (!normalizedPath.trim()) {
    return { ok: false, error: 'Invalid directory data.' }
  }

  try {
    return await invoke<FilesystemOperationResult>('create_library_directory', {
      payload: {
        directoryPath: normalizedPath,
      },
    })
  } catch {
    return { ok: false, error: 'Could not create directory.' }
  }
}

export async function writeBinaryFile(
  filePath: string,
  data: Uint8Array,
): Promise<FilesystemOperationResult> {
  const normalizedPath = normalizePath(filePath)
  if (!normalizedPath.trim()) {
    return { ok: false, error: 'Invalid file data.' }
  }

  try {
    return await invoke<FilesystemOperationResult>('write_binary_file', {
      payload: {
        filePath: normalizedPath,
        data: Array.from(data),
      },
    })
  } catch {
    return { ok: false, error: 'Could not write file.' }
  }
}

export async function performLibraryEntryOperation(
  payload: FilesystemEntryOperationPayload,
): Promise<FilesystemOperationResult> {
  const normalizedPayload: FilesystemEntryOperationPayload = {
    ...payload,
    targetPath: payload.targetPath ? normalizePath(payload.targetPath) : payload.targetPath,
    sourcePath: payload.sourcePath ? normalizePath(payload.sourcePath) : payload.sourcePath,
    targetDirectoryPath: payload.targetDirectoryPath
      ? normalizePath(payload.targetDirectoryPath)
      : payload.targetDirectoryPath,
  }

  try {
    return await invoke<FilesystemOperationResult>('library_entry_operation', {
      payload: normalizedPayload,
    })
  } catch {
    return { ok: false, error: 'Could not perform operation.' }
  }
}
