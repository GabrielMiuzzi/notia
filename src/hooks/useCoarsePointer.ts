import { useEffect, useState } from 'react'

const COARSE_POINTER_QUERY = '(pointer: coarse)'

/**
 * Reports whether the primary input is a coarse pointer (finger on Android
 * tablets/phones). Windows desktop keeps reporting false, so desktop-only
 * affordances stay intact and touch alternatives can render alongside them.
 */
export function useCoarsePointer(): boolean {
  const [isCoarsePointer, setIsCoarsePointer] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(COARSE_POINTER_QUERY).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQueryList = window.matchMedia(COARSE_POINTER_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      setIsCoarsePointer(event.matches)
    }

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleChange)
      return () => mediaQueryList.removeEventListener('change', handleChange)
    }

    mediaQueryList.addListener(handleChange)
    return () => mediaQueryList.removeListener(handleChange)
  }, [])

  return isCoarsePointer
}