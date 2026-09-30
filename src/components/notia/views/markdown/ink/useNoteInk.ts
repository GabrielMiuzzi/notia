import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addInkStroke,
  eraseInk,
  loadInk,
  removeInkStrokes,
  restoreInkStrokes,
  type InkStroke,
  type InkStrokeDraft,
} from '../../../../../services/markdown/noteInkRuntime'

/*
 * The strokes shown over a note and the pen bar's undo history. Rust owns
 * the strokes: each action is sent to it and the view shows its answer. A
 * new stroke shows at once as drawn and is replaced by the one Rust keeps.
 */

type HistoryEntry = { kind: 'add'; stroke: InkStroke } | { kind: 'erase'; strokes: InkStroke[] }

const LOAD_ERROR = 'No se pudieron leer los trazos de esta nota.'
const SAVE_ERROR = 'No se pudo guardar el trazo.'

export interface NoteInk {
  strokes: InkStroke[]
  error: string | null
  canUndo: boolean
  canRedo: boolean
  commit: (draft: InkStrokeDraft) => void
  /** Erases along a piece of the eraser's path; one gesture is one undo step. */
  erase: (page: number | null, points: Array<[number, number]>, radius: number, gesture: number) => void
  undo: () => void
  redo: () => void
}

export function useNoteInk(libraryId: string | null | undefined, path: string, paged: boolean): NoteInk {
  const [strokes, setStrokes] = useState<InkStroke[]>([])
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<{ undo: HistoryEntry[]; redo: HistoryEntry[] }>({ undo: [], redo: [] })
  // Answers for a note or mode that is no longer shown are dropped.
  const generationRef = useRef(0)
  const eraseGestureRef = useRef<number | null>(null)
  // Every request goes after the previous one, as the person made them.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  // An undo or redo waits for its answer before the next one.
  const applyingRef = useRef(false)

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    applyingRef.current = false
    setStrokes([])
    setHistory({ undo: [], redo: [] })
    setError(null)
    if (!libraryId || !path) return
    let active = true
    void loadInk(libraryId, path, paged)
      .then((loaded) => {
        if (active) setStrokes(loaded)
      })
      .catch(() => {
        if (active) setError(LOAD_ERROR)
      })
    return () => {
      active = false
    }
  }, [libraryId, path, paged])

  const enqueue = useCallback(<T,>(run: () => Promise<T>, onDone: (value: T) => void, onFail: () => void) => {
    const generation = generationRef.current
    queueRef.current = queueRef.current
      .catch(() => undefined)
      .then(run)
      .then((value) => {
        if (generationRef.current === generation) onDone(value)
      })
      .catch(() => {
        if (generationRef.current === generation) onFail()
      })
  }, [])

  const commit = useCallback((draft: InkStrokeDraft) => {
    if (!libraryId) return
    const shown: InkStroke = { id: draft.id, tool: draft.tool, color: draft.color, width: draft.width, page: draft.page, points: draft.points }
    setStrokes((current) => [...current, shown])
    enqueue(() => addInkStroke(libraryId, path, draft), (saved) => {
      setStrokes((current) => current.map((stroke) => (stroke.id === saved.id ? saved : stroke)))
      setHistory((current) => ({ undo: [...current.undo, { kind: 'add', stroke: saved }], redo: [] }))
      setError(null)
    }, () => {
      setStrokes((current) => current.filter((stroke) => stroke.id !== draft.id))
      setError(SAVE_ERROR)
    })
  }, [enqueue, libraryId, path])

  const erase = useCallback((page: number | null, points: Array<[number, number]>, radius: number, gesture: number) => {
    if (!libraryId || points.length === 0) return
    enqueue(() => eraseInk(libraryId, path, page, points, radius), (removed) => {
      if (removed.length === 0) return
      const ids = new Set(removed.map((stroke) => stroke.id))
      setStrokes((current) => current.filter((stroke) => !ids.has(stroke.id)))
      const sameGesture = eraseGestureRef.current === gesture
      eraseGestureRef.current = gesture
      setHistory((current) => {
        const last = current.undo[current.undo.length - 1]
        if (sameGesture && last?.kind === 'erase') {
          return { undo: [...current.undo.slice(0, -1), { kind: 'erase', strokes: [...last.strokes, ...removed] }], redo: [] }
        }
        return { undo: [...current.undo, { kind: 'erase', strokes: removed }], redo: [] }
      })
    }, () => setError('No se pudo borrar el trazo.'))
  }, [enqueue, libraryId, path])

  /** Takes a stroke out or puts strokes back, as undo and redo need. */
  const apply = useCallback((entry: HistoryEntry, direction: 'undo' | 'redo') => {
    if (!libraryId) return
    const removing = (entry.kind === 'add') === (direction === 'undo')
    const affected = entry.kind === 'add' ? [entry.stroke] : entry.strokes
    const ids = new Set(affected.map((stroke) => stroke.id))
    applyingRef.current = true
    enqueue(
      async () => {
        if (removing) await removeInkStrokes(libraryId, path, [...ids])
        else await restoreInkStrokes(libraryId, path, affected)
      },
      () => {
        applyingRef.current = false
        setStrokes((current) => (removing ? current.filter((stroke) => !ids.has(stroke.id)) : [...current, ...affected]))
        setHistory((current) => direction === 'undo'
          ? { undo: current.undo.slice(0, -1), redo: [...current.redo, entry] }
          : { undo: [...current.undo, entry], redo: current.redo.slice(0, -1) })
      },
      () => {
        applyingRef.current = false
        setError('No se pudo deshacer el cambio.')
      },
    )
  }, [enqueue, libraryId, path])

  const undo = useCallback(() => {
    const entry = history.undo[history.undo.length - 1]
    eraseGestureRef.current = null
    if (entry && !applyingRef.current) apply(entry, 'undo')
  }, [apply, history.undo])

  const redo = useCallback(() => {
    const entry = history.redo[history.redo.length - 1]
    eraseGestureRef.current = null
    if (entry && !applyingRef.current) apply(entry, 'redo')
  }, [apply, history.redo])

  return {
    strokes,
    error,
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    commit,
    erase,
    undo,
    redo,
  }
}
