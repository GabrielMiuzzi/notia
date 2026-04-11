import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  loadActiveLibraryId,
  loadLibraries,
  saveActiveLibraryId,
  saveLibraries,
} from '../../../services/libraries/libraryStorage'
import { pathExists } from '../../../services/files/filesystemEngine'
import type { NotiaLibrary } from '../../../types/notia'

function findInitialActiveLibrary(libraries: NotiaLibrary[]): string | null {
  if (libraries.length === 0) {
    return null
  }

  const savedId = loadActiveLibraryId()
  if (savedId && libraries.some((library) => library.id === savedId)) {
    return savedId
  }

  return libraries[0].id
}

function areLibrariesEquivalent(current: NotiaLibrary[], next: NotiaLibrary[]): boolean {
  if (current.length !== next.length) {
    return false
  }

  return current.every((library, index) => {
    const candidate = next[index]
    if (!candidate) {
      return false
    }

    return library.id === candidate.id
      && library.path === candidate.path
      && (library.androidTreeUri ?? '') === (candidate.androidTreeUri ?? '')
  })
}

function normalizeLibraryPath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function useLibrarySession() {
  const [libraries, setLibraries] = useState<NotiaLibrary[]>(() => loadLibraries())
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(() =>
    findInitialActiveLibrary(loadLibraries()),
  )

  const activeLibrary = useMemo(
    () => libraries.find((library) => library.id === activeLibraryId) ?? null,
    [activeLibraryId, libraries],
  )

  const resolveActiveLibraryAndroidDirectoryUri = useCallback((pathValue?: string | null): string | undefined => {
    if (!activeLibrary?.androidTreeUri) {
      return undefined
    }

    if (!pathValue) {
      return activeLibrary.androidTreeUri
    }

    const normalizedLibraryPath = normalizeLibraryPath(activeLibrary.path)
    const normalizedPath = normalizeLibraryPath(pathValue)
    if (normalizedPath === normalizedLibraryPath || normalizedPath.startsWith(`${normalizedLibraryPath}/`)) {
      return activeLibrary.androidTreeUri
    }

    return undefined
  }, [activeLibrary])

  useEffect(() => {
    saveLibraries(libraries)
  }, [libraries])

  useEffect(() => {
    let isCancelled = false

    const checkLibraries = async () => {
      // Procesar en chunks para no bloquear la UI en Android
      const chunkSize = 2
      const existingLibraries: NotiaLibrary[] = []
      
      for (let i = 0; i < libraries.length; i += chunkSize) {
        if (isCancelled) return
        
        const chunk = libraries.slice(i, i + chunkSize)
        const checks = await Promise.all(
          chunk.map(async (library) => {
            // En Android, si tenemos androidTreeUri, asumimos que existe
            // La validación real se hará cuando se intente acceder
            if (library.androidTreeUri) {
              return library
            }
            
            const exists = await pathExists(library.path)
            return exists ? library : null
          })
        )
        
        existingLibraries.push(...checks.filter((l): l is NotiaLibrary => l !== null))
        
        // Yield al event loop para no bloquear
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      
      if (!isCancelled && !areLibrariesEquivalent(libraries, existingLibraries)) {
        setLibraries(existingLibraries)
      }
    }
    
    checkLibraries()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!activeLibraryId) {
      if (libraries.length > 0) {
        setActiveLibraryId(libraries[0].id)
      }
      return
    }

    if (!libraries.some((library) => library.id === activeLibraryId)) {
      setActiveLibraryId(libraries.length > 0 ? libraries[0].id : null)
    }
  }, [activeLibraryId, libraries])

  useEffect(() => {
    saveActiveLibraryId(activeLibraryId)
  }, [activeLibraryId])

  return {
    activeLibrary,
    activeLibraryId,
    libraries,
    resolveActiveLibraryAndroidDirectoryUri,
    setActiveLibraryId,
    setLibraries,
  }
}
