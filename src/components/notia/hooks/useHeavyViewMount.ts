import { useEffect, useState } from 'react'
import { selectIsHeavyWorkspaceView } from '../../../features/ui/uiSelectors'
import { store } from '../../../store/index'

interface UseHeavyViewMountParams {
  activeWorkspaceView: string
  isAndroidRuntime: boolean
}

export function useHeavyViewMount({
  activeWorkspaceView,
  isAndroidRuntime,
}: UseHeavyViewMountParams) {
  const [mountedHeavyWorkspaceView, setMountedHeavyWorkspaceView] = useState(activeWorkspaceView)

  useEffect(() => {
    const isHeavyWorkspaceView = selectIsHeavyWorkspaceView(store.getState())
    if (!isAndroidRuntime || !isHeavyWorkspaceView) {
      setMountedHeavyWorkspaceView(activeWorkspaceView)
      return
    }
    if (mountedHeavyWorkspaceView === activeWorkspaceView) { return }
    let frameId = 0
    let nestedFrameId = 0
    frameId = window.requestAnimationFrame(() => {
      nestedFrameId = window.requestAnimationFrame(() => {
        setMountedHeavyWorkspaceView(activeWorkspaceView)
      })
    })
    return () => {
      window.cancelAnimationFrame(frameId)
      window.cancelAnimationFrame(nestedFrameId)
    }
  }, [activeWorkspaceView, isAndroidRuntime, mountedHeavyWorkspaceView])

  return { mountedHeavyWorkspaceView }
}