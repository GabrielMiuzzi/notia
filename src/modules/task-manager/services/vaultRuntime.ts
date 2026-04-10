import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'
import { getRuntimeDevice } from '../../../utils/platform/getRuntimeDevice'
import {
  createLibraryEntry,
  getPathBaseName,
  isDirectoryPath,
  performLibraryEntryOperation,
  pathExists,
  pickDirectory,
  readLibraryTree,
  readMarkdownDocuments,
  readTextFile,
  writeTextFile,
  type FilesystemTreeNode,
  type FilesystemMarkdownDocument,
  type FilesystemOperationResult,
  type FilesystemReadTextResult,
} from '../../../services/files/filesystemEngine'
import { dispatchLibraryTreeChanged } from '../../../services/libraries/libraryTreeEvents'
import type { TaskManagerVaultRef } from '../types/taskManagerTypes'

type OperationResult = FilesystemOperationResult
type ReadLibraryFileResult = FilesystemReadTextResult
type WriteLibraryFileResult = FilesystemOperationResult
type MarkdownFileDocument = FilesystemMarkdownDocument

let activeTaskManagerVaultRef: TaskManagerVaultRef | null = null

function normalizeVaultRef(vault: TaskManagerVaultRef | null): TaskManagerVaultRef | null {
  if (!vault?.path.trim()) {
    return null
  }

  return {
    path: normalizeFilesystemPath(vault.path),
    androidTreeUri: typeof vault.androidTreeUri === 'string' && vault.androidTreeUri.trim()
      ? vault.androidTreeUri
      : undefined,
  }
}

function resolveAndroidDirectoryUri(pathValue: string): string | undefined {
  const vaultRef = activeTaskManagerVaultRef
  if (!vaultRef?.androidTreeUri) {
    return undefined
  }

  const normalizedPath = normalizeFilesystemPath(pathValue)
  const normalizedVaultPath = normalizeFilesystemPath(vaultRef.path).replace(/[\\/]+$/, '')
  if (normalizedPath === normalizedVaultPath || normalizedPath.startsWith(`${normalizedVaultPath}/`)) {
    return vaultRef.androidTreeUri
  }

  return undefined
}

function isNestedPath(basePath: string, candidatePath: string): boolean {
  const normalizedBasePath = normalizeFilesystemPath(basePath).replace(/[\\/]+$/, '')
  const normalizedCandidatePath = normalizeFilesystemPath(candidatePath)
  return normalizedCandidatePath === normalizedBasePath
    || normalizedCandidatePath.startsWith(`${normalizedBasePath}/`)
}

function collectMarkdownPathsFromTree(
  nodes: FilesystemTreeNode[],
  target: string[],
): void {
  for (const node of nodes) {
    if (node.type === 'file' && node.path && node.path.toLowerCase().endsWith('.md')) {
      target.push(node.path)
      continue
    }

    if (node.children && node.children.length > 0) {
      collectMarkdownPathsFromTree(node.children, target)
    }
  }
}

export function setActiveTaskManagerVaultContext(vault: TaskManagerVaultRef | null): void {
  activeTaskManagerVaultRef = normalizeVaultRef(vault)
}

function notifyLibraryTreeChanged(pathHint: string) {
  dispatchLibraryTreeChanged({
    pathHint: normalizeFilesystemPath(pathHint),
  })
}

export async function pickVaultDirectory(): Promise<TaskManagerVaultRef & { name: string } | null> {
  try {
    const selected = await pickDirectory('Seleccionar vault')
    if (!selected) {
      return null
    }

    const normalizedPath = normalizeFilesystemPath(selected.path)
    const name = getPathBaseName(normalizedPath)
    return {
      path: normalizedPath,
      name,
      androidTreeUri: typeof selected.uri === 'string' && selected.uri.trim()
        ? selected.uri
        : undefined,
    }
  } catch (error) {
    console.error('[task-manager] pick vault directory failed', error)
    return null
  }
}

