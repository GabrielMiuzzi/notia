import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { useAppSelector } from '../../../store/hooks'
import { selectTheme } from '../../../features/preferences/preferencesSelectors'
import type { GraphSearchResult } from '../../../hooks/useLibraryGraphData'
import type { LibraryGraphModel, LibraryGraphNode } from '../../../types/graph/libraryGraph'
import { notiaTimer } from '../../../services/runtime/notiaLogger'
import { drawFolderHalos, drawNode, nodeRadius, readGraphPalette, withAlpha, type GraphPalette, type HaloGroup } from './graph/graphCanvas'
import { GraphTopBar, type GraphContextChip } from './graph/GraphTopBar'
import { GraphSearchPanel } from './graph/GraphSearchPanel'
import { GraphInspector, type GraphContextLook } from './graph/GraphInspector'
import { GraphDock } from './graph/GraphDock'
import { GraphMinimap, type MinimapNode, type MinimapViewport } from './graph/GraphMinimap'
import { useGraphPreferences } from './graph/useGraphPreferences'
import './graph/graphView.css'

/*
 * Graph View: the notes of the library and their links, drawn with
 * react-force-graph-2d. The backend builds the model (links, degrees,
 * contexts, folders, neighbors and the summary) and searches it; this view
 * lays it out, draws it and lets the person explore it.
 */

interface ForceNode extends LibraryGraphNode {
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
}

interface ForceLink {
  id: string
  source: string | ForceNode
  target: string | ForceNode
}

type GraphRef = ComponentRef<typeof ForceGraph2D>

const NO_CONTEXT_KEY = ''
const DOUBLE_CLICK_MS = 320
const SEARCH_DELAY_MS = 150
const ZOOM_STEP = 0.25
const MIN_ZOOM = 0.3
const MAX_ZOOM = 4
/** From this zoom on, Auto names every linked note. */
const ALL_LINKED_NAMES_ZOOM = 1.4
const HUB_DEGREE = 4
/** Room around the notes when the graph is framed, in screen pixels. */
const FIT_PADDING = 64
/** Framing never zooms in past this. */
const MAX_FIT_ZOOM = 2

function pathOf(value: string | ForceNode): string {
  return typeof value === 'string' ? value : value.path
}

function contextKey(node: LibraryGraphNode): string {
  return node.contextTag ?? NO_CONTEXT_KEY
}

function contextName(tag: string | null | undefined): string {
  return tag ? tag.replace(/^#/, '') : 'Sin contexto'
}

/**
 * Pulls the notes of each folder toward their folder's own place: the
 * folders sit around a circle (notes at the library root, in the middle),
 * so each group, and its halo, keeps an area of its own.
 */
function folderCohesion(strength: number) {
  let nodes: ForceNode[] = []
  let anchors = new Map<string, { x: number; y: number }>()
  const force = (alpha: number) => {
    for (const node of nodes) {
      const anchor = anchors.get(node.folder)
      if (!anchor || typeof node.x !== 'number' || typeof node.y !== 'number') continue
      node.vx = (node.vx ?? 0) + (anchor.x - node.x) * strength * alpha
      node.vy = (node.vy ?? 0) + (anchor.y - node.y) * strength * alpha
    }
  }
  force.initialize = (next: ForceNode[]) => {
    nodes = next
    const sizes = new Map<string, number>()
    for (const node of next) {
      if (node.folder) sizes.set(node.folder, (sizes.get(node.folder) ?? 0) + 1)
    }
    const folders = [...sizes.keys()].sort((left, right) => (sizes.get(right) ?? 0) - (sizes.get(left) ?? 0))
    const radius = folders.length > 1 ? 60 + 28 * Math.sqrt(next.length) : 0
    anchors = new Map(folders.map((folder, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / folders.length
      return [folder, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }]
    }))
    anchors.set('', { x: 0, y: 0 })
  }
  return force
}

interface GraphViewProps {
  graphModel: LibraryGraphModel
  /** Title and content search resolved by the backend. */
  searchGraph: (query: string) => Promise<GraphSearchResult[]>
  libraryName: string
  isLoading: boolean
  onOpenFile: (filePath: string) => void
  chatSelectedPaths?: string[]
  onChatSelectedPathsChange?: (paths: string[]) => void
}

