import { useCallback } from 'react'
import { useStore } from 'react-redux'
import { useAppDispatch, useAppSelector, type RootState } from '../../../store/hooks'
import {
  hydrateEditorPreferences,
  setEditorPagePreferences,
  setEditorPreferencesError,
  setPenPreferences,
} from '../../../features/preferences/preferencesSlice'
import { saveEditorPreferences } from '../../../services/preferences/devicePreferencesStorage'
import type { EditorPagePreferences, PenPreferences } from '../../../services/preferences/editorPreferences'

const SAVE_ERROR = 'No se pudo guardar la configuración. Se restauró el valor anterior.'

/** Saves run one after the other, so the backend keeps the last change. */
let saveQueue: Promise<unknown> = Promise.resolve()

/**
 * Page mode, page setup and pen preferences. A change shows at once; the
 * backend normalizes and stores it, and its answer (with the derived page
 * setup) replaces the local copy. A failed save restores the previous value.
 */
export function useEditorPreferences() {
  const dispatch = useAppDispatch()
  const store = useStore<RootState>()
  const editorPage = useAppSelector((state) => state.preferences.editorPage)
  const editorPageSetup = useAppSelector((state) => state.preferences.editorPageSetup)
  const pen = useAppSelector((state) => state.preferences.pen)
  const error = useAppSelector((state) => state.preferences.editorPreferencesError)

  const updatePage = useCallback((patch: Partial<EditorPagePreferences>) => {
    const { editorPage: previous, pen: currentPen } = store.getState().preferences
    if (!previous || !currentPen) return
    const next = { ...previous, ...patch }
    dispatch(setEditorPagePreferences(next))
    saveQueue = saveQueue
      .catch(() => undefined)
      .then(() => saveEditorPreferences({ editorPage: next }, { editorPage: previous, pen: currentPen }))
      .then((saved) => dispatch(hydrateEditorPreferences(saved)))
      .catch(() => {
        dispatch(setEditorPagePreferences(previous))
        dispatch(setEditorPreferencesError(SAVE_ERROR))
      })
  }, [dispatch, store])

  const updatePen = useCallback((patch: Partial<PenPreferences>) => {
    const { pen: previous, editorPage: currentPage } = store.getState().preferences
    if (!previous || !currentPage) return
    const next = { ...previous, ...patch }
    dispatch(setPenPreferences(next))
    saveQueue = saveQueue
      .catch(() => undefined)
      .then(() => saveEditorPreferences({ pen: next }, { editorPage: currentPage, pen: previous }))
      .then((saved) => dispatch(hydrateEditorPreferences(saved)))
      .catch(() => {
        dispatch(setPenPreferences(previous))
        dispatch(setEditorPreferencesError(SAVE_ERROR))
      })
  }, [dispatch, store])

  return { editorPage, editorPageSetup, pen, error, updatePage, updatePen }
}
