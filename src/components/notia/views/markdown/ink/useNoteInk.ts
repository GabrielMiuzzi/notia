import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addInkStroke,
  eraseInk,
  loadInk,
  moveInkStrokes,
  removeInkStrokes,
  replaceInkStrokes,
  restoreInkStrokes,
  selectInkInLasso,
  type InkStroke,
  type InkStrokeDraft,
} from '../../../../../services/markdown/noteInkRuntime'

/*
 * The strokes shown over a note and the pen bar's undo history. Rust owns
 * the strokes: each action is sent to it and the view shows its answer. A
 * new stroke shows at once as drawn and is replaced by the one Rust keeps.
 */

type HistoryEntry =
  | { kind: 'add'; stroke: InkStroke }
  | { kind: 'erase'; strokes: InkStroke[] }
  | { kind: 'move'; ids: string[]; dx: number; dy: number }

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
  /** Saves new versions of strokes (same ids), outside the undo history. */
  replace: (strokes: InkStroke[]) => void
  /** The strokes a lasso (in the note's flow) takes. */
  select: (lasso: Array<[number, number]>) => Promise<string[]>
  /** Moves strokes; one undo step. */
  move: (ids: string[], dx: number, dy: number) => void
  /** Takes out the selected strokes; one undo step. */
  remove: (ids: string[]) => void
}

/** The strokes of a note, the same in both modes. */
export function useNoteInk(libraryId: string | null | undefined, path: string): NoteInk {
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
    void loadInk(libraryId, path)
      .then((loaded) => {
        if (active) setStrokes(loaded)
      })
      .catch(() => {
        if (active) setError(LOAD_ERROR)
      })
    return () => {
      active = false
    }
  }, [libraryId, path])

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

  /** Puts strokes as Rust returns them after a change. */
  const merge = useCallback((changed: InkStroke[]) => {
    const byId = new Map(changed.map((stroke) => [stroke.id, stroke]))
    setStrokes((current) => current.map((stroke) => byId.get(stroke.id) ?? stroke))
  }, [])

  /** Takes a stroke out or puts strokes back, as undo and redo need. */
  const apply = useCallback((entry: HistoryEntry, direction: 'undo' | 'redo') => {
    if (!libraryId) return
    const settle = () => {
      applyingRef.current = false
      setHistory((current) => direction === 'undo'
        ? { undo: current.undo.slice(0, -1), redo: [...current.redo, entry] }
        : { undo: [...current.undo, entry], redo: current.redo.slice(0, -1) })
    }
    if (entry.kind === 'move') {
      const sign = direction === 'undo' ? -1 : 1
      applyingRef.current = true
      enqueue(() => moveInkStrokes(libraryId, path, entry.ids, sign * entry.dx, sign * entry.dy), (moved) => {
        merge(moved)
        settle()
      }, () => {
        applyingRef.current = false
        setError('No se pudo deshacer el cambio.')
      })
      return
    }
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
        setStrokes((current) => (removing ? current.filter((stroke) => !ids.has(stroke.id)) : [...current, ...affected]))
        settle()
      },
      () => {
        applyingRef.current = false
        setError('No se pudo deshacer el cambio.')
      },
    )
  }, [enqueue, libraryId, merge, path])

  const select = useCallback((lasso: Array<[number, number]>) => new Promise<string[]>((resolve) => {
    if (!libraryId) {
      resolve([])
      return
    }
    // After the strokes still on their way to Rust.
    enqueue(() => selectInkInLasso(libraryId, path, lasso), resolve, () => {
      setError('No se pudieron seleccionar los trazos.')
      resolve([])
    })
  }), [enqueue, libraryId, path])

  const move = useCallback((ids: string[], dx: number, dy: number) => {
    if (!libraryId || ids.length === 0 || (dx === 0 && dy === 0)) return
    enqueue(() => moveInkStrokes(libraryId, path, ids, dx, dy), (moved) => {
      merge(moved)
      setHistory((current) => ({ undo: [...current.undo, { kind: 'move', ids, dx, dy }], redo: [] }))
    }, () => setError('No se pudieron mover los trazos.'))
  }, [enqueue, libraryId, merge, path])

  const remove = useCallback((ids: string[]) => {
    if (!libraryId || ids.length === 0) return
    enqueue(() => removeInkStrokes(libraryId, path, ids), (removed) => {
      const gone = new Set(removed.map((stroke) => stroke.id))
      setStrokes((current) => current.filter((stroke) => !gone.has(stroke.id)))
      setHistory((current) => ({ undo: [...current.undo, { kind: 'erase', strokes: removed }], redo: [] }))
    }, () => setError('No se pudieron borrar los trazos.'))
  }, [enqueue, libraryId, path])

  const replace = useCallback((changed: InkStroke[]) => {
    if (!libraryId || changed.length === 0) return
    enqueue(() => replaceInkStrokes(libraryId, path, changed), () => merge(changed), () => setError('No se pudieron acomodar los trazos a la nota.'))
  }, [enqueue, libraryId, merge, path])

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
    replace,
    select,
    move,
    remove,
  }
}