function GraphViewComponent({
  graphModel,
  searchGraph,
  libraryName,
  isLoading,
  onOpenFile,
  chatSelectedPaths = [],
  onChatSelectedPathsChange,
}: GraphViewProps) {
  const mountTimerRef = useRef(notiaTimer('graph', 'GraphView mount', {
    nodeCount: graphModel.nodes.length,
    edgeCount: graphModel.edges.length,
  }))
  useEffect(() => {
    const mountTimer = mountTimerRef.current
    return () => mountTimer.success()
  }, [])

  const appTheme = useAppSelector(selectTheme)
  const { preferences, update: updatePreferences } = useGraphPreferences()
  const [palette, setPalette] = useState<GraphPalette>(() => readGraphPalette(null))
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const [isLocal, setIsLocal] = useState(false)
  const [hiddenContexts, setHiddenContexts] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GraphSearchResult[] | null>(null)
  const [zoom, setZoom] = useState(1)
  const [frameVersion, setFrameVersion] = useState(0)
  const [viewport, setViewport] = useState<MinimapViewport | null>(null)
  const [graphSize, setGraphSize] = useState({ width: 0, height: 0 })

  const rootRef = useRef<HTMLDivElement | null>(null)
  const graphHostRef = useRef<HTMLDivElement | null>(null)
  const graphRef = useRef<GraphRef | undefined>(undefined)
  const lastClickRef = useRef<{ path: string; at: number } | null>(null)
  const frameRequestRef = useRef<number | null>(null)
  const framedModelRef = useRef<unknown>(null)
  const pendingFitRef = useRef(false)

  useEffect(() => {
    setPalette(readGraphPalette(rootRef.current))
  }, [appTheme])

  useEffect(() => {
    const host = graphHostRef.current
    if (!host) return undefined
    const updateSize = () => setGraphSize({
      width: Math.max(1, Math.floor(host.clientWidth)),
      height: Math.max(1, Math.floor(host.clientHeight)),
    })
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    if (frameRequestRef.current !== null) cancelAnimationFrame(frameRequestRef.current)
  }, [])

  // The minimap follows the layout and the camera, at most once per frame.
  const requestFrame = useCallback(() => {
    if (frameRequestRef.current !== null) return
    frameRequestRef.current = requestAnimationFrame(() => {
      frameRequestRef.current = null
      const graph = graphRef.current
      const host = graphHostRef.current
      if (graph && host) {
        const topLeft = graph.screen2GraphCoords(0, 0)
        const bottomRight = graph.screen2GraphCoords(host.clientWidth, host.clientHeight)
        setViewport({ left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y })
      }
      setFrameVersion((version) => version + 1)
    })
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null)
      return undefined
    }
    let isCurrent = true
    setSearchResults(null)
    const timer = window.setTimeout(() => {
      searchGraph(query)
        .then((results) => { if (isCurrent) setSearchResults(results) })
        .catch(() => { if (isCurrent) setSearchResults([]) })
    }, SEARCH_DELAY_MS)
    return () => {
      isCurrent = false
      window.clearTimeout(timer)
    }
  }, [searchGraph, query])

  const graphData = useMemo(() => ({
    nodes: graphModel.nodes.map((node): ForceNode => ({ ...node })),
    links: graphModel.edges.map((edge): ForceLink => ({ id: edge.id, source: edge.sourcePath, target: edge.targetPath })),
  }), [graphModel.edges, graphModel.nodes])

  const nodeByPath = useMemo(
    () => new Map(graphData.nodes.map((node) => [node.path, node])),
    [graphData.nodes],
  )
  const selected = selectedPath ? nodeByPath.get(selectedPath) ?? null : null
  const localOn = isLocal && selected !== null
  const hasQuery = query.trim().length > 0
  const matches = useMemo(() => new Set((searchResults ?? []).map((result) => result.path)), [searchResults])
  const selectedNeighbors = useMemo(() => new Set(selected?.neighbors ?? []), [selected])
  const chatPaths = useMemo(() => new Set(chatSelectedPaths), [chatSelectedPaths])

  const visiblePaths = useMemo(() => {
    const visible = new Set<string>()
    for (const node of graphData.nodes) {
      const isSelected = node.path === selectedPath
      if (hiddenContexts.has(contextKey(node))) continue
      if (!preferences.showOrphans && node.degree === 0 && !isSelected) continue
      if (localOn && !isSelected && !selectedNeighbors.has(node.path)) continue
      visible.add(node.path)
    }
    return visible
  }, [graphData.nodes, hiddenContexts, localOn, preferences.showOrphans, selectedNeighbors, selectedPath])

  const visibleLinkCount = useMemo(
    () => graphModel.edges.filter((edge) => visiblePaths.has(edge.sourcePath) && visiblePaths.has(edge.targetPath)).length,
    [graphModel.edges, visiblePaths],
  )

  const lookOf = useCallback((node: LibraryGraphNode): GraphContextLook => ({
    name: contextName(node.contextTag),
    color: node.contextColor ?? palette.muted,
  }), [palette.muted])

  const contextLooks = useMemo(() => graphModel.summary.contexts.map((context) => ({
    name: contextName(context.tag),
    color: context.color ?? palette.muted,
    count: context.count,
  })), [graphModel.summary.contexts, palette.muted])

  const chips = useMemo((): GraphContextChip[] => graphModel.summary.contexts.map((context) => ({
    key: context.tag ?? NO_CONTEXT_KEY,
    name: contextName(context.tag),
    color: context.color ?? palette.muted,
    count: context.count,
    hidden: hiddenContexts.has(context.tag ?? NO_CONTEXT_KEY),
  })), [graphModel.summary.contexts, hiddenContexts, palette.muted])

  const focusNode = useCallback((path: string) => {
    setSelectedPath(path)
    const node = nodeByPath.get(path)
    if (node && typeof node.x === 'number' && typeof node.y === 'number') {
      graphRef.current?.centerAt(node.x, node.y, 600)
    }
  }, [nodeByPath])

  const toggleChatPath = useCallback((path: string) => {
    if (!onChatSelectedPathsChange) return
    onChatSelectedPathsChange(chatPaths.has(path)
      ? chatSelectedPaths.filter((selectedChatPath) => selectedChatPath !== path)
      : [...chatSelectedPaths, path])
  }, [chatPaths, chatSelectedPaths, onChatSelectedPathsChange])

  const handleNodeClick = useCallback((node: ForceNode, event: MouseEvent) => {
    if (event.shiftKey && onChatSelectedPathsChange) {
      toggleChatPath(node.path)
      return
    }
    const now = Date.now()
    const last = lastClickRef.current
    lastClickRef.current = { path: node.path, at: now }
    if (last && last.path === node.path && now - last.at < DOUBLE_CLICK_MS) {
      lastClickRef.current = null
      // A double click frees a note fixed by dragging it.
      if (typeof node.fx === 'number' || typeof node.fy === 'number') {
        node.fx = undefined
        node.fy = undefined
        graphRef.current?.d3ReheatSimulation()
      }
      return
    }
    focusNode(node.path)
  }, [focusNode, onChatSelectedPathsChange, toggleChatPath])

  const handleNodeDragEnd = useCallback((node: ForceNode) => {
    node.fx = node.x
    node.fy = node.y
  }, [])

  // Forces of the layout, from the person's preferences.
  const isGraphMounted = graphData.nodes.length > 0 && graphSize.width > 0 && graphSize.height > 0
  useEffect(() => {
    const graph = graphRef.current
    if (!graph || !isGraphMounted) return
    const { repulsion, linkDistance, cohesion } = preferences.forces
    const charge = graph.d3Force('charge') as { strength?: (value: number) => unknown } | undefined
    charge?.strength?.(-repulsion)
    const link = graph.d3Force('link') as { distance?: (value: number) => unknown } | undefined
    link?.distance?.(linkDistance)
    graph.d3Force('folder', folderCohesion(cohesion / 100) as never)
    if (framedModelRef.current !== graphData) {
      framedModelRef.current = graphData
      pendingFitRef.current = true
    }
    graph.d3ReheatSimulation()
  }, [graphData, isGraphMounted, preferences.forces])

  const showsLabel = useCallback((node: ForceNode, isSelected: boolean, isNeighbor: boolean, isHovered: boolean, isMatch: boolean) => (
    preferences.labels === 'all'
    || isSelected
    || isHovered
    || isMatch
    || (!hasQuery && (isNeighbor || node.degree >= HUB_DEGREE || (zoom >= ALL_LINKED_NAMES_ZOOM && node.degree > 0)))
  ), [hasQuery, preferences.labels, zoom])

  const paintNode = useCallback((node: ForceNode, context: CanvasRenderingContext2D, globalScale: number) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return
    const isSelected = node.path === selectedPath
    const isNeighbor = selectedNeighbors.has(node.path)
    const isHovered = node.path === hoveredPath
    const isMatch = matches.has(node.path)
    let opacity = 1
    if (hasQuery) opacity = isMatch ? 1 : 0.16
    else if (selected && !localOn) opacity = isSelected || isNeighbor ? 1 : 0.3
    else if (node.degree === 0) opacity = 0.65
    if (isHovered) opacity = 1
    drawNode(context, {
      x: node.x,
      y: node.y,
      radius: nodeRadius(node.degree),
      color: node.contextColor ?? palette.muted,
      opacity,
      ring: isSelected ? 'selected' : isMatch ? 'match' : isHovered || chatPaths.has(node.path) ? 'hover' : null,
      label: showsLabel(node, isSelected, isNeighbor, isHovered, isMatch) ? node.label : null,
      labelStrong: isSelected,
      labelMaxWidth: isHovered || isSelected ? 360 : 210,
    }, palette, globalScale)
  }, [chatPaths, hasQuery, hoveredPath, localOn, matches, palette, selected, selectedNeighbors, selectedPath, showsLabel])

  const paintPointerArea = useCallback((node: ForceNode, color: string, context: CanvasRenderingContext2D) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return
    context.fillStyle = color
    context.beginPath()
    context.arc(node.x, node.y, nodeRadius(node.degree) + 5, 0, Math.PI * 2)
    context.fill()
  }, [])

  const isActiveLink = useCallback((link: ForceLink) => (
    selectedPath !== null && (pathOf(link.source) === selectedPath || pathOf(link.target) === selectedPath)
  ), [selectedPath])

  const dimLinks = hasQuery || (selected !== null && !localOn)
  const linkColor = useCallback((link: ForceLink) => (
    isActiveLink(link) ? withAlpha(palette.teal, 0.85) : withAlpha(palette.muted, dimLinks ? 0.18 : 0.45)
  ), [dimLinks, isActiveLink, palette.muted, palette.teal])

  const paintHalos = useCallback((context: CanvasRenderingContext2D, globalScale: number) => {
    if (!preferences.showFolders) return
    const groups = new Map<string, HaloGroup>()
    for (const node of graphData.nodes) {
      if (!node.folder || !visiblePaths.has(node.path) || typeof node.x !== 'number' || typeof node.y !== 'number') continue
      const group = groups.get(node.folder) ?? { name: node.folder, points: [] }
      group.points.push([node.x, node.y])
      groups.set(node.folder, group)
    }
    drawFolderHalos(context, [...groups.values()], palette, globalScale)
  }, [graphData.nodes, palette, preferences.showFolders, visiblePaths])

  const minimapNodes = useMemo((): MinimapNode[] => {
    void frameVersion
    return graphData.nodes.flatMap((node) => (
      visiblePaths.has(node.path) && typeof node.x === 'number' && typeof node.y === 'number'
        ? [{ x: node.x, y: node.y, color: node.contextColor ?? palette.muted, isSelected: node.path === selectedPath }]
        : []
    ))
  }, [frameVersion, graphData.nodes, palette.muted, selectedPath, visiblePaths])

  const zoomTo = useCallback((next: number) => {
    graphRef.current?.zoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)), 300)
  }, [])

  // Frames the visible notes in the part of the canvas the inspector leaves free.
  const fitGraph = useCallback((duration = 600) => {
    const graph = graphRef.current
    const host = graphHostRef.current
    if (!graph || !host) return
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const node of graphData.nodes) {
      if (!visiblePaths.has(node.path) || typeof node.x !== 'number' || typeof node.y !== 'number') continue
      left = Math.min(left, node.x)
      top = Math.min(top, node.y)
      right = Math.max(right, node.x)
      bottom = Math.max(bottom, node.y)
    }
    if (!Number.isFinite(left)) return
    const inspector = rootRef.current?.querySelector('.notia-gv-inspector')
    const isSideInspector = inspector !== null && inspector !== undefined
      && getComputedStyle(inspector).top !== 'auto' && host.clientWidth > 760
    const covered = isSideInspector ? inspector.getBoundingClientRect().width + 32 : 0
    const width = Math.max(1, host.clientWidth - covered - FIT_PADDING * 2)
    const height = Math.max(1, host.clientHeight - FIT_PADDING * 2)
    const scale = Math.min(MAX_FIT_ZOOM, Math.max(MIN_ZOOM, Math.min(width / Math.max(1, right - left), height / Math.max(1, bottom - top))))
    graph.zoom(scale, duration)
    graph.centerAt((left + right) / 2 + covered / 2 / scale, (top + bottom) / 2, duration)
  }, [graphData.nodes, visiblePaths])

  // A new model is framed once its layout, with the forces applied, settles.
  const handleEngineStop = useCallback(() => {
    if (!pendingFitRef.current) return
    pendingFitRef.current = false
    fitGraph(500)
  }, [fitGraph])

  const clearSelection = useCallback(() => {
    setSelectedPath(null)
    setIsLocal(false)
  }, [])

  const hasContent = graphData.nodes.length > 0

  return (
    <div ref={rootRef} className="notia-gv">
      <GraphTopBar
        visibleNotes={visiblePaths.size}
        visibleLinks={visibleLinkCount}
        isLocal={localOn}
        canShowLocal={selected !== null}
        onShowGlobal={() => setIsLocal(false)}
        onShowLocal={() => setIsLocal(true)}
        chips={chips}
        onToggleChip={(key) => setHiddenContexts((current) => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })}
      />
      <div className="notia-gv-stage">
        <div ref={graphHostRef} className="notia-gv-canvas">
          {(!hasContent || isLoading) ? (
            <p className="notia-gv-placeholder">{isLoading ? 'Cargando grafo…' : 'No hay notas para mostrar.'}</p>
          ) : null}
          {isGraphMounted ? (
            <ForceGraph2D
              ref={graphRef as never}
              width={graphSize.width}
              height={graphSize.height}
              graphData={graphData}
              nodeId="path"
              linkSource="source"
              linkTarget="target"
              backgroundColor="rgba(0,0,0,0)"
              nodeLabel={() => ''}
              nodeVisibility={(node) => visiblePaths.has((node as ForceNode).path)}
              linkVisibility={(link) => visiblePaths.has(pathOf((link as ForceLink).source)) && visiblePaths.has(pathOf((link as ForceLink).target))}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={paintPointerArea}
              linkColor={linkColor}
              linkWidth={(link) => (isActiveLink(link as ForceLink) ? 1.6 : 1.1)}
              linkCurvature={0.16}
              onRenderFramePre={paintHalos}
              onNodeClick={handleNodeClick}
              onNodeHover={(node) => setHoveredPath((node as ForceNode | null)?.path ?? null)}
              onNodeDragEnd={handleNodeDragEnd}
              onBackgroundClick={clearSelection}
              onZoom={({ k }) => {
                setZoom(k)
                requestFrame()
              }}
              onEngineTick={requestFrame}
              onEngineStop={handleEngineStop}
              cooldownTicks={120}
              cooldownTime={5000}
              warmupTicks={40}
              d3AlphaDecay={0.06}
              d3VelocityDecay={0.4}
              enableNodeDrag
            />
          ) : null}
        </div>

        <GraphSearchPanel
          query={query}
          onQueryChange={setQuery}
          results={hasQuery ? searchResults : null}
          colorOf={(path) => nodeByPath.get(path)?.contextColor ?? palette.muted}
          selectedPath={selectedPath}
          onPick={focusNode}
        />

        <GraphInspector
          libraryName={libraryName}
          selected={selected}
          nodeByPath={nodeByPath}
          summary={graphModel.summary}
          lookOf={lookOf}
          contextLooks={contextLooks}
          isLocal={localOn}
          onToggleLocal={() => setIsLocal((current) => !current)}
          onClose={clearSelection}
          onOpen={onOpenFile}
          onPick={focusNode}
          chat={selected && onChatSelectedPathsChange
            ? { isIncluded: chatPaths.has(selected.path), onToggle: () => toggleChatPath(selected.path) }
            : null}
        />

        <GraphDock
          zoomPercent={Math.round(zoom * 100)}
          onZoomIn={() => zoomTo(Math.round((zoom + ZOOM_STEP) * 100) / 100)}
          onZoomOut={() => zoomTo(Math.round((zoom - ZOOM_STEP) * 100) / 100)}
          onZoomReset={() => zoomTo(1)}
          onFit={() => fitGraph()}
          preferences={preferences}
          onChange={updatePreferences}
        />

        <GraphMinimap nodes={minimapNodes} viewport={viewport} version={frameVersion} />
      </div>
    </div>
  )
}

function areGraphViewPropsEqual(previous: GraphViewProps, next: GraphViewProps): boolean {
  return previous.graphModel === next.graphModel
    && previous.searchGraph === next.searchGraph
    && previous.libraryName === next.libraryName
    && previous.isLoading === next.isLoading
    && previous.onOpenFile === next.onOpenFile
    && previous.chatSelectedPaths === next.chatSelectedPaths
    && previous.onChatSelectedPathsChange === next.onChatSelectedPathsChange
}

export const GraphView = memo(GraphViewComponent, areGraphViewPropsEqual)
GraphView.displayName = 'GraphView'
