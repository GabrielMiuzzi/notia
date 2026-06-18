import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useAppSelector } from '../../../store/hooks'
import { selectActiveLibrary } from '../../../features/library/librarySelectors'
import { selectTheme } from '../../../features/preferences/preferencesSelectors'
import { NotiaButton } from '../../common/NotiaButton'
import { MermaidCanvas } from '../../../modules/mermaid/components/MermaidCanvas'
import { useMermaidRender } from '../../../modules/mermaid/hooks/useMermaidRender'
import { buildLinkCacheMermaidCode } from '../../../engines/graph/linkCacheMermaidEngine'
import { extractMermaidNodeId } from '../../../modules/mermaid/engines/mermaidEngine'
import type { LibraryGraphModel } from '../../../types/graph/libraryGraph'

const VIEWPORT_STORAGE_KEY = 'notia.linkGraphView.viewport.v1'
const SETTINGS_STORAGE_KEY = 'notia.linkGraphView.settings.v1'

interface ViewportState {
  zoom: number
  panX: number
  panY: number
}

interface GraphSettings {
  gridEnabled: boolean
}

function readStoredViewport(): Partial<ViewportState> {
  try {
    const raw = window.localStorage.getItem(VIEWPORT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const obj = parsed as Record<string, unknown>
    return {
      zoom: typeof obj.zoom === 'number' ? obj.zoom : undefined,
      panX: typeof obj.panX === 'number' ? obj.panX : undefined,
      panY: typeof obj.panY === 'number' ? obj.panY : undefined,
    }
  } catch {
    return {}
  }
}

function writeStoredViewport(vp: ViewportState): void {
  try {
    window.localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(vp))
  } catch {
    // ignore
  }
}

function readStoredSettings(): Partial<GraphSettings> {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const obj = parsed as Record<string, unknown>
    return {
      gridEnabled: typeof obj.gridEnabled === 'boolean' ? obj.gridEnabled : undefined,
    }
  } catch {
    return {}
  }
}

function writeStoredSettings(settings: GraphSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // ignore
  }
}

interface GraphViewProps {
  graphModel: LibraryGraphModel
  graphSourcesByPath: Record<string, string>
  libraryName: string
  isLoading: boolean
  onOpenFile: (filePath: string) => void
  chatSelectedPaths?: string[]
  onChatSelectedPathsChange?: (paths: string[]) => void
}

