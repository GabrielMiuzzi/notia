import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { asRecipesError, getRecipeGrid, getRecipePhoto, subscribeToRecipes } from '../services/recipesService'
import type { RecipeGrid, RecipeQuery } from '../types/recipesTypes'

export type RecipesLoadStatus = 'loading' | 'ready' | 'error'

/** Estado de presentación de la grilla: la pide a Rust y la recarga con cada cambio. */
export function useRecipeGrid(library: NotiaLibrary, query: RecipeQuery) {
  const [grid, setGrid] = useState<RecipeGrid | null>(null)
  const [status, setStatus] = useState<RecipesLoadStatus>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const ticketRef = useRef(0)

  const reload = useCallback(async () => {
    const ticket = ++ticketRef.current
    try {
      const next = await getRecipeGrid(library, query)
      if (ticket !== ticketRef.current) return
      setGrid(next)
      setLoadError(null)
      setStatus('ready')
    } catch (reason) {
      if (ticket !== ticketRef.current) return
      setLoadError(asRecipesError(reason).message)
      setStatus('error')
    }
  }, [library, query])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    void subscribeToRecipes(library, () => { void reload() }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    })
    const handleFocus = () => { void reload() }
    window.addEventListener('focus', handleFocus)
    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener('focus', handleFocus)
    }
  }, [library, reload])

  return { grid, status, loadError, reload }
}

const photoCache = new Map<string, string | null>()

/** La foto de una receta, pedida a Rust una vez por versión de la receta. */
export function useRecipePhoto(library: NotiaLibrary, id: string, photoKey: string, hasPhoto: boolean): string | null {
  const [photo, setPhoto] = useState<string | null>(() => (hasPhoto ? photoCache.get(photoKey) ?? null : null))
  useEffect(() => {
    if (!hasPhoto) {
      setPhoto(null)
      return
    }
    const cached = photoCache.get(photoKey)
    if (cached !== undefined) {
      setPhoto(cached)
      return
    }
    let cancelled = false
    void getRecipePhoto(library, id)
      .then((uri) => {
        photoCache.set(photoKey, uri)
        if (!cancelled) setPhoto(uri)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [library, id, photoKey, hasPhoto])
  return photo
}