export async function readMarkdownFiles(directoryPath: string): Promise<MarkdownFileDocument[]> {
  if (!directoryPath.trim()) {
    return []
  }

  try {
    if (getRuntimeDevice() === 'Android') {
      const vaultRef = activeTaskManagerVaultRef
      if (vaultRef && isNestedPath(vaultRef.path, directoryPath)) {
        const rootTree = await readLibraryTree(vaultRef.path, {
          androidDirectoryUri: vaultRef.androidTreeUri,
        })
        const markdownPaths = new Set<string>()

        if (normalizeFilesystemPath(directoryPath).replace(/[\\/]+$/, '') === normalizeFilesystemPath(vaultRef.path).replace(/[\\/]+$/, '')) {
          const collectedRootMarkdownPaths: string[] = []
          collectMarkdownPathsFromTree(rootTree, collectedRootMarkdownPaths)
          for (const filePath of collectedRootMarkdownPaths) {
            markdownPaths.add(filePath)
          }
        } else {
          const stack = [...rootTree]
          while (stack.length > 0) {
            const node = stack.pop()
            if (!node) {
              continue
            }

            if (node.path && isNestedPath(directoryPath, node.path)) {
              if (node.type === 'file' && node.path.toLowerCase().endsWith('.md')) {
                markdownPaths.add(node.path)
              }

              if (node.children && node.children.length > 0) {
                for (const child of node.children) {
                  stack.push(child)
                }
              }
              continue
            }

            if (node.children && node.children.length > 0) {
              for (const child of node.children) {
                stack.push(child)
              }
            }
          }
        }

        const documents = await Promise.all(
          Array.from(markdownPaths)
            .sort((left, right) => left.localeCompare(right, 'es'))
            .map(async (filePath) => {
              const result = await readTextFile(filePath, {
                androidDirectoryUri: resolveAndroidDirectoryUri(filePath),
              })
              if (!result.ok) {
                return null
              }

              return {
                path: normalizeFilesystemPath(filePath),
                content: result.content,
              } satisfies MarkdownFileDocument
            }),
        )

        return documents.filter((document): document is MarkdownFileDocument => Boolean(document))
      }
    }

    return await readMarkdownDocuments(normalizeFilesystemPath(directoryPath))
  } catch (error) {
    console.error('[task-manager] read_markdown_files failed', error)
    return []
  }
}

export async function directoryExists(directoryPath: string): Promise<boolean> {
  const normalizedPath = normalizeFilesystemPath(directoryPath)
  if (!normalizedPath.trim()) {
    return false
  }

  try {
    const exists = await pathExists(normalizedPath, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
    })
    if (!exists) {
      return false
    }

    return await isDirectoryPath(normalizedPath, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
    })
  } catch (error) {
    console.error('[task-manager] directory_exists failed', error)
    return false
  }
}

export async function readFileContent(filePath: string): Promise<ReadLibraryFileResult> {
  const normalizedPath = normalizeFilesystemPath(filePath)

  try {
    const result = await readTextFile(normalizedPath, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
    })
    if (result.ok || result.error) {
      return result
    }
    return { ...result, error: 'No se pudo leer el archivo.' }
  } catch (error) {
    console.error('[task-manager] read_library_file failed', error)
    return { ok: false, content: '', error: 'No se pudo leer el archivo.' }
  }
}

export async function writeFileContent(filePath: string, content: string): Promise<WriteLibraryFileResult> {
  const normalizedPath = normalizeFilesystemPath(filePath)

  try {
    const result = await writeTextFile(normalizedPath, content, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
    })
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedPath)
    }
    if (result.ok || result.error) {
      return result
    }
    return { ...result, error: 'No se pudo escribir el archivo.' }
  } catch (error) {
    console.error('[task-manager] write_library_file failed', error)
    return { ok: false, error: 'No se pudo escribir el archivo.' }
  }
}

