import { useEffect } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { setRightPanelChatMounted } from '../../../features/ui/uiSlice'

interface UseRightPanelMountParams {
  isAndroidRuntime: boolean
  isRightChatPanelOpen: boolean
}

export function useRightPanelMount({
  isAndroidRuntime,
  isRightChatPanelOpen,
}: UseRightPanelMountParams) {
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (!isAndroidRuntime) {
      dispatch(setRightPanelChatMounted(isRightChatPanelOpen))
      return
    }
    if (!isRightChatPanelOpen) {
      dispatch(setRightPanelChatMounted(false))
      return
    }
    let frameId = 0
    let nestedFrameId = 0
    frameId = window.requestAnimationFrame(() => {
      nestedFrameId = window.requestAnimationFrame(() => {
        dispatch(setRightPanelChatMounted(true))
      })
    })
    return () => {
      window.cancelAnimationFrame(frameId)
      window.cancelAnimationFrame(nestedFrameId)
    }
  }, [dispatch, isAndroidRuntime, isRightChatPanelOpen])
}