import { useEffect, useRef } from 'react'
import { useAppDispatch, useAppStore } from '../../../store/hooks'
import { activateSpecialTab, GYM_WORKSPACE_TAB_PATH, HOME_WORKSPACE_TAB_PATH, setActiveTabPath } from '../../../features/documents/documentsSlice'
import type { NotiaLibrary } from '../../../types/notia'
import { getResumableWorkout } from '../services/gymService'

/**
 * Al abrir la app (o cambiar de biblioteca), un entrenamiento en curso sigue
 * donde estaba: si Rust dice que hay uno con actividad reciente, se abre
 * Gimnasio, que arranca en Entrenar. No se impone si la persona ya abrió
 * otra cosa mientras tanto.
 */
export function useResumeWorkout(library: NotiaLibrary | null): void {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const libraryRef = useRef(library)
  useEffect(() => {
    libraryRef.current = library
  })
  const libraryId = library?.id ?? null

  useEffect(() => {
    const current = libraryRef.current
    if (!libraryId || !current) return undefined
    let cancelled = false
    void getResumableWorkout(current)
      .then((routineId) => {
        if (cancelled || !routineId) return
        const { activeTabPath, specialTabs } = store.getState().documents
        if (activeTabPath !== null && activeTabPath !== HOME_WORKSPACE_TAB_PATH) return
        if (!specialTabs.gym) dispatch(activateSpecialTab('gym'))
        dispatch(setActiveTabPath(GYM_WORKSPACE_TAB_PATH))
      })
      // Sin la respuesta (la biblioteca todavía bloqueada, sin conexión con el host) la app abre como siempre.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [libraryId, dispatch, store])
}
