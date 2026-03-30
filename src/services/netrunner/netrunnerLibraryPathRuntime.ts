import type { NotiaLibrary } from '../../types/notia'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import {
  buildRelativeLibraryPath,
  joinLibraryPath,
  normalizeComparableLibraryPath,
} from '../libraries/libraryPathMapping'

export function normalizeNetrunnerDesktopPath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = normalizeFilesystemPath(value.trim())
  return normalized ? normalized : undefined
}

export function resolveNetrunnerLibraryRootPath(library: NotiaLibrary | null): string | null {
  if (!library) {
    return null
  }

  const configuredDesktopPath = normalizeNetrunnerDesktopPath(library.netrunnerDesktopPath)
  if (configuredDesktopPath) {
    return normalizeComparableLibraryPath(configuredDesktopPath)
  }

  return getRuntimeDevice() === 'Android'
    ? null
    : normalizeComparableLibraryPath(library.path)
}

export function getNetrunnerLibraryConfigurationMessage(library: NotiaLibrary | null): string | null {
  if (!library) {
    return null
  }

  if (resolveNetrunnerLibraryRootPath(library)) {
    return null
  }

  return 'Configurá la ruta desktop de esta librería en Configuraciones > Netrunner para que el backend opere sobre la copia sincronizada.'
}

export function resolveNetrunnerPathFromLibraryPath(
  library: NotiaLibrary,
  localLibraryPath: string,
): string | null {
  const netrunnerLibraryRootPath = resolveNetrunnerLibraryRootPath(library)
  if (!netrunnerLibraryRootPath) {
    return null
  }

  const relativePath = buildRelativeLibraryPath(library.path, localLibraryPath)
  if (relativePath === null) {
    return null
  }

  return joinLibraryPath(netrunnerLibraryRootPath, relativePath)
}
