import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { getAiTaskThinking, subscribeToThinking } from '../services/aiTasksService'
import type { AiTaskDetail, AiTaskThinking } from '../types/aiTasksTypes'

// A waiting task has no run: nothing streams until it wakes.
const STREAMING_STATUSES = new Set(['planning', 'running', 'reviewing', 'awaiting-approval'])

/**
 * El thinking de la fase que trabaja la tarea, en vivo: Rust da lo que
 * llegó hasta ahora y el panel suma los fragmentos que siguen de esa misma
 * corrida. Se vuelve a pedir con cada cambio de la tarea (otra fase, otro paso).
 */
export function useAiTaskThinking(library: NotiaLibrary, task: AiTaskDetail | null): AiTaskThinking | null {
  const [thinking, setThinking] = useState<AiTaskThinking | null>(null)
  const thinkingRef = useRef<AiTaskThinking | null>(null)
  const streaming = task !== null && STREAMING_STATUSES.has(task.status)
  const taskId = task?.id ?? null

  const show = useCallback((next: AiTaskThinking | null) => {
    thinkingRef.current = next
    setThinking(next)
  }, [])

  useEffect(() => {
    if (!streaming || !taskId) {
      show(null)
      return
    }
    let disposed = false
    void getAiTaskThinking(library, taskId).then((snapshot) => {
      if (disposed) return
      const current = thinkingRef.current
      // Fragments that arrived while it was asked for are already in it.
      if (snapshot && current?.requestId === snapshot.requestId && current.sequence > snapshot.sequence) return
      show(snapshot)
    }).catch(() => undefined)
    return () => { disposed = true }
    // `task` changes with every reload of the panel: each one asks again.
  }, [library, streaming, taskId, task, show])

  useEffect(() => {
    if (!streaming) return
    let disposed = false
    let unlisten: (() => void) | null = null
    void subscribeToThinking((fragment) => {
      const current = thinkingRef.current
      if (!current || fragment.requestId !== current.requestId || fragment.sequence <= current.sequence) return
      const joined = current.text + fragment.text
      const text = joined.length > current.maxChars ? `…${joined.slice(joined.length - current.maxChars + 1)}` : joined
      show({ ...current, text, sequence: fragment.sequence })
    }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [streaming, show])

  return thinking
}
