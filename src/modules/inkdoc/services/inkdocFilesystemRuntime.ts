// @ts-nocheck
import {
  createDirectory,
  createFile,
  pathExists as filesystemPathExists,
  writeBinaryFile as writeFilesystemBinaryFile,
} from '../../../services/files/filesystemEngine'

export async function createInkdocFile(path: string, content: string, androidDirectoryUri?: string): Promise<void> {
  const result = await createFile(path, content, { androidDirectoryUri })

  if (!result.ok) {
    throw new Error(result.error ?? 'Could not create file.')
  }
}

export async function createInkdocFolder(path: string, androidDirectoryUri?: string): Promise<void> {
  const result = await createDirectory(path, { androidDirectoryUri })

  if (!result.ok) {
    throw new Error(result.error ?? 'Could not create folder.')
  }
}

export async function pathExists(path: string, androidDirectoryUri?: string): Promise<boolean> {
  return filesystemPathExists(path, { androidDirectoryUri })
}

export async function writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
  const result = await writeFilesystemBinaryFile(path, data)

  if (!result.ok) {
    throw new Error(result.error ?? 'Could not write file.')
  }
}
