import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'

export function toAbsoluteVaultPath(vaultPath: string, relativePath: string): string {
  const normalizedVaultPath = normalizeFilesystemPath(vaultPath).replace(/[\\/]+$/, '')
  const normalizedRelativePath = normalizeFilesystemPath(relativePath).replace(/^\/+/, '')
  return `${normalizedVaultPath}/${normalizedRelativePath}`
}

export function toRelativeVaultPath(vaultPath: string, absolutePath: string): string {
  const normalizedVaultPath = normalizeFilesystemPath(vaultPath).replace(/[\\/]+$/, '')
  const normalizedAbsolutePath = normalizeFilesystemPath(absolutePath)

  if (!normalizedAbsolutePath.startsWith(`${normalizedVaultPath}/`)) {
    return normalizedAbsolutePath
  }

  return normalizedAbsolutePath.slice(normalizedVaultPath.length + 1)
}

export function getParentDirectory(path: string): string {
  const normalized = normalizeFilesystemPath(path).replace(/[\\/]+$/, '')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) {
    return normalized
  }

  return normalized.slice(0, index)
}

export function getBaseName(path: string): string {
  const normalized = normalizeFilesystemPath(path).replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? normalized
}

export function getBasenameWithoutExtension(path: string): string {
  return getBaseName(path).replace(/\.[^.]+$/, '')
}
