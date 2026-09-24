import { subscribeBackend } from '../../../services/transport'
import { useEffect, useRef } from 'react'

const LIBRARY_CHANGED_EVENT = 'notia://telegram-library-changed'

/** Refreshes the view when a Telegram request run by the backend changed the active library. */
export function useTelegramLibraryChanges(libraryId: string | null | undefined, onChanged: () => void): void {
  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])
  useEffect(() => {
    if (!libraryId) return
    let active = true
    let unlisten: (() => void) | null = null
    void subscribeBackend<string>(LIBRARY_CHANGED_EVENT, (changedLibraryId) => {
      if (changedLibraryId === libraryId) onChangedRef.current()
    }).then((stop) => {
      if (active) unlisten = stop
      else stop()
    }).catch(() => undefined)
    return () => {
      active = false
      unlisten?.()
    }
  }, [libraryId])
}
