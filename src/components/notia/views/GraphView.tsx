import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Eye, FileText, LocateFixed, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import ForceGraph2D from 'react-force-graph-2d'
import { useAppSelector } from '../../../store/hooks'
import { selectTheme } from '../../../features/preferences/preferencesSelectors'
import { NotiaButton } from '../../common/NotiaButton'
import type { GraphSearchResult } from '../../../hooks/useLibraryGraphData'
import { buildGraphContextLegend } from '../../../engines/graph/graphLegendEngine'
import type { LibraryGraphModel, LibraryGraphNode } from '../../../types/graph/libraryGraph'
import type { LibraryContext } from '../../../services/contexts/libraryContexts'
import { notiaTimer } from '../../../services/runtime/notiaLogger'

const SETTINGS_STORAGE_KEY = 'notia.linkGraphView.settings.v1'

interface GraphSettings {
  gridEnabled: boolean
}

interface ForceNode extends LibraryGraphNode {
  id: string
  x?: number
  y?: number
  vx?: number
  vy?: number
}

interface ForceLink {
  id: string
  source: string | ForceNode
  target: string | ForceNode
}

type GraphRef = ComponentRef<typeof ForceGraph2D>

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
    // localStorage puede estar deshabilitado en algunos WebViews.
  }
}

function getNodePath(value: string | ForceNode | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.path
}

function getContextColor(node: ForceNode, appTheme: string): string {
  if (node.contextColor) return node.contextColor
  return appTheme === 'dark' ? '#8be9fd' : '#2762d8'
}

function escapeTooltipHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character] ?? character
  })
}

interface GraphViewProps {
  graphModel: LibraryGraphModel
  /** Title and content search resolved by the backend. */
  searchGraph: (query: string) => Promise<GraphSearchResult[]>
  libraryName: string
  contexts: readonly LibraryContext[]
  isLoading: boolean
  onOpenFile: (filePath: string) => void
  chatSelectedPaths?: string[]
  onChatSelectedPathsChange?: (paths: string[]) => void
}

function areGraphViewPropsEqual(
  previous: GraphViewProps,
  next: GraphViewProps,
): boolean {
  return (
    previous.graphModel === next.graphModel &&
    previous.searchGraph === next.searchGraph &&
    previous.libraryName === next.libraryName &&
    previous.contexts === next.contexts &&
    previous.isLoading === next.isLoading &&
    previous.onOpenFile === next.onOpenFile &&
    previous.chatSelectedPaths === next.chatSelectedPaths &&
    previous.onChatSelectedPathsChange === next.onChatSelectedPathsChange
  )
}

