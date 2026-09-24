import { useEffect } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { setContextMenu } from '../../../features/documents/documentsSlice'

interface UseGlobalEventListenersParams {
  handleCloseActiveTab: () => void
  handleCycleToNextTab: () => void
  /** Ctrl+N: new note in the library root. */
  handleNewNote: () => void
  /** Ctrl+O: focus the explorer search. */
  handleGoToFile: () => void
}

export function useGlobalEventListeners({
  handleCloseActiveTab,
  handleCycleToNextTab,
  handleNewNote,
  handleGoToFile,
}: UseGlobalEventListenersParams) {
  const dispatch = useAppDispatch()

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-notia-prevent-menu-close]')) { return }
      dispatch(setContextMenu(null))
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { dispatch(setContextMenu(null)) }
    }
    window.addEventListener('click', handleGlobalClick)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('click', handleGlobalClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [dispatch])

  useEffect(() => {
    const handleTabShortcuts = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey) { return }
      if (event.key === 'Tab') {
        event.preventDefault()
        handleCycleToNextTab()
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'w') {
        event.preventDefault()
        handleCloseActiveTab()
        return
      }
      if (event.shiftKey) { return }
      if (key === 'n') {
        event.preventDefault()
        handleNewNote()
        return
      }
      if (key === 'o') {
        event.preventDefault()
        handleGoToFile()
      }
    }
    window.addEventListener('keydown', handleTabShortcuts)
    return () => { window.removeEventListener('keydown', handleTabShortcuts) }
  }, [handleCloseActiveTab, handleCycleToNextTab, handleGoToFile, handleNewNote])
}