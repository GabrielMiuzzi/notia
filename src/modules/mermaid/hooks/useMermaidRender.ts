import { useCallback, useEffect, useRef, useState } from 'react'
import type { MermaidRenderResult } from '../types/mermaidTypes'
import { renderMermaid } from '../engines/mermaidEngine'

interface UseMermaidRenderParams {
  code: string
  config?: string
  theme: string
}

export function useMermaidRender({ code, config, theme }: UseMermaidRenderParams) {
  const [result, setResult] = useState<MermaidRenderResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRenderRef = useRef(0)
  const pendingRef = useRef(false)
  const activeRenderRef = useRef(false)

  const render = useCallback(async () => {
    if (activeRenderRef.current) return // evitar renders concurrentes
    activeRenderRef.current = true
    pendingRef.current = false
    setIsLoading(true)
    setError(null)

    try {
      const res = await renderMermaid({ code, theme, config })
      setResult(res)
      lastRenderRef.current = performance.now()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setResult(null)
    } finally {
      setIsLoading(false)
      activeRenderRef.current = false
      // Si llegó un cambio mientras renderizábamos, reprogramar
      if (pendingRef.current) {
        pendingRef.current = false
        debounceRef.current = setTimeout(() => render(), 50)
      }
    }
  }, [code, config, theme])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // Debounce adaptativo:
    // - Si acabamos de renderizar (< 1s), esperar 400ms (edición rápida)
    // - Si pasó más tiempo, renderizar en 80ms (respuesta rápida)
    const elapsed = performance.now() - lastRenderRef.current
    const delay = elapsed < 1000 ? 400 : 80

    pendingRef.current = true
    debounceRef.current = setTimeout(() => {
      void render()
    }, delay)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [render])

  return { result, error, isLoading }
}
