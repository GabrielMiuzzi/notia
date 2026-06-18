import { useEffect, useRef, useState } from 'react'
import type { MermaidRenderResult } from '../types/mermaidTypes'
import { isMermaidRenderCancelledError, renderMermaid } from '../engines/mermaidEngine'

const INTERSECTION_THRESHOLD = 0.1
const EMPTY_RENDER_RESULT: MermaidRenderResult = {
  svg: '',
  bindFunctions: undefined,
  diagramType: 'empty',
}

interface UseMermaidLazyRenderParams {
  code: string
  theme: string
  config?: string
  containerRef: React.RefObject<HTMLElement | null>
}

export function useMermaidLazyRender({ code, theme, config, containerRef }: UseMermaidLazyRenderParams) {
  const trimmedCode = code.trim()
  const isEmpty = trimmedCode.length === 0

  const [result, setResult] = useState<MermaidRenderResult | null>(isEmpty ? EMPTY_RENDER_RESULT : null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isIntersecting, setIsIntersecting] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const isMountedRef = useRef(true)
  const hasRenderedRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || isEmpty) return

    hasRenderedRef.current = false

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry || !entry.isIntersecting) return
        observer.disconnect()
        setIsIntersecting(true)
      },
      { threshold: INTERSECTION_THRESHOLD },
    )

    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [containerRef, isEmpty])

  useEffect(() => {
    if (!isIntersecting || hasRenderedRef.current || isEmpty) return

    hasRenderedRef.current = true
    const controller = new AbortController()
    abortRef.current = controller

    // Defer render kick-off to a microtask so state updates do not happen
    // synchronously inside the effect body (satisfies react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (!isMountedRef.current || controller.signal.aborted) return
      setIsLoading(true)
      setError(null)

      void renderMermaid({
        code: trimmedCode,
        theme,
        config,
        abortSignal: controller.signal,
      })
        .then((res) => {
          if (!isMountedRef.current || controller.signal.aborted) return
          setResult(res)
        })
        .catch((err) => {
          if (!isMountedRef.current || controller.signal.aborted) return
          if (isMermaidRenderCancelledError(err)) return
          setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (abortRef.current === controller) {
            abortRef.current = null
          }
          if (isMountedRef.current) {
            setIsLoading(false)
          }
        })
    })
  }, [isIntersecting, isEmpty, trimmedCode, theme, config])

  return { result, error, isLoading, isIntersecting }
}