export const GraphView = memo(function GraphView({
  graphModel,
  onOpenFile,
  chatSelectedPaths = [],
  onChatSelectedPathsChange,
}: GraphViewProps) {
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const appTheme = useAppSelector(selectTheme)
  const rootPath = activeLibrary?.path ?? null

  const [searchQuery, setSearchQuery] = useState('')
  const [isControlsOpen, setIsControlsOpen] = useState(false)
  const [settings, setSettings] = useState<GraphSettings>(() => ({
    gridEnabled: readStoredSettings().gridEnabled ?? true,
  }))
  const [viewport, setViewport] = useState<Partial<ViewportState>>(() => readStoredViewport())

  const svgWrapperRef = useRef<HTMLDivElement | null>(null)

  // Generate mermaid code from graph model
  const mermaidCode = useMemo(() => {
    if (graphModel.nodes.length === 0) {
      return ''
    }
    const result = buildLinkCacheMermaidCode(graphModel, rootPath)
    return result.code
  }, [graphModel, rootPath])

  const { result, error, isLoading } = useMermaidRender({
    code: mermaidCode,
    theme: appTheme === 'dark' ? 'dark' : 'default',
  })

  // Build reverse lookup map whenever the graph model changes
  const safeIdToPath = useMemo(() => {
    if (graphModel.nodes.length === 0) {
      return new Map<string, string>()
    }
    const { pathToSafeId } = buildLinkCacheMermaidCode(graphModel, rootPath)
    return new Map(
      Array.from(pathToSafeId.entries()).map(([path, safeId]) => [safeId, path]),
    )
  }, [graphModel, rootPath])

  // Post-render: inject data attributes into SVG nodes for click handling
  const handleSvgInjected = useCallback((container: HTMLDivElement) => {
    const svg = container.querySelector('svg')
    if (!svg) return

    if (safeIdToPath.size === 0) return

    const nodeElements = svg.querySelectorAll('.node, .icon-shape')
    nodeElements.forEach((el) => {
      const rawId = el.id
      if (!rawId) return
      const extractedId = extractMermaidNodeId(rawId)
      if (!extractedId) return
      const filePath = safeIdToPath.get(extractedId)
      if (!filePath) return
      ;(el as HTMLElement).setAttribute('data-notia-path', filePath)
    })

    // Apply current search highlight immediately after render
    const normalizedQuery = searchQuery.trim().toLowerCase()
    nodeElements.forEach((el) => {
      const htmlEl = el as HTMLElement
      const path = htmlEl.getAttribute('data-notia-path')
      if (!path) return
      const node = graphModel.nodes.find((n) => n.path === path)
      if (!node) return
      const matches = normalizedQuery.length > 0 && node.label.toLowerCase().includes(normalizedQuery)
      const shape = htmlEl.querySelector('rect, circle, ellipse, polygon, path') as SVGElement | null
      if (shape) {
        if (matches || normalizedQuery.length === 0) {
          shape.style.opacity = ''
          shape.style.filter = ''
        } else {
          shape.style.opacity = '0.3'
          shape.style.filter = 'grayscale(0.8)'
        }
      }
    })
  }, [searchQuery, graphModel, safeIdToPath])

  // Click handler: open file or toggle chat selection
  const handleNodeClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      const nodeEl = target.closest('[data-notia-path]') as HTMLElement | null
      if (!nodeEl) return
      const path = nodeEl.getAttribute('data-notia-path')
      if (!path) return

      if (e.shiftKey && onChatSelectedPathsChange) {
        onChatSelectedPathsChange(
          chatSelectedPaths.includes(path)
            ? chatSelectedPaths.filter((p) => p !== path)
            : [...chatSelectedPaths, path],
        )
      } else {
        onOpenFile(path)
      }
    },
    [chatSelectedPaths, onChatSelectedPathsChange, onOpenFile],
  )

  // Search highlight re-application when query changes (SVG already rendered)
  useEffect(() => {
    const wrapper = svgWrapperRef.current
    if (!wrapper) return
    const svg = wrapper.querySelector('svg') as SVGSVGElement | null
    if (!svg) return

    const normalizedQuery = searchQuery.trim().toLowerCase()
    svg.querySelectorAll('.node, .icon-shape').forEach((el) => {
      const htmlEl = el as HTMLElement
      const path = htmlEl.getAttribute('data-notia-path')
      if (!path) return
      const node = graphModel.nodes.find((n) => n.path === path)
      if (!node) return
      const matches = normalizedQuery.length > 0 && node.label.toLowerCase().includes(normalizedQuery)
      const shape = htmlEl.querySelector('rect, circle, ellipse, polygon, path') as SVGElement | null
      if (shape) {
        if (matches || normalizedQuery.length === 0) {
          shape.style.opacity = ''
          shape.style.filter = ''
        } else {
          shape.style.opacity = '0.3'
          shape.style.filter = 'grayscale(0.8)'
        }
      }
    })
  }, [searchQuery, graphModel])

  // Selection visual feedback
  useEffect(() => {
    const wrapper = svgWrapperRef.current
    if (!wrapper) return
    const svg = wrapper.querySelector('svg') as SVGSVGElement | null
    if (!svg) return

    svg.querySelectorAll('.node, .icon-shape').forEach((el) => {
      const htmlEl = el as HTMLElement
      const path = htmlEl.getAttribute('data-notia-path')
      if (!path) return
      const isSelected = chatSelectedPaths.includes(path)
      const shape = htmlEl.querySelector('rect, circle, ellipse, polygon, path') as SVGElement | null
      if (shape) {
        if (isSelected) {
          shape.style.stroke = '#ff79c6'
          shape.style.strokeWidth = '3'
        } else {
          shape.style.stroke = ''
          shape.style.strokeWidth = ''
        }
      }
    })
  }, [chatSelectedPaths])

  // Persist settings
  useEffect(() => {
    writeStoredSettings(settings)
  }, [settings])

  const handleZoomChange = useCallback((zoom: number) => {
    setViewport((prev) => {
      const base: ViewportState = { zoom: 1, panX: 0, panY: 0 }
      const next: ViewportState = { ...base, ...prev, zoom }
      writeStoredViewport(next)
      return next
    })
  }, [])

  const handlePanChange = useCallback((x: number, y: number) => {
    setViewport((prev) => {
      const base: ViewportState = { zoom: 1, panX: 0, panY: 0 }
      const next: ViewportState = { ...base, ...prev, panX: x, panY: y }
      writeStoredViewport(next)
      return next
    })
  }, [])

  const hasContent = mermaidCode.trim().length > 0

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-app-bg)',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-icon-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            placeholder="Buscar nodo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              height: 32,
              paddingLeft: 28,
              paddingRight: 28,
              borderRadius: 4,
              border: '1px solid var(--color-border-soft)',
              background: 'var(--color-card-bg)',
              color: 'var(--color-app-text)',
              fontSize: 13,
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--color-icon-muted)',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <NotiaButton
          variant="ghost"
          size="icon"
          onClick={() => setIsControlsOpen((prev) => !prev)}
          aria-label="Ajustes del grafo"
        >
          <SlidersHorizontal size={16} />
        </NotiaButton>
      </div>

      {/* Controls panel */}
      {isControlsOpen && (
        <div
          style={{
            position: 'absolute',
            top: 48,
            right: 12,
            zIndex: 10,
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-border-soft)',
            borderRadius: 8,
            padding: 12,
            minWidth: 200,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: 'var(--color-app-text)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={settings.gridEnabled}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, gridEnabled: e.target.checked }))
              }
            />
            Mostrar grid
          </label>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={svgWrapperRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
        onClick={handleNodeClick}
      >
        {(!hasContent || isLoading) && !error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-icon-muted)',
              fontSize: 13,
              pointerEvents: 'none',
            }}
          >
            {!hasContent ? 'No hay nodos para mostrar.' : 'Renderizando diagrama...'}
          </div>
        )}
        {error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ff5555',
              fontSize: 13,
              padding: 16,
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            {error}
          </div>
        )}
        {hasContent && (
          <MermaidCanvas
            result={result}
            isLoading={isLoading}
            error={error}
            gridEnabled={settings.gridEnabled}
            panZoomEnabled
            theme={appTheme === 'dark' ? 'dark' : 'default'}
            readOnly
            onSvgInjected={handleSvgInjected}
            initialZoom={viewport.zoom}
            initialPanX={viewport.panX}
            initialPanY={viewport.panY}
            onZoomChange={handleZoomChange}
            onPanChange={handlePanChange}
          />
        )}
      </div>
    </div>
  )
})
GraphView.displayName = 'GraphView'
