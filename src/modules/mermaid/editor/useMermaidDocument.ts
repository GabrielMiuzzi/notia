import { useCallback, useEffect, useRef, useState } from 'react'
import { applyMermaidEdit, readMermaidModel } from './mermaidEditorService'
import type { DiagramSelection, MermaidEdit, MermaidModel } from './mermaidEditorTypes'

const PERSIST_DELAY_MS = 800
const READ_DELAY_MS = 120
/** Typing within this time is one step of undo. */
const TYPING_STEP_MS = 700
const MAX_HISTORY = 100

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/**
 * The diagram the editor shows: its source (typed or changed by an edit the
 * backend applies), the model the backend reads from it, the selection,
 * undo and redo, and saving the source to its tab.
 */
export function useMermaidDocument(source: string, onSourcePersist: (next: string) => Promise<void>) {
  const [code, setCodeState] = useState(source)
  const [model, setModel] = useState<MermaidModel | null>(null)
  const [selection, setSelection] = useState<DiagramSelection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<{ undo: string[]; redo: string[] }>({ undo: [], redo: [] })
  const codeRef = useRef(code)
  const lastTypingRef = useRef(0)
  const persistedRef = useRef(source)
  const [persisted, setPersisted] = useState(source)
  const persistRef = useRef(onSourcePersist)
  persistRef.current = onSourcePersist

  const commit = useCallback((next: string, step: boolean) => {
    const previous = codeRef.current
    if (next === previous) return
    if (step) {
      setHistory((current) => ({ undo: [...current.undo, previous].slice(-MAX_HISTORY), redo: [] }))
    }
    codeRef.current = next
    setCodeState(next)
  }, [])

  // The tab changed outside the editor (another device, the chat).
  useEffect(() => {
    if (source === persistedRef.current) return
    persistedRef.current = source
    setPersisted(source)
    if (source !== codeRef.current) {
      codeRef.current = source
      setCodeState(source)
    }
  }, [source])

  // The model follows the source.
  useEffect(() => {
    let current = true
    const timer = window.setTimeout(() => {
      void readMermaidModel(code).then((next) => {
        if (current) setModel(next)
      }).catch((reason: unknown) => {
        if (current) setError(errorText(reason, 'No se pudo leer el diagrama.'))
      })
    }, READ_DELAY_MS)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [code])

  // Saving: a moment after the last change, and right away when the editor closes.
  useEffect(() => {
    if (code === persistedRef.current) return
    const timer = window.setTimeout(() => {
      persistedRef.current = code
      setPersisted(code)
      void persistRef.current(code)
    }, PERSIST_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [code])
  useEffect(() => () => {
    if (codeRef.current !== persistedRef.current) {
      persistedRef.current = codeRef.current
      void persistRef.current(codeRef.current)
    }
  }, [])

  const setCode = useCallback((next: string) => {
    const now = Date.now()
    commit(next, now - lastTypingRef.current > TYPING_STEP_MS)
    lastTypingRef.current = now
  }, [commit])

  /** Applies an edit; resolves whether it was applied. */
  const edit = useCallback(async (change: MermaidEdit) => {
    setBusy(true)
    setError(null)
    try {
      const result = await applyMermaidEdit(codeRef.current, change)
      lastTypingRef.current = 0
      commit(result.source, true)
      setModel(result.model)
      if (result.selection) setSelection(result.selection)
      return true
    } catch (reason) {
      setError(errorText(reason, 'No se pudo cambiar el diagrama.'))
      return false
    } finally {
      setBusy(false)
    }
  }, [commit])

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.undo.at(-1)
      if (previous === undefined) return current
      const present = codeRef.current
      codeRef.current = previous
      setCodeState(previous)
      return { undo: current.undo.slice(0, -1), redo: [...current.redo, present] }
    })
  }, [])

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.redo.at(-1)
      if (next === undefined) return current
      const present = codeRef.current
      codeRef.current = next
      setCodeState(next)
      return { undo: [...current.undo, present], redo: current.redo.slice(0, -1) }
    })
  }, [])

  return {
    code,
    setCode,
    model,
    selection,
    setSelection,
    edit,
    busy,
    error,
    setError,
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    undo,
    redo,
    saved: code === persisted,
  }
}

export type MermaidDocument = ReturnType<typeof useMermaidDocument>
