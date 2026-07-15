import { useLayoutEffect } from 'react'
import type { AttachmentMenuPosition } from './ChatWorkspaceViewTypes'

export function useChatAttachmentMenu(
  isAttachmentMenuOpen: boolean,
  setAttachmentMenuPosition: React.Dispatch<React.SetStateAction<AttachmentMenuPosition | null>>,
  triggerRef: React.RefObject<HTMLButtonElement | null>,
  panelRef: React.RefObject<HTMLDivElement | null>,
): void {
  useLayoutEffect(() => {
    if (!isAttachmentMenuOpen) {
      setAttachmentMenuPosition(null)
      return
    }

    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger || !panel) {
      return
    }

    const margin = 8
    const gap = 8
    const triggerRect = trigger.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const nextLeft = Math.min(
      Math.max(triggerRect.right - panelRect.width, margin),
      Math.max(margin, viewportWidth - panelRect.width - margin),
    )

    const topAboveTrigger = triggerRect.top - panelRect.height - gap
    const topBelowTrigger = triggerRect.bottom + gap
    const shouldOpenBelow = topAboveTrigger < margin && topBelowTrigger + panelRect.height <= viewportHeight - margin
    const nextTop = shouldOpenBelow
      ? topBelowTrigger
      : Math.max(margin, topAboveTrigger)

    setAttachmentMenuPosition((current) => {
      if (current?.top === nextTop && current.left === nextLeft) {
        return current
      }

      return {
        top: nextTop,
        left: nextLeft,
      }
    })
  }, [panelRef, triggerRef, isAttachmentMenuOpen, setAttachmentMenuPosition])
}