export async function createFolder(parentDirectoryPath: string, name: string): Promise<OperationResult> {
  try {
    const result = await createLibraryEntry(
      normalizeFilesystemPath(parentDirectoryPath),
      name,
      'folder',
      {
        androidDirectoryUri: resolveAndroidDirectoryUri(parentDirectoryPath),
      },
    )
    if (result.ok) {
      notifyLibraryTreeChanged(`${parentDirectoryPath}/${name}`)
    }
    return result
  } catch (error) {
    console.error('[task-manager] create_library_entry(folder) failed', error)
    return { ok: false, error: 'No se pudo crear la carpeta.' }
  }
}

export async function createMarkdownFile(parentDirectoryPath: string, fileName: string): Promise<OperationResult> {
  try {
    const result = await createLibraryEntry(
      normalizeFilesystemPath(parentDirectoryPath),
      fileName,
      'note',
      {
        androidDirectoryUri: resolveAndroidDirectoryUri(parentDirectoryPath),
      },
    )
    if (result.ok) {
      notifyLibraryTreeChanged(`${parentDirectoryPath}/${fileName}`)
    }
    return result
  } catch (error) {
    console.error('[task-manager] create_library_entry(note) failed', error)
    return { ok: false, error: 'No se pudo crear el archivo.' }
  }
}

export async function deleteEntry(targetPath: string): Promise<OperationResult> {
  try {
    const normalizedPath = normalizeFilesystemPath(targetPath)
    const result = await performLibraryEntryOperation({
      action: 'delete',
      targetPath: normalizedPath,
    }, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
    })
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedPath)
    }
    return result
  } catch (error) {
    console.error('[task-manager] library_entry_operation(delete) failed', error)
    return { ok: false, error: 'No se pudo eliminar la entrada.' }
  }
}

export async function renameEntry(targetPath: string, newName: string): Promise<OperationResult> {
  try {
    const normalizedPath = normalizeFilesystemPath(targetPath)
    const result = await performLibraryEntryOperation({
      action: 'rename',
      targetPath: normalizedPath,
      newName,
    }, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
    })
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedPath)
    }
    return result
  } catch (error) {
    console.error('[task-manager] library_entry_operation(rename) failed', error)
    return { ok: false, error: 'No se pudo renombrar la entrada.' }
  }
}

export async function moveEntry(sourcePath: string, targetDirectoryPath: string): Promise<OperationResult> {
  try {
    const normalizedSourcePath = normalizeFilesystemPath(sourcePath)
    const normalizedTargetDirectoryPath = normalizeFilesystemPath(targetDirectoryPath)
    const result = await performLibraryEntryOperation({
      action: 'paste',
      sourcePath: normalizedSourcePath,
      targetDirectoryPath: normalizedTargetDirectoryPath,
      mode: 'move',
    }, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedTargetDirectoryPath)
        ?? resolveAndroidDirectoryUri(normalizedSourcePath),
    })
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedSourcePath)
      notifyLibraryTreeChanged(normalizedTargetDirectoryPath)
    }
    return result
  } catch (error) {
    console.error('[task-manager] library_entry_operation(move) failed', error)
    return { ok: false, error: 'No se pudo mover la entrada.' }
  }
}

export async function ensureFolderPath(rootPath: string, relativePath: string): Promise<void> {
  const segments = relativePath.split('/').filter(Boolean)
  let currentPath = normalizeFilesystemPath(rootPath)

  for (const segment of segments) {
    const result = await createFolder(currentPath, segment)
    if (!result.ok && !isAlreadyExistsError(result.error)) {
      throw new Error(result.error || `No se pudo crear la carpeta ${segment}`)
    }

    currentPath = `${currentPath}/${segment}`
  }
}

function isAlreadyExistsError(error: string | undefined): boolean {
  if (!error) {
    return false
  }

  return error.toLowerCase().includes('already exists')
}
