import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, FileText, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { useAppSelector } from '../../../store/hooks'
import { selectActiveLibraryPath } from '../../../features/library/librarySelectors'
import { selectTheme } from '../../../features/preferences/preferencesSelectors'
import { NotiaButton } from '../../common/NotiaButton'
import { MermaidCanvas } from '../../../modules/mermaid/components/MermaidCanvas'
import { useMermaidRender } from '../../../modules/mermaid/hooks/useMermaidRender'
import { buildLinkCacheMermaidCode } from '../../../engines/graph/linkCacheMermaidEngine'
import { buildGraphSearchResults } from '../../../engines/graph/graphSearchEngine'
import { extractMermaidNodeId } from '../../../modules/mermaid/engines/mermaidEngine'
import type { LibraryGraphModel } from '../../../types/graph/libraryGraph'
import { notiaTimer } from '../../../services/runtime/notiaLogger'

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

function areGraphViewPropsEqual(
  previous: GraphViewProps,
  next: GraphViewProps,
): boolean {
  if (previous.graphModel !== next.graphModel) {
    return false
  }

  if (previous.graphSourcesByPath !== next.graphSourcesByPath) {
    return false
  }

  if (previous.libraryName !== next.libraryName) {
    return false
  }

  if (previous.isLoading !== next.isLoading) {
    return false
  }

  if (previous.onOpenFile !== next.onOpenFile) {
    return false
  }

  if (previous.chatSelectedPaths !== next.chatSelectedPaths) {
    return false
  }

  if (previous.onChatSelectedPathsChange !== next.onChatSelectedPathsChange) {
    return false
  }

  return true
}

