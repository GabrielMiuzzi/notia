import { useEffect } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { setContextMenu } from '../../../features/documents/documentsSlice'

interface UseGlobalEventListenersParams {
  handleCloseActiveTab: () => void
  handleCycleToNextTab: () => void
}

export function useGlobalEventListeners({
  handleCloseActiveTab,
  handleCycleToNextTab,
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
      if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        handleCloseActiveTab()
      }
    }
    window.addEventListener('keydown', handleTabShortcuts)
    return () => { window.removeEventListener('keydown', handleTabShortcuts) }
  }, [handleCloseActiveTab, handleCycleToNextTab])
}