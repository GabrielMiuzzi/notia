import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'

function trimAndNormalizePath(pathValue: string): string {
  return normalizeFilesystemPath(pathValue.trim())
}

function stripTrailingSeparators(pathValue: string): string {
  return pathValue.replace(/[\\/]+$/, '')
}

export function normalizeComparableLibraryPath(pathValue: string): string {
  return stripTrailingSeparators(trimAndNormalizePath(pathValue))
}

function isAbsoluteLibraryPath(pathValue: string): boolean {
  return pathValue.startsWith('/')
    || pathValue.startsWith('\\\\')
    || pathValue.startsWith('//')
    || /^[A-Za-z]:[\\/]/.test(pathValue)
}

export function joinLibraryPath(basePath: string, childPath: string): string {
  const normalizedBasePath = normalizeComparableLibraryPath(basePath)
  const normalizedChildPath = childPath.trim().replace(/[\\/]+/g, normalizedBasePath.includes('\\') ? '\\' : '/')

  if (!normalizedChildPath) {
    return normalizedBasePath
  }

  const separator = normalizedBasePath.includes('\\') ? '\\' : '/'
  return `${normalizedBasePath}${separator}${normalizedChildPath}`
}

export function buildRelativeLibraryPath(libraryPath: string, targetPath: string): string | null {
  const normalizedLibraryPath = normalizeComparableLibraryPath(libraryPath)
  const normalizedTargetPath = normalizeComparableLibraryPath(targetPath)

  if (!normalizedLibraryPath || !normalizedTargetPath) {
    return null
  }

  if (normalizedTargetPath === normalizedLibraryPath) {
    return ''
  }

  if (normalizedTargetPath.startsWith(`${normalizedLibraryPath}/`)) {
    return normalizedTargetPath.slice(normalizedLibraryPath.length + 1)
  }

  if (normalizedTargetPath.startsWith(`${normalizedLibraryPath}\\`)) {
    return normalizedTargetPath.slice(normalizedLibraryPath.length + 1)
  }

  return null
}

export function toStoredLibraryPath(libraryPath: string, targetPath: string): string {
  const normalizedTargetPath = trimAndNormalizePath(targetPath)
  if (!normalizedTargetPath) {
    return ''
  }

  const relativePath = buildRelativeLibraryPath(libraryPath, normalizedTargetPath)
  if (relativePath !== null) {
    return relativePath
  }

  return normalizedTargetPath
}

export function fromStoredLibraryPath(libraryPath: string, storedPath: string): string {
  const normalizedStoredPath = trimAndNormalizePath(storedPath)
  if (!normalizedStoredPath) {
    return ''
  }

  if (isAbsoluteLibraryPath(normalizedStoredPath)) {
    return normalizeComparableLibraryPath(normalizedStoredPath)
  }

  return joinLibraryPath(libraryPath, normalizedStoredPath)
}