function GraphViewComponent({
  graphModel,
  graphSourcesByPath,
  onOpenFile,
  chatSelectedPaths = [],
  onChatSelectedPathsChange,
}: GraphViewProps) {
  const mountTimerRef = useRef(
    notiaTimer('graph', 'GraphView mount', {
      nodeCount: graphModel.nodes.length,
      edgeCount: graphModel.edges.length,
    }),
  )
  useEffect(() => {
    const mountTimer = mountTimerRef.current
    return () => {
      mountTimer.success()
    }
  }, [])

  const activeLibraryPath = useAppSelector(selectActiveLibraryPath)
  const appTheme = useAppSelector(selectTheme)
  const rootPath = activeLibraryPath

  const [searchQuery, setSearchQuery] = useState('')
  const [isControlsOpen, setIsControlsOpen] = useState(false)
  const [settings, setSettings] = useState<GraphSettings>(() => ({
    gridEnabled: readStoredSettings().gridEnabled ?? true,
  }))
  const [viewport, setViewport] = useState<Partial<ViewportState>>(() => readStoredViewport())
  const [focusRequest, setFocusRequest] = useState<{ element: Element; requestId: number } | null>(null)

  const searchResults = useMemo(
    () => buildGraphSearchResults(
      graphModel,
      graphSourcesByPath,
      searchQuery,
      graphModel.nodes.length,
    ),
    [graphModel, graphSourcesByPath, searchQuery],
  )
  const matchedPaths = useMemo(
    () => new Set(searchResults.map((searchResult) => searchResult.path)),
    [searchResults],
  )

  const svgWrapperRef = useRef<HTMLDivElement | null>(null)

  const handleFocusSearchResult = useCallback((path: string) => {
    const nodes = svgWrapperRef.current?.querySelectorAll('[data-notia-path]') ?? []
    const targetNode = Array.from(nodes).find((node) => node.getAttribute('data-notia-path') === path)
    if (!targetNode) return

    setFocusRequest((current) => ({
      element: targetNode,
      requestId: (current?.requestId ?? 0) + 1,
    }))
  }, [])

  const handleToggleSearchResultInChat = useCallback((path: string) => {
    if (!onChatSelectedPathsChange) return
    onChatSelectedPathsChange(
      chatSelectedPaths.includes(path)
        ? chatSelectedPaths.filter((selectedPath) => selectedPath !== path)
        : [...chatSelectedPaths, path],
    )
  }, [chatSelectedPaths, onChatSelectedPathsChange])

  // Cleanup on unmount: clear result so MermaidCanvas unmount clears SVG
  useEffect(() => {
    return () => {
      setSearchQuery('')
      setIsControlsOpen(false)
    }
  }, [])

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
    const hasSearchQuery = searchQuery.trim().length > 0
    nodeElements.forEach((el) => {
      const htmlEl = el as HTMLElement
      const path = htmlEl.getAttribute('data-notia-path')
      if (!path) return
      const matches = matchedPaths.has(path)
      htmlEl.classList.toggle('notia-graph-node--search-match', hasSearchQuery && matches)
      htmlEl.classList.toggle('notia-graph-node--search-dimmed', hasSearchQuery && !matches)
      const shape = htmlEl.querySelector('rect, circle, ellipse, polygon, path') as SVGElement | null
      if (shape) {
        if (matches || !hasSearchQuery) {
          shape.style.opacity = ''
          shape.style.filter = ''
        } else {
          shape.style.opacity = '0.3'
          shape.style.filter = 'grayscale(0.8)'
        }
      }
    })
  }, [matchedPaths, safeIdToPath, searchQuery])

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

    const hasSearchQuery = searchQuery.trim().length > 0
    svg.querySelectorAll('.node, .icon-shape').forEach((el) => {
      const htmlEl = el as HTMLElement
      const path = htmlEl.getAttribute('data-notia-path')
      if (!path) return
      const matches = matchedPaths.has(path)
      htmlEl.classList.toggle('notia-graph-node--search-match', hasSearchQuery && matches)
      htmlEl.classList.toggle('notia-graph-node--search-dimmed', hasSearchQuery && !matches)
      const shape = htmlEl.querySelector('rect, circle, ellipse, polygon, path') as SVGElement | null
      if (shape) {
        if (matches || !hasSearchQuery) {
          shape.style.opacity = ''
          shape.style.filter = ''
        } else {
          shape.style.opacity = '0.3'
          shape.style.filter = 'grayscale(0.8)'
        }
      }
    })
  }, [matchedPaths, searchQuery])

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
      <div className="notia-graph-search-shell">
        {searchQuery.trim() && (
          <div
            className="notia-graph-search-results"
            role="list"
            aria-label="Archivos que coinciden con la búsqueda"
          >
            {searchResults.length > 0 ? searchResults.map((searchResult) => (
              <div
                key={searchResult.path}
                className="notia-graph-search-result"
              >
                <div className="notia-graph-search-result-main">
                  <strong>{searchResult.label}</strong>
                  <span>{searchResult.preview}</span>
                </div>
                <button
                  type="button"
                  className="notia-graph-search-result-action"
                  onClick={() => handleFocusSearchResult(searchResult.path)}
                  aria-label={`Ver ${searchResult.label} en el grafo`}
                  title="Ver en el grafo"
                >
                  <Eye size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`notia-graph-search-result-action${chatSelectedPaths.includes(searchResult.path) ? ' is-selected' : ''}`}
                  onClick={() => handleToggleSearchResultInChat(searchResult.path)}
                  disabled={!onChatSelectedPathsChange}
                  aria-label={`${chatSelectedPaths.includes(searchResult.path) ? 'Quitar' : 'Agregar'} ${searchResult.label} ${chatSelectedPaths.includes(searchResult.path) ? 'del' : 'al'} contexto del chat`}
                  aria-pressed={chatSelectedPaths.includes(searchResult.path)}
                  title={chatSelectedPaths.includes(searchResult.path) ? 'Quitar del contexto del chat' : 'Agregar al contexto del chat'}
                >
                  <Plus size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="notia-graph-search-result-action"
                  onClick={() => onOpenFile(searchResult.path)}
                  aria-label={`Abrir ${searchResult.label}`}
                  title="Abrir archivo"
                >
                  <FileText size={18} aria-hidden="true" />
                </button>
              </div>
            )) : (
              <div className="notia-graph-search-empty" role="status">
                No se encontraron archivos.
              </div>
            )}
          </div>
        )}
        <label className="notia-graph-search-bar">
          <Search size={18} aria-hidden="true" />
          <input
            type="text"
            placeholder="Buscar por título o contenido..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Buscar archivos por título o contenido"
          />
          {searchQuery && (
            <button
              type="button"
              className="notia-graph-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Limpiar búsqueda"
            >
              <X size={18} />
            </button>
          )}
        </label>
      </div>

      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 9 }}>
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
            focusRequest={focusRequest}
          />
        )}
      </div>
    </div>
  )
}

export const GraphView = memo(GraphViewComponent, areGraphViewPropsEqual)
GraphView.displayName = 'GraphView'
