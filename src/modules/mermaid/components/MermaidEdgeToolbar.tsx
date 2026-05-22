import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Settings, Palette, Type } from 'lucide-react'
import { MermaidEdgeTypeMenu } from './MermaidEdgeTypeMenu'
import { MermaidEdgeColorMenu } from './MermaidEdgeColorMenu'
import { MermaidEdgeLabelEditor } from './MermaidEdgeLabelEditor'
import type { MermaidEdgeType } from '../types/mermaidTypes'

interface MermaidEdgeToolbarProps {
  visible: boolean
  x: number
  y: number
  currentLabel?: string
  onTypeChange?: (type: MermaidEdgeType) => void
  onColorChange?: (color: string) => void
  onLabelChange?: (label: string) => void
}

type OpenMenu = 'type' | 'color' | 'label' | null

export const MermaidEdgeToolbar = memo(function MermaidEdgeToolbar({
  visible,
  x,
  y,
  currentLabel = '',
  onTypeChange,
  onColorChange,
  onLabelChange,
}: MermaidEdgeToolbarProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const typeBtnRef = useRef<HTMLButtonElement>(null)
  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const textBtnRef = useRef<HTMLButtonElement>(null)

  const getAnchorRect = useCallback((menu: OpenMenu): DOMRect => {
    const btn =
      menu === 'type'
        ? typeBtnRef.current
        : menu === 'color'
          ? colorBtnRef.current
          : menu === 'label'
            ? textBtnRef.current
            : null
    return btn?.getBoundingClientRect() ?? new DOMRect(x, y, 0, 0)
  }, [x, y])

  const toggleMenu = useCallback(
    (menu: OpenMenu) => {
      setOpenMenu((prev) => (prev === menu ? null : menu))
    },
    [],
  )

  /* ── Close submenu on click outside the toolbar ── */
  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (toolbarRef.current?.contains(target)) return
      setOpenMenu(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [openMenu])

  const handleSelectType = useCallback(
    (type: MermaidEdgeType) => {
      onTypeChange?.(type)
      setOpenMenu(null)
    },
    [onTypeChange],
  )

  const handleSelectColor = useCallback(
    (color: string) => {
      onColorChange?.(color)
      setOpenMenu(null)
    },
    [onColorChange],
  )

  const handleConfirmLabel = useCallback(
    (label: string) => {
      onLabelChange?.(label)
      setOpenMenu(null)
    },
    [onLabelChange],
  )

  const handleCancelLabel = useCallback(() => {
    setOpenMenu(null)
  }, [])

  if (!visible) return null

  return (
    <div
      ref={toolbarRef}
      className="mermaid-edge-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -140%)',
        zIndex: 20,
        pointerEvents: 'auto',
      }}
    >
      <button
        ref={typeBtnRef}
        className="mermaid-edge-toolbar-btn"
        title="Tipo de línea"
        onClick={() => toggleMenu('type')}
      >
        <Settings size={15} />
      </button>
      <button
        ref={colorBtnRef}
        className="mermaid-edge-toolbar-btn"
        title="Color"
        onClick={() => toggleMenu('color')}
      >
        <Palette size={15} />
      </button>
      <button
        ref={textBtnRef}
        className="mermaid-edge-toolbar-btn"
        title="Texto"
        onClick={() => toggleMenu('label')}
      >
        <Type size={15} />
      </button>

      <MermaidEdgeTypeMenu
        visible={openMenu === 'type'}
        anchorRect={getAnchorRect('type')}
        onSelect={handleSelectType}
      />
      <MermaidEdgeColorMenu
        visible={openMenu === 'color'}
        anchorRect={getAnchorRect('color')}
        onSelect={handleSelectColor}
      />
      <MermaidEdgeLabelEditor
        visible={openMenu === 'label'}
        anchorRect={getAnchorRect('label')}
        label={currentLabel}
        onConfirm={handleConfirmLabel}
        onCancel={handleCancelLabel}
      />
    </div>
  )
})
MermaidEdgeToolbar.displayName = 'MermaidEdgeToolbar'
