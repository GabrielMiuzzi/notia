import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { RootState } from '../../../../store/hooks'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { useMermaidRender } from '../../../../modules/mermaid/hooks/useMermaidRender'
import {
  setMermaidTheme,
  toggleMermaidGrid,
  toggleMermaidRough,
  toggleMermaidPanZoom,
  setMermaidZoom,
  setMermaidPan,
} from '../../../../features/mermaidViewer/mermaidViewerSlice'
import { MermaidCodeEditor } from '../../../../modules/mermaid/components/MermaidCodeEditor'
import { MermaidErrorPanel } from '../../../../modules/mermaid/components/MermaidErrorPanel'
import { MermaidCanvas } from '../../../../modules/mermaid/components/MermaidCanvas'
import { MermaidViewerToggles } from '../../../../modules/mermaid/components/MermaidViewerToggles'
import { useSubmenuEngine } from '../../../../hooks/useSubmenuEngine'
import { MermaidShapesMenu } from '../../../../modules/mermaid/components/MermaidShapesMenu'
import { MermaidIconsMenu } from '../../../../modules/mermaid/components/MermaidIconsMenu'
import { MermaidCodePanel } from '../../../../modules/mermaid/components/MermaidCodePanel'
import { MermaidToolbar, type MermaidToolKind } from '../../../../modules/mermaid/components/MermaidToolbar'
import { buildMermaidNodeLine } from '../../../../modules/mermaid/utils/shapeSyntaxMap'
import { useMermaidDragGhost } from '../../../../modules/mermaid/hooks/useMermaidDragGhost'
import {
  extractMermaidNodeId,
  edgeExistsInCode,
  sanitizeMermaidCode,
  updateNodeLabelInCode,
  updateEdgeTypeInCode,
  updateEdgeColorInCode,
  updateEdgeLabelInCode,
} from '../../../../modules/mermaid/engines/mermaidEngine'
import type { MermaidEdgeType } from '../../../../modules/mermaid/types/mermaidTypes'
import '../../../../modules/mermaid/styles/mermaid.css'

interface MermaidViewProps {
  filePath: string
  source: string
  onSourcePersist: (nextSource: string) => Promise<void>
}

