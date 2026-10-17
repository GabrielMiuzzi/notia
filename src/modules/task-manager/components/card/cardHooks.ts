import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { FLASH_MS, prefersReducedMotion } from './taskDisplay'

const COARSE_QUERY = '(pointer: coarse)'

export function readNow(): number {
  return Date.now()
}

/** The current time, ticking every second only while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(readNow)
  useEffect(() => {
    if (!active) return
    setNow(readNow())
    const timer = window.setInterval(() => setNow(readNow()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

function coarseQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(COARSE_QUERY)
    : null
}

function subscribeCoarse(onChange: () => void): () => void {
  const query = coarseQuery()
  if (!query || typeof query.addEventListener !== 'function') return () => {}
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function readCoarse(): boolean {
  return coarseQuery()?.matches ?? false
}

/** A finger or a pen is the main pointer: nothing may wait for a hover. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribeCoarse, readCoarse, () => false)
}

/** Flashes the element and brings it into view each time `signal` changes. */
export function useFlash<T extends HTMLElement>(signal: string | null) {
  const ref = useRef<T | null>(null)
  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (!signal) return
    ref.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    setFlashing(true)
    const timer = window.setTimeout(() => setFlashing(false), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [signal])
  return { ref, flashing }
}
