import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { X, Minus, Square } from 'lucide-react'

interface MermaidCodePanelProps {
  code: string
  onChange: (nextCode: string) => void
  hasError: boolean
  onClose: () => void
  theme: 'dark' | 'light'
}

const STORAGE_KEY = 'notia:mermaid-code-panel:geometry'

interface PanelGeometry {
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
}

function loadGeometry(): PanelGeometry {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PanelGeometry>
      return {
        x: parsed.x ?? 16,
        y: parsed.y ?? 16,
        width: parsed.width ?? 480,
        height: parsed.height ?? 360,
        minimized: parsed.minimized ?? false,
      }
    }
  } catch {
    // ignore
  }
  return { x: 16, y: 16, width: 480, height: 360, minimized: false }
}

function saveGeometry(geometry: PanelGeometry) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(geometry))
  } catch {
    // ignore
  }
}

export const MermaidCodePanel = memo(function MermaidCodePanel({
  code,
  onChange,
  hasError,
  onClose,
  theme,
}: MermaidCodePanelProps) {
  const [geometry, setGeometry] = useState<PanelGeometry>(loadGeometry)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; geom: PanelGeometry } | null>(null)
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; geom: PanelGeometry } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Map app theme to Monaco theme
  const editorTheme = theme === 'light' ? 'vs' : 'vs-dark'

  // Persist geometry on change
  useEffect(() => {
    saveGeometry(geometry)
  }, [geometry])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const dragStart = dragStartRef.current
    if (dragStart) {
      const dx = e.clientX - dragStart.mouseX
      const dy = e.clientY - dragStart.mouseY
      const { x, y } = dragStart.geom
      setGeometry(prev => ({
        ...prev,
        x: Math.max(0, x + dx),
        y: Math.max(0, y + dy),
      }))
    }
    const resizeStart = resizeStartRef.current
    if (resizeStart) {
      const dx = e.clientX - resizeStart.mouseX
      const dy = e.clientY - resizeStart.mouseY
      const { width, height } = resizeStart.geom
      setGeometry(prev => ({
        ...prev,
        width: Math.max(240, width + dx),
        height: Math.max(160, height + dy),
      }))
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setIsResizing(false)
    dragStartRef.current = null
    resizeStartRef.current = null
  }, [])

  useEffect(() => {
    if (!isDragging && !isResizing) return
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp])

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (geometry.minimized) return
    e.preventDefault()
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      geom: { ...geometry },
    }
    setIsDragging(true)
  }, [geometry])

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      geom: { ...geometry },
    }
    setIsResizing(true)
  }, [geometry])

  const handleToggleMinimize = useCallback(() => {
    setGeometry(prev => ({ ...prev, minimized: !prev.minimized }))
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    onChange(value ?? '')
  }, [onChange])

  return (
    <div
      ref={panelRef}
      className="mermaid-code-panel"
      style={{
        position: 'absolute',
        left: geometry.x,
        top: geometry.y,
        width: geometry.minimized ? 240 : geometry.width,
        height: geometry.minimized ? 36 : geometry.height,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-card-bg)',
        border: `1px solid ${hasError ? '#ff5555' : 'var(--color-border-soft)'}`,
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
        overflow: 'hidden',
        transition: geometry.minimized ? 'height 0.2s ease' : undefined,
      }}
    >
      {/* Header / drag handle */}
      <div
        className="mermaid-code-panel-header"
        onMouseDown={handleHeaderMouseDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          cursor: geometry.minimized ? 'default' : 'move',
          background: 'var(--color-sidebar-bg)',
          borderBottom: geometry.minimized ? 'none' : '1px solid var(--color-border-soft)',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-icon-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Código Mermaid
        </span>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <button
            className="mermaid-code-panel-btn"
            onClick={handleToggleMinimize}
            title={geometry.minimized ? 'Expandir' : 'Minimizar'}
            style={panelBtnStyle}
          >
            {geometry.minimized ? <Square size={12} /> : <Minus size={12} />}
          </button>
          <button
            className="mermaid-code-panel-btn"
            onClick={onClose}
            title="Cerrar"
            style={panelBtnStyle}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Editor */}
      {!geometry.minimized && (
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <Editor
            height="100%"
            language="mermaid"
            value={code}
            onChange={handleEditorChange}
            theme={editorTheme}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              lineNumbers: 'on',
              roundedSelection: false,
              scrollBeyondLastLine: false,
              readOnly: false,
              automaticLayout: true,
              padding: { top: 8 },
            }}
          />

          {/* Resize handle */}
          <div
            onMouseDown={handleResizeMouseDown}
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: 16,
              height: 16,
              cursor: 'nwse-resize',
              zIndex: 5,
              background: 'transparent',
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              style={{
                position: 'absolute',
                right: 3,
                bottom: 3,
                opacity: 0.4,
                pointerEvents: 'none',
              }}
            >
              <path d="M0 10 L10 0 M3 10 L10 3 M6 10 L10 6" stroke="var(--color-icon-muted)" strokeWidth="1" fill="none" />
            </svg>
          </div>
        </div>
      )}
    </div>
  )
})

const panelBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
  border: '1px solid var(--color-border-soft)',
  background: 'var(--color-card-bg)',
  color: 'var(--color-icon-muted)',
  cursor: 'pointer',
  transition: 'background 0.15s ease, color 0.15s ease',
  padding: 0,
  appearance: 'none',
}

MermaidCodePanel.displayName = 'MermaidCodePanel'