export const MermaidView = memo(function MermaidView({
  filePath,
  source,
  onSourcePersist,
}: MermaidViewProps) {
  void filePath // parameter required by parent but unused in this view
  const dispatch = useAppDispatch()
  const viewerState = useAppSelector((state: RootState) => state.mermaidViewer)
  const appTheme = useAppSelector((state: RootState) => state.preferences.theme)

  const [code, setCode] = useState(source)
  const [mobileMode, setMobileMode] = useState<'code' | 'diagram'>('diagram')
  const [isMobile, setIsMobile] = useState(false)
  const [configJson] = useState('{"securityLevel": "loose"}')
  const [panelOpen, setPanelOpen] = useState(true)
  const [activeTool, setActiveTool] = useState<MermaidToolKind>(null)
  const [isShapesMenuOpen, setIsShapesMenuOpen] = useState(false)
  const [isIconsMenuOpen, setIsIconsMenuOpen] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const { createGhost, removeGhost, animateDrop } = useMermaidDragGhost(canvasRef)

  // Drag state (refs to avoid re-renders during pointermove)
  const isDraggingRef = useRef(false)
  const pendingDragAliasRef = useRef<string | null>(null)
  const pendingDragIsIconRef = useRef(false)

  const { triggerRef: shapesTriggerRef, panelRef: shapesPanelRef } = useSubmenuEngine<
    HTMLButtonElement,
    HTMLDivElement
  >({
    open: isShapesMenuOpen,
    onClose: () => {
      setIsShapesMenuOpen(false)
      setActiveTool(null)
    },
  })

  const { triggerRef: iconsTriggerRef, panelRef: iconsPanelRef } = useSubmenuEngine<
    HTMLButtonElement,
    HTMLDivElement
  >({
    open: isIconsMenuOpen,
    onClose: () => {
      setIsIconsMenuOpen(false)
      setActiveTool(null)
    },
  })

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Sync mermaid viewer theme with global app theme
  useEffect(() => {
    const expectedMermaidTheme = appTheme === 'dark' ? 'dark' : 'default'
    if (viewerState.theme !== expectedMermaidTheme) {
      dispatch(setMermaidTheme(expectedMermaidTheme))
    }
  }, [appTheme, viewerState.theme, dispatch])

  // Sync external source changes (sanitize corrupt edges on load)
  useEffect(() => {
    const clean = sanitizeMermaidCode(source)
    setCode(clean === source ? source : clean)
  }, [source])

  const { result, error, isLoading } = useMermaidRender({
    code,
    config: configJson,
    theme: viewerState.theme,
  })

  const handleCodeChange = useCallback(
    (nextCode: string) => {
      setCode(nextCode)
    },
    [],
  )

  const handleToolChange = useCallback(
    (tool: MermaidToolKind) => {
      if (tool === 'shapes') {
        setIsShapesMenuOpen((prev) => {
          const next = !prev
          setIsIconsMenuOpen(false)
          setActiveTool(next ? 'shapes' : null)
          return next
        })
      } else if (tool === 'icons') {
        setIsIconsMenuOpen((prev) => {
          const next = !prev
          setIsShapesMenuOpen(false)
          setActiveTool(next ? 'icons' : null)
          return next
        })
      } else {
        setIsShapesMenuOpen(false)
        setIsIconsMenuOpen(false)
        setActiveTool(tool)
      }
    },
    [],
  )

  const handleIconSelect = useCallback(
    (iconRef: string) => {
      const id = `n${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const label = iconRef.split(':').pop() || iconRef
      const line = `  ${id}@{ icon: "${iconRef}", form: "square", label: "${label}" }`
      let newCode: string
      const trimmed = code.trim()
      if (!trimmed) {
        newCode = `flowchart TD\n${line}`
      } else if (trimmed.toLowerCase().startsWith('flowchart') || trimmed.toLowerCase().startsWith('graph')) {
        newCode = `${trimmed}\n${line}`
      } else {
        newCode = `flowchart TD\n${line}\n${trimmed}`
      }
      setCode(newCode)
      setIsIconsMenuOpen(false)
      setActiveTool(null)
    },
    [code],
  )

  const handleShapeSelect = useCallback(
    (alias: string) => {
      const id = `n${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const line = buildMermaidNodeLine(id, alias)
      let newCode: string
      const trimmed = code.trim()
      if (!trimmed) {
        newCode = `flowchart TD\n${line}`
      } else if (trimmed.toLowerCase().startsWith('flowchart') || trimmed.toLowerCase().startsWith('graph')) {
        newCode = `${trimmed}\n${line}`
      } else {
        newCode = `flowchart TD\n${line}\n${trimmed}`
      }
      setCode(newCode)
      setIsShapesMenuOpen(false)
      setActiveTool(null)
    },
    [code],
  )

  const handleConnect = useCallback(
    (rawFromId: string, rawToId: string) => {
      const fromNodeId = extractMermaidNodeId(rawFromId)
      const toNodeId = extractMermaidNodeId(rawToId)
      if (!fromNodeId || !toNodeId) return

      const trimmed = code.trim()
      if (
        trimmed &&
        !trimmed.toLowerCase().startsWith('flowchart') &&
        !trimmed.toLowerCase().startsWith('graph')
      ) {
        return
      }
      if (edgeExistsInCode(trimmed, fromNodeId, toNodeId)) return

      const edgeLine = `  ${fromNodeId} --> ${toNodeId}`
      const newCode = trimmed ? `${trimmed}\n${edgeLine}` : `flowchart TD\n${edgeLine}`
      setCode(newCode)
    },
    [code],
  )

  const handleNodeLabelEdit = useCallback(
    (nodeId: string, newLabel: string) => {
      const trimmed = code.trim()
      if (
        trimmed &&
        !trimmed.toLowerCase().startsWith('flowchart') &&
        !trimmed.toLowerCase().startsWith('graph')
      ) {
        return
      }
      const nextCode = updateNodeLabelInCode(code, nodeId, newLabel)
      if (nextCode !== code) setCode(nextCode)
    },
    [code],
  )

  const handleEdgeTypeChange = useCallback(
    (fromId: string, toId: string, type: MermaidEdgeType) => {
      const trimmed = code.trim()
      if (
        trimmed &&
        !trimmed.toLowerCase().startsWith('flowchart') &&
        !trimmed.toLowerCase().startsWith('graph')
      ) {
        return
      }
      const nextCode = updateEdgeTypeInCode(code, fromId, toId, type)
      if (nextCode !== code) setCode(nextCode)
    },
    [code],
  )

  const handleEdgeColorChange = useCallback(
    (fromId: string, toId: string, color: string) => {
      const trimmed = code.trim()
      if (
        trimmed &&
        !trimmed.toLowerCase().startsWith('flowchart') &&
        !trimmed.toLowerCase().startsWith('graph')
      ) {
        return
      }
      const nextCode = updateEdgeColorInCode(code, fromId, toId, color)
      if (nextCode !== code) setCode(nextCode)
    },
    [code],
  )

  const handleEdgeLabelChange = useCallback(
    (fromId: string, toId: string, label: string) => {
      const trimmed = code.trim()
      if (
        trimmed &&
        !trimmed.toLowerCase().startsWith('flowchart') &&
        !trimmed.toLowerCase().startsWith('graph')
      ) {
        return
      }
      const nextCode = updateEdgeLabelInCode(code, fromId, toId, label)
      if (nextCode !== code) setCode(nextCode)
    },
    [code],
  )

  // ── Drag-to-drop (pointer-based, no HTML5 DnD) ────────────────────

  const handleIconDragStart = useCallback(
    (iconRef: string, previewHtml: string, e: PointerEvent) => {
      setIsIconsMenuOpen(false)
      setIsShapesMenuOpen(false)
      isDraggingRef.current = true
      pendingDragAliasRef.current = iconRef
      pendingDragIsIconRef.current = true
      createGhost('icon', iconRef, previewHtml, e)
    },
    [createGhost],
  )

  const handleShapeDragStart = useCallback(
    (alias: string, previewHtml: string, e: PointerEvent) => {
      setIsShapesMenuOpen(false)
      setIsIconsMenuOpen(false)
      isDraggingRef.current = true
      pendingDragAliasRef.current = alias
      pendingDragIsIconRef.current = false
      createGhost('shape', alias, previewHtml, e)
    },
    [createGhost],
  )

  // Global pointerup: drop the item if over canvas, cancel if outside
  useEffect(() => {
    const onPointerUp = (e: PointerEvent) => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false

      const target = document.elementFromPoint(e.clientX, e.clientY) as Element | null
      const isOverCanvas = target
        ? target.closest('.mermaid-canvas-wrapper') != null
        : false

      if (isOverCanvas) {
        const alias = pendingDragAliasRef.current
        const isIcon = pendingDragIsIconRef.current
        if (alias) {
          if (isIcon) {
            animateDrop(() => handleIconSelect(alias))
          } else {
            animateDrop(() => handleShapeSelect(alias))
          }
        } else {
          removeGhost()
        }
      } else {
        removeGhost()
      }

      pendingDragAliasRef.current = null
      pendingDragIsIconRef.current = false
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDraggingRef.current) {
        isDraggingRef.current = false
        pendingDragAliasRef.current = null
        pendingDragIsIconRef.current = false
        removeGhost()
      }
    }

    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('keydown', onKey)
    }
  }, [animateDrop, removeGhost, handleShapeSelect, handleIconSelect])

  // ── Persist code after debounce ──────────────────────────────────
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current)
    }
    const id = setTimeout(() => {
      if (code !== source) {
        void onSourcePersist(code)
      }
    }, 800)
    persistTimeoutRef.current = id
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current)
      }
    }
  }, [code, source, onSourcePersist])

  const handleZoomChange = useCallback(
    (zoom: number) => {
      dispatch(setMermaidZoom(zoom))
    },
    [dispatch],
  )

  const handlePanChange = useCallback(
    (x: number, y: number) => {
      dispatch(setMermaidPan({ x, y }))
    },
    [dispatch],
  )

  const handleThemeChange = useCallback(
    (theme: string) => {
      dispatch(setMermaidTheme(theme))
    },
    [dispatch],
  )

  return (
    <div className="mermaid-view">
      {/* Top bar: solo mobile */}
      {isMobile && (
        <div className="mermaid-toolbar">
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              style={{
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 4,
                border: '1px solid var(--color-border-soft)',
                background: mobileMode === 'code' ? 'var(--color-accent-text)' : 'var(--color-card-bg)',
                color: mobileMode === 'code' ? '#fff' : 'var(--color-app-text)',
                cursor: 'pointer',
              }}
              onClick={() => setMobileMode('code')}
            >
              Código
            </button>
            <button
              style={{
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 4,
                border: '1px solid var(--color-border-soft)',
                background: mobileMode === 'diagram' ? 'var(--color-accent-text)' : 'var(--color-card-bg)',
                color: mobileMode === 'diagram' ? '#fff' : 'var(--color-app-text)',
                cursor: 'pointer',
              }}
              onClick={() => setMobileMode('diagram')}
            >
              Diagrama
            </button>
          </div>
          <div className="mermaid-toolbar-spacer" />
          <span style={{ fontSize: 11, color: 'var(--color-icon-muted)' }}>
            {error ? 'Error de sintaxis' : 'Listo'}
          </span>
        </div>
      )}

      {isMobile ? (
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: mobileMode === 'code' ? 'translateX(0%)' : 'translateX(-100%)',
              transition: 'transform 0.3s ease',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
            }}
          >
            <MermaidCodeEditor code={code} onChange={handleCodeChange} hasError={Boolean(error)} />
            <MermaidErrorPanel error={error} />
          </div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: mobileMode === 'diagram' ? 'translateX(0%)' : 'translateX(100%)',
              transition: 'transform 0.3s ease',
              height: '100%',
            }}
          >
            <MermaidCanvas
              result={result}
              isLoading={isLoading}
              error={error}
              gridEnabled={viewerState.gridEnabled}
              panZoomEnabled={viewerState.panZoomEnabled}
              theme={viewerState.theme}
              roughEnabled={viewerState.roughEnabled}
              initialZoom={viewerState.zoom}
              initialPanX={viewerState.panX}
              initialPanY={viewerState.panY}
              onZoomChange={handleZoomChange}
              onPanChange={handlePanChange}
              onConnect={handleConnect}
              onNodeLabelEdit={handleNodeLabelEdit}
              onEdgeTypeChange={handleEdgeTypeChange}
              onEdgeColorChange={handleEdgeColorChange}
              onEdgeLabelChange={handleEdgeLabelChange}
            />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <MermaidToolbar
            activeTool={activeTool}
            onToolChange={handleToolChange}
            shapesTriggerRef={shapesTriggerRef}
            iconsTriggerRef={iconsTriggerRef}
          />
          {isShapesMenuOpen && (
            <MermaidShapesMenu
              panelRef={shapesPanelRef}
              triggerRef={shapesTriggerRef}
              onShapeSelect={handleShapeSelect}
              onShapeDragStart={handleShapeDragStart}
            />
          )}
          {isIconsMenuOpen && (
            <MermaidIconsMenu
              panelRef={iconsPanelRef}
              triggerRef={iconsTriggerRef}
              onIconSelect={handleIconSelect}
              onIconDragStart={handleIconDragStart}
            />
          )}
          <MermaidCanvas
            result={result}
            isLoading={isLoading}
            error={error}
            gridEnabled={viewerState.gridEnabled}
            panZoomEnabled={viewerState.panZoomEnabled}
            theme={viewerState.theme}
            roughEnabled={viewerState.roughEnabled}
            initialZoom={viewerState.zoom}
            initialPanX={viewerState.panX}
            initialPanY={viewerState.panY}
            onZoomChange={handleZoomChange}
            onPanChange={handlePanChange}
            onConnect={handleConnect}
            onNodeLabelEdit={handleNodeLabelEdit}
            onEdgeTypeChange={handleEdgeTypeChange}
            onEdgeColorChange={handleEdgeColorChange}
            onEdgeLabelChange={handleEdgeLabelChange}
            canvasRef={canvasRef}
          />
          {panelOpen && (
            <MermaidCodePanel
              code={code}
              onChange={handleCodeChange}
              hasError={Boolean(error)}
              onClose={() => setPanelOpen(false)}
              theme={appTheme}
            />
          )}
          <MermaidViewerToggles
            gridEnabled={viewerState.gridEnabled}
            roughEnabled={viewerState.roughEnabled}
            panZoomEnabled={viewerState.panZoomEnabled}
            onToggleGrid={() => dispatch(toggleMermaidGrid())}
            onToggleRough={() => dispatch(toggleMermaidRough())}
            onTogglePanZoom={() => dispatch(toggleMermaidPanZoom())}
            theme={viewerState.theme}
            onThemeChange={handleThemeChange}
          />
        </div>
      )}
    </div>
  )
})
MermaidView.displayName = 'MermaidView'