function GraphViewComponent({
  graphModel,
  searchGraph,
  contexts,
  isLoading,
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
    return () => mountTimer.success()
  }, [])

  const appTheme = useAppSelector(selectTheme)
  const [searchQuery, setSearchQuery] = useState('')
  const [isControlsOpen, setIsControlsOpen] = useState(false)
  const [settings, setSettings] = useState<GraphSettings>(() => ({
    gridEnabled: readStoredSettings().gridEnabled ?? true,
  }))
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const [graphSize, setGraphSize] = useState({ width: 0, height: 0 })

  const graphHostRef = useRef<HTMLDivElement | null>(null)
  const graphRef = useRef<GraphRef | undefined>(undefined)

  useEffect(() => {
    const host = graphHostRef.current
    if (!host) return

    const updateSize = () => {
      setGraphSize({
        width: Math.max(1, Math.floor(host.clientWidth)),
        height: Math.max(1, Math.floor(host.clientHeight)),
      })
    }
    updateSize()

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(host)
    return () => resizeObserver.disconnect()
  }, [])

  const [searchResults, setSearchResults] = useState<GraphSearchResult[]>([])
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    let isCurrent = true
    const timer = window.setTimeout(() => {
      searchGraph(searchQuery)
        .then((results) => { if (isCurrent) setSearchResults(results) })
        .catch(() => { if (isCurrent) setSearchResults([]) })
    }, 150)
    return () => {
      isCurrent = false
      window.clearTimeout(timer)
    }
  }, [searchGraph, searchQuery])
  const matchedPaths = useMemo(
    () => new Set(searchResults.map((searchResult) => searchResult.path)),
    [searchResults],
  )
  const selectedPaths = useMemo(() => new Set(chatSelectedPaths), [chatSelectedPaths])

  const graphData = useMemo(() => ({
    nodes: graphModel.nodes.map((node): ForceNode => ({
      ...node,
      id: node.path,
    })),
    links: graphModel.edges.map((edge): ForceLink => ({
      ...edge,
      source: edge.sourcePath,
      target: edge.targetPath,
    })),
  }), [graphModel.edges, graphModel.nodes])

  const hoveredNeighborPaths = useMemo(() => {
    const neighbors = new Set<string>()
    if (!hoveredPath) return neighbors

    graphData.links.forEach((link) => {
      const sourcePath = getNodePath(link.source)
      const targetPath = getNodePath(link.target)
      if (sourcePath === hoveredPath && targetPath) neighbors.add(targetPath)
      if (targetPath === hoveredPath && sourcePath) neighbors.add(sourcePath)
    })
    return neighbors
  }, [graphData.links, hoveredPath])

  useEffect(() => {
    writeStoredSettings(settings)
  }, [settings])

  const handleToggleSearchResultInChat = useCallback((path: string) => {
    if (!onChatSelectedPathsChange) return
    onChatSelectedPathsChange(
      selectedPaths.has(path)
        ? chatSelectedPaths.filter((selectedPath) => selectedPath !== path)
        : [...chatSelectedPaths, path],
    )
  }, [chatSelectedPaths, onChatSelectedPathsChange, selectedPaths])

  const handleFocusSearchResult = useCallback((path: string) => {
    const node = graphData.nodes.find((candidate) => candidate.path === path)
    setFocusedPath(path)
    if (
      !node ||
      typeof node.x !== 'number' ||
      typeof node.y !== 'number'
    ) return

    const targetZoom = Math.max(1.8, Math.min(3.6, 5 / Math.sqrt(node.degree + 1)))
    graphRef.current?.centerAt(node.x, node.y, 650)
    graphRef.current?.zoom(targetZoom, 650)
  }, [graphData.nodes])

  const handleFitGraph = useCallback(() => {
    setFocusedPath(null)
    graphRef.current?.zoomToFit(600, 72)
  }, [])

  const handleNodeClick = useCallback((node: ForceNode, event: MouseEvent) => {
    if (event.shiftKey && onChatSelectedPathsChange) {
      handleToggleSearchResultInChat(node.path)
      return
    }
    onOpenFile(node.path)
  }, [handleToggleSearchResultInChat, onChatSelectedPathsChange, onOpenFile])

  const handleNodeHover = useCallback((node: ForceNode | null) => {
    setHoveredPath(node?.path ?? null)
  }, [])

  const isHoveredConnection = useCallback((link: ForceLink) => {
    if (!hoveredPath) return false
    const sourcePath = getNodePath(link.source)
    const targetPath = getNodePath(link.target)
    return sourcePath === hoveredPath || targetPath === hoveredPath
  }, [hoveredPath])

  const getNodeDisplayColor = useCallback((node: ForceNode) => {
    const hasSearch = searchQuery.trim().length > 0
    const isHovered = node.path === hoveredPath
    const isNeighbor = hoveredNeighborPaths.has(node.path)

    if (isHovered) return '#ffffff'
    if (isNeighbor) return node.contextColor ?? (appTheme === 'dark' ? '#8be9fd' : '#4ca7ff')
    if (selectedPaths.has(node.path)) return '#ff79c6'
    if (hoveredPath) return appTheme === 'dark' ? '#243447' : '#b9c3d0'
    if (node.path === focusedPath) return appTheme === 'dark' ? '#f1fa8c' : '#7d5a00'
    if (matchedPaths.has(node.path)) return appTheme === 'dark' ? '#f1fa8c' : '#7d5a00'
    if (hasSearch) return appTheme === 'dark' ? '#4b5563' : '#a7b0bd'
    return getContextColor(node, appTheme)
  }, [appTheme, focusedPath, hoveredNeighborPaths, hoveredPath, matchedPaths, searchQuery, selectedPaths])

  const drawNode = useCallback((node: ForceNode, context: CanvasRenderingContext2D, globalScale: number) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return

    const isHovered = node.path === hoveredPath
    const isNeighbor = hoveredNeighborPaths.has(node.path)
    const isFocused = node.path === focusedPath
    const nodeColor = getNodeDisplayColor(node)
    const radius = Math.max(3.5, Math.min(10, 3.2 + Math.sqrt(Math.max(0, node.degree)) * 1.1))
    const labelColor = isHovered
      ? '#ffffff'
      : isNeighbor
        ? '#bffcff'
        : isFocused
          ? '#fff2b6'
          : (appTheme === 'dark' ? '#f8f8f2' : '#20232a')
    const x = node.x
    const y = node.y
    const strokeColor = appTheme === 'dark' ? 'rgba(5, 16, 29, 0.95)' : 'rgba(255, 255, 255, 0.92)'

    context.save()
    context.beginPath()
    context.arc(x, y, radius, 0, 2 * Math.PI, false)
    context.fillStyle = nodeColor
    context.fill()
    context.lineWidth = (isHovered ? 2 : isNeighbor ? 1.2 : 0.8) / globalScale
    context.strokeStyle = isHovered || isNeighbor ? '#8be9fd' : strokeColor
    context.stroke()

    if (isHovered || isNeighbor) {
      context.beginPath()
      context.arc(x, y, radius + (isHovered ? 3.5 : 2.2) / globalScale, 0, 2 * Math.PI, false)
      context.lineWidth = 1 / globalScale
      context.strokeStyle = isHovered ? 'rgba(139, 233, 253, 0.9)' : 'rgba(139, 233, 253, 0.55)'
      context.stroke()
    }

    const fontSize = 8 / globalScale
    const labelY = y - radius - 5 / globalScale
    context.font = `500 ${fontSize}px Inter, system-ui, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'bottom'
    context.lineWidth = 1.5 / globalScale
    context.strokeStyle = strokeColor
    context.strokeText(node.label, x, labelY)
    context.fillStyle = labelColor
    context.fillText(node.label, x, labelY)
    context.restore()
  }, [appTheme, focusedPath, getNodeDisplayColor, hoveredNeighborPaths, hoveredPath])

  const contextLegend = useMemo(
    () => buildGraphContextLegend(contexts, graphModel.nodes),
    [contexts, graphModel.nodes],
  )

  const hasContent = graphData.nodes.length > 0
  const graphBackground = settings.gridEnabled
    ? {
        backgroundImage: appTheme === 'dark'
          ? 'linear-gradient(rgba(139, 233, 253, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(139, 233, 253, 0.06) 1px, transparent 1px)'
          : 'linear-gradient(rgba(39, 98, 216, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(39, 98, 216, 0.08) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }
    : undefined

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
          <div className="notia-graph-search-results" role="list" aria-label="Archivos que coinciden con la búsqueda">
            {searchResults.length > 0 ? searchResults.map((searchResult) => (
              <div key={searchResult.path} className="notia-graph-search-result">
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
                  className={`notia-graph-search-result-action${selectedPaths.has(searchResult.path) ? ' is-selected' : ''}`}
                  onClick={() => handleToggleSearchResultInChat(searchResult.path)}
                  disabled={!onChatSelectedPathsChange}
                  aria-label={`${selectedPaths.has(searchResult.path) ? 'Quitar' : 'Agregar'} ${searchResult.label} ${selectedPaths.has(searchResult.path) ? 'del' : 'al'} contexto del chat`}
                  aria-pressed={selectedPaths.has(searchResult.path)}
                  title={selectedPaths.has(searchResult.path) ? 'Quitar del contexto del chat' : 'Agregar al contexto del chat'}
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
              <div className="notia-graph-search-empty" role="status">No se encontraron archivos.</div>
            )}
          </div>
        )}
        <label className="notia-graph-search-bar">
          <Search size={18} aria-hidden="true" />
          <input
            type="text"
            placeholder="Buscar por título o contenido..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Buscar archivos por título o contenido"
          />
          {searchQuery && (
            <button type="button" className="notia-graph-search-clear" onClick={() => setSearchQuery('')} aria-label="Limpiar búsqueda">
              <X size={18} />
            </button>
          )}
        </label>
      </div>

      <div aria-label="Referencias de colores por contexto" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 12px', fontSize: 12 }}>
        {contextLegend.map(([tag, color]) => (
          <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
            {tag}
          </span>
        ))}
        {graphModel.nodes.some((node) => !node.contextTag) ? <span>Sin contexto</span> : null}
      </div>

      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 9 }}>
        <NotiaButton variant="ghost" size="icon" onClick={() => setIsControlsOpen((previous) => !previous)} aria-label="Ajustes del grafo">
          <SlidersHorizontal size={16} />
        </NotiaButton>
      </div>

      {isControlsOpen && (
        <div style={{ position: 'absolute', top: 48, right: 12, zIndex: 10, background: 'var(--color-card-bg)', border: '1px solid var(--color-border-soft)', borderRadius: 8, padding: 12, minWidth: 200, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-app-text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.gridEnabled} onChange={(event) => setSettings((previous) => ({ ...previous, gridEnabled: event.target.checked }))} />
            Mostrar grid
          </label>
          <NotiaButton variant="ghost" size="sm" onClick={handleFitGraph} style={{ marginTop: 8, width: '100%' }}>
            <LocateFixed size={15} aria-hidden="true" />
            Centrar grafo
          </NotiaButton>
        </div>
      )}

      <div
        ref={graphHostRef}
        className="notia-graph-2d-canvas"
        style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', ...graphBackground }}
      >
        {(!hasContent || isLoading) && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-icon-muted)', fontSize: 13, pointerEvents: 'none', zIndex: 1 }}>
            {isLoading ? 'Cargando grafo...' : 'No hay nodos para mostrar.'}
          </div>
        )}
        {hasContent && graphSize.width > 0 && graphSize.height > 0 && (
          <ForceGraph2D
            ref={graphRef as never}
            width={graphSize.width}
            height={graphSize.height}
            graphData={graphData}
            nodeId="id"
            linkSource="source"
            linkTarget="target"
            backgroundColor="rgba(0,0,0,0)"
            nodeVal={(node) => Math.max(1, node.degree + 1)}
            nodeLabel={(node) => escapeTooltipHtml(node.label)}
            nodeCanvasObject={drawNode}
            nodeColor={getNodeDisplayColor}
            linkColor={(link) => {
              const sourcePath = getNodePath(link.source)
              const targetPath = getNodePath(link.target)
              if (isHoveredConnection(link)) return '#82dfe8'
              const isRelated = Boolean(sourcePath && targetPath && (matchedPaths.has(sourcePath) || matchedPaths.has(targetPath) || selectedPaths.has(sourcePath) || selectedPaths.has(targetPath)))
              if (hoveredPath) return appTheme === 'dark' ? '#17304c' : '#9aa9bb'
              return isRelated ? (appTheme === 'dark' ? '#6272a4' : '#7a8db5') : (appTheme === 'dark' ? '#2f7aa0' : '#4c82bb')
            }}
            linkWidth={(link) => {
              const sourcePath = getNodePath(link.source)
              const targetPath = getNodePath(link.target)
              if (isHoveredConnection(link)) return 2.2
              if (sourcePath && targetPath && (selectedPaths.has(sourcePath) || selectedPaths.has(targetPath))) return 1.8
              return hoveredPath ? 0.5 : 0.8
            }}
            linkDirectionalParticles={(link) => isHoveredConnection(link) ? 2 : 0}
            linkDirectionalParticleSpeed={(link) => isHoveredConnection(link) ? 0.008 : 0}
            linkDirectionalParticleWidth={(link) => isHoveredConnection(link) ? 1.4 : 0}
            linkDirectionalParticleColor={(link) => isHoveredConnection(link) ? '#d7fbff' : '#8be9fd'}
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            onBackgroundClick={() => {
              setFocusedPath(null)
              setHoveredPath(null)
            }}
            cooldownTicks={90}
            cooldownTime={4000}
            warmupTicks={50}
            d3AlphaDecay={0.08}
            d3VelocityDecay={0.45}
            enableNodeDrag={false}
          />
        )}
      </div>
    </div>
  )
}

export const GraphView = memo(GraphViewComponent, areGraphViewPropsEqual)
GraphView.displayName = 'GraphView'
