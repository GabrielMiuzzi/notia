import { createFile, createDirectory, pathExists } from '../files/filesystemEngine'
import { readLibraryFileContent, writeLibraryFileContent } from '../libraries/libraryDocumentRuntime'
import type { NotiaLibrary } from '../../types/notia'
import type { ColdPassEntry } from '../../types/coldpass'
import { createEmptyColdPassMarkdown, parseColdPassMarkdown, stringifyColdPassMarkdown } from './coldpassMarkdown'
import { decryptColdPassMarkdown, encryptColdPassMarkdown } from './coldpassCrypto'

const COLDPASS_DIRECTORY_NAME = 'ColdPass'
const COLDPASS_FILE_NAME = 'ColdPass.md'

export interface ColdPassSessionData {
  directoryPath: string
  filePath: string
  markdown: string
  entries: ColdPassEntry[]
  passkey: string
}

function joinPath(basePath: string, childName: string): string {
  const separator = basePath.includes('\\') ? '\\' : '/'
  if (basePath.endsWith('/') || basePath.endsWith('\\')) {
    return `${basePath}${childName}`
  }
  return `${basePath}${separator}${childName}`
}

export function resolveColdPassPaths(libraryPath: string): { directoryPath: string; filePath: string } {
  const directoryPath = joinPath(libraryPath, COLDPASS_DIRECTORY_NAME)
  const filePath = joinPath(directoryPath, COLDPASS_FILE_NAME)
  return { directoryPath, filePath }
}

async function ensureColdPassDirectory(directoryPath: string): Promise<void> {
  if (await pathExists(directoryPath)) {
    return
  }

  const result = await createDirectory(directoryPath)
  if (!result.ok) {
    throw new Error(result.error ?? 'Could not create ColdPass directory.')
  }
}

async function ensureEncryptedColdPassFile(filePath: string, passkey: string): Promise<string> {
  const defaultMarkdown = createEmptyColdPassMarkdown()
  const encryptedContent = await encryptColdPassMarkdown(defaultMarkdown, passkey)

  if (await pathExists(filePath)) {
    return encryptedContent
  }

  const createResult = await createFile(filePath, encryptedContent)
  if (!createResult.ok) {
    throw new Error(createResult.error ?? 'Could not create ColdPass file.')
  }

  return encryptedContent
}

export async function unlockColdPassSession(
  library: NotiaLibrary,
  passkey: string,
): Promise<ColdPassSessionData> {
  const { directoryPath, filePath } = resolveColdPassPaths(library.path)
  await ensureColdPassDirectory(directoryPath)

  let encryptedContent = ''
  if (await pathExists(filePath)) {
    const readResult = await readLibraryFileContent(filePath)
    if (!readResult.ok) {
      throw new Error(readResult.error ?? 'Could not read ColdPass file.')
    }
    encryptedContent = readResult.content
  } else {
    encryptedContent = await ensureEncryptedColdPassFile(filePath, passkey)
  }

  const markdown = await decryptColdPassMarkdown(encryptedContent, passkey)
  return {
    directoryPath,
    filePath,
    markdown,
    entries: parseColdPassMarkdown(markdown),
    passkey,
  }
}

export async function saveColdPassEntries(
  filePath: string,
  passkey: string,
  entries: ColdPassEntry[],
): Promise<{ ok: boolean; error?: string; markdown: string }> {
  const markdown = stringifyColdPassMarkdown(entries)
  const encryptedContent = await encryptColdPassMarkdown(markdown, passkey)
  const result = await writeLibraryFileContent(filePath, encryptedContent)

  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Could not write ColdPass file.', markdown }
  }

  return { ok: true, markdown }
}
