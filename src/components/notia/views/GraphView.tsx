import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { useAppSelector } from '../../../store/hooks'
import { selectTheme } from '../../../features/preferences/preferencesSelectors'
import type { GraphSearchResult } from '../../../hooks/useLibraryGraphData'
import type { LibraryGraphModel, LibraryGraphNode } from '../../../types/graph/libraryGraph'
import { notiaTimer } from '../../../services/runtime/notiaLogger'
import { useNarrowContainer } from '../../../hooks/useNarrowContainer'
import {
  DESKTOP_GRAPH_PAINT,
  PHONE_GRAPH_PAINT,
  drawFolderHalos,
  drawNode,
  readGraphPalette,
  withAlpha,
  type GraphPalette,
  type HaloGroup,
} from './graph/graphCanvas'
import { GraphTopBar, type GraphContextChip } from './graph/GraphTopBar'
import { GraphSearchPanel } from './graph/GraphSearchPanel'
import { GraphInspector, type GraphContextLook } from './graph/GraphInspector'
import { GraphDock } from './graph/GraphDock'
import { GraphMinimap, type MinimapNode, type MinimapViewport } from './graph/GraphMinimap'
import { hasCustomGraphView, useGraphPreferences } from './graph/useGraphPreferences'
import { GraphPhoneHeader, GraphPhoneSearchHeader } from './graph/phone/GraphPhoneHeader'
import { GraphPhoneSearchResults } from './graph/phone/GraphPhoneSearchResults'
import { GraphPhoneNoteSheet } from './graph/phone/GraphPhoneNoteSheet'
import { GraphPhoneViewSheet } from './graph/phone/GraphPhoneViewSheet'
import { GraphPhoneFitButton, GraphPhoneLocalChip } from './graph/phone/GraphPhoneOverlays'
import './graph/graphView.css'
import './graph/phone/graphPhone.css'

/*
 * Graph View: the notes of the library and their links, drawn with
 * react-force-graph-2d. The backend builds the model (links, degrees,
 * contexts, folders, neighbors and the summary) and searches it; this view
 * lays it out, draws it and lets the person explore it. In the space of a
 * phone it follows the phone boards of the canvas.
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
const PHONE_FIT_PADDING = 32
/** Framing never zooms in past this. */
const MAX_FIT_ZOOM = 2
/** Duration of the camera move to a note. */
const CENTER_MS = 600

/** Width of the view below which the phone boards of the canvas apply. */
const PHONE_MAX_WIDTH = 600
/** Heights of the note sheet on a phone, peeking and expanded. */
const PHONE_SHEET_PEEK = 212
const PHONE_SHEET_FULL = 560
/** The expanded sheet always leaves this much of the graph in sight. */
const PHONE_SHEET_GRAPH_ROOM = 120
/**
 * Where the folders sit: an ellipse `aspect` times taller than wide, `spread`
 * times the desktop circle. On a phone it is tall and tight, as the screen.
 */
interface FolderArrangement {
  aspect: number
  spread: number
}
const DESKTOP_FOLDERS: FolderArrangement = { aspect: 1, spread: 1 }
const PHONE_FOLDERS: FolderArrangement = { aspect: 3, spread: 0.6 }

/** What the phone shows over the graph: nothing, the search or the view sheet. */
type PhonePanel = 'graph' | 'search' | 'view'

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
 * so each group, and its halo, keeps an area of its own. On a phone the
 * circle is stretched into a tall ellipse, as the screen is.
 */
function folderCohesion(strength: number, { aspect, spread }: FolderArrangement = DESKTOP_FOLDERS) {
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
    const radius = folders.length > 1 ? (60 + 28 * Math.sqrt(next.length)) * spread : 0
    const stretch = Math.sqrt(aspect)
    anchors = new Map(folders.map((folder, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / folders.length
      return [folder, { x: (Math.cos(angle) * radius) / stretch, y: Math.sin(angle) * radius * stretch }]
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
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null)
  const [phonePanel, setPhonePanel] = useState<PhonePanel>('graph')
  const [isSheetExpanded, setIsSheetExpanded] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const graphHostRef = useRef<HTMLDivElement | null>(null)
  const graphRef = useRef<GraphRef | undefined>(undefined)
  const lastClickRef = useRef<{ path: string; at: number } | null>(null)
  const pendingCenterRef = useRef<number | null>(null)
  const frameRequestRef = useRef<number | null>(null)
  const framedModelRef = useRef<unknown>(null)
  const framedArrangementRef = useRef<FolderArrangement | null>(null)
  const pendingFitRef = useRef(false)

  const attachRoot = useCallback((element: HTMLDivElement | null) => {
    rootRef.current = element
    setRootElement(element)
  }, [])
  const isPhone = useNarrowContainer(rootElement, PHONE_MAX_WIDTH)
  const paint = isPhone ? PHONE_GRAPH_PAINT : DESKTOP_GRAPH_PAINT

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
    if (pendingCenterRef.current !== null) window.clearTimeout(pendingCenterRef.current)
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

  // On a phone the selected note is a bottom sheet over the graph.
  const phoneSheetFullHeight = Math.max(PHONE_SHEET_PEEK, Math.min(PHONE_SHEET_FULL, graphSize.height - PHONE_SHEET_GRAPH_ROOM))
  const showsPhoneSheet = isPhone && phonePanel === 'graph' && selected !== null
  const phoneSheetHeight = showsPhoneSheet ? (isSheetExpanded ? phoneSheetFullHeight : PHONE_SHEET_PEEK) : 0

  /** Centers a note in the part of the canvas a bottom sheet of `coveredBottom` pixels leaves free. */
  const centerNode = useCallback((path: string, coveredBottom: number) => {
    const graph = graphRef.current
    const node = nodeByPath.get(path)
    if (!graph || !node || typeof node.x !== 'number' || typeof node.y !== 'number') return
    const scale = graph.zoom() || 1
    graph.centerAt(node.x, node.y + coveredBottom / 2 / scale, CENTER_MS)
  }, [nodeByPath])

  const cancelPendingCenter = useCallback(() => {
    if (pendingCenterRef.current === null) return
    window.clearTimeout(pendingCenterRef.current)
    pendingCenterRef.current = null
  }, [])

  /** Selects a note and centers it, now or after `centerDelay` ms. */
  const focusNode = useCallback((path: string, centerDelay = 0) => {
    setSelectedPath(path)
    if (isPhone) {
      // As in the phone boards: picking a note goes back to the graph with its sheet peeking.
      setPhonePanel('graph')
      setQuery('')
      setIsSheetExpanded(false)
    }
    cancelPendingCenter()
    const coveredBottom = isPhone ? PHONE_SHEET_PEEK : 0
    if (centerDelay <= 0) {
      centerNode(path, coveredBottom)
      return
    }
    pendingCenterRef.current = window.setTimeout(() => {
      pendingCenterRef.current = null
      centerNode(path, coveredBottom)
    }, centerDelay)
  }, [cancelPendingCenter, centerNode, isPhone])

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
    const isPinned = typeof node.fx === 'number' || typeof node.fy === 'number'
    if (last && last.path === node.path && now - last.at < DOUBLE_CLICK_MS) {
      lastClickRef.current = null
      cancelPendingCenter()
      // A double click (or tap) frees a note fixed by dragging it.
      if (isPinned) {
        node.fx = undefined
        node.fy = undefined
        graphRef.current?.d3ReheatSimulation()
      }
      return
    }
    // A pinned note is centered once no second tap comes: moving the camera
    // first would take the note away from under the finger.
    focusNode(node.path, isPinned ? DOUBLE_CLICK_MS : 0)
  }, [cancelPendingCenter, focusNode, onChatSelectedPathsChange, toggleChatPath])

  const handleNodeDragEnd = useCallback((node: ForceNode) => {
    node.fx = node.x
    node.fy = node.y
  }, [])

  // Forces of the layout, from the person's preferences.
  const isGraphMounted = graphData.nodes.length > 0 && graphSize.width > 0 && graphSize.height > 0
  const folderArrangement = isPhone ? PHONE_FOLDERS : DESKTOP_FOLDERS
  useEffect(() => {
    const graph = graphRef.current
    if (!graph || !isGraphMounted) return
    const { repulsion, linkDistance, cohesion } = preferences.forces
    const charge = graph.d3Force('charge') as { strength?: (value: number) => unknown } | undefined
    charge?.strength?.(-repulsion)
    const link = graph.d3Force('link') as { distance?: (value: number) => unknown } | undefined
    link?.distance?.(linkDistance)
    graph.d3Force('folder', folderCohesion(cohesion / 100, folderArrangement) as never)
    // A new model, or the folders rearranged for another screen, is framed again once it settles.
    if (framedModelRef.current !== graphData || framedArrangementRef.current !== folderArrangement) {
      framedModelRef.current = graphData
      framedArrangementRef.current = folderArrangement
      pendingFitRef.current = true
    }
    graph.d3ReheatSimulation()
  }, [folderArrangement, graphData, isGraphMounted, preferences.forces])

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
    if (hasQuery) opacity = isMatch ? 1 : paint.unmatchedOpacity
    else if (selected && !localOn) opacity = isSelected || isNeighbor ? 1 : paint.dimmedOpacity
    else if (node.degree === 0) opacity = 0.65
    if (isHovered) opacity = 1
    drawNode(context, {
      x: node.x,
      y: node.y,
      radius: paint.nodeRadius(node.degree),
      color: node.contextColor ?? palette.muted,
      opacity,
      ring: isSelected ? 'selected' : isMatch ? 'match' : isHovered || chatPaths.has(node.path) ? 'hover' : null,
      label: showsLabel(node, isSelected, isNeighbor, isHovered, isMatch) ? node.label : null,
      labelStrong: isSelected,
      labelMaxWidth: isHovered || isSelected ? paint.labelMaxWidthStrong : paint.labelMaxWidth,
    }, palette, globalScale, paint)
  }, [chatPaths, hasQuery, hoveredPath, localOn, matches, paint, palette, selected, selectedNeighbors, selectedPath, showsLabel])

  // The touch area of a node; on a phone it never shrinks below a finger.
  const paintPointerArea = useCallback((node: ForceNode, color: string, context: CanvasRenderingContext2D, globalScale: number) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return
    context.fillStyle = color
    context.beginPath()
    context.arc(node.x, node.y, Math.max(paint.nodeRadius(node.degree) + paint.hitPadding, paint.minHitRadius / globalScale), 0, Math.PI * 2)
    context.fill()
  }, [paint])

  const isActiveLink = useCallback((link: ForceLink) => (
    selectedPath !== null && (pathOf(link.source) === selectedPath || pathOf(link.target) === selectedPath)
  ), [selectedPath])

  const dimLinks = hasQuery || (selected !== null && !localOn)
  const linkColor = useCallback((link: ForceLink) => (
    isActiveLink(link) ? withAlpha(palette.teal, paint.activeLinkAlpha) : withAlpha(palette.muted, dimLinks ? 0.18 : 0.45)
  ), [dimLinks, isActiveLink, paint.activeLinkAlpha, palette.muted, palette.teal])

  const paintHalos = useCallback((context: CanvasRenderingContext2D, globalScale: number) => {
    if (!preferences.showFolders) return
    const groups = new Map<string, HaloGroup>()
    for (const node of graphData.nodes) {
      if (!node.folder || !visiblePaths.has(node.path) || typeof node.x !== 'number' || typeof node.y !== 'number') continue
      const group = groups.get(node.folder) ?? { name: node.folder, points: [] }
      group.points.push([node.x, node.y])
      groups.set(node.folder, group)
    }
    drawFolderHalos(context, [...groups.values()], palette, globalScale, paint)
  }, [graphData.nodes, paint, palette, preferences.showFolders, visiblePaths])

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

  // Frames the visible notes in the part of the canvas the inspector, or the phone sheet, leaves free.
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
    const inspector = isPhone ? null : rootRef.current?.querySelector('.notia-gv-inspector')
    const isSideInspector = inspector !== null && inspector !== undefined
      && getComputedStyle(inspector).top !== 'auto' && host.clientWidth > 760
    const covered = isSideInspector ? inspector.getBoundingClientRect().width + 32 : 0
    const padding = isPhone ? PHONE_FIT_PADDING : FIT_PADDING
    const width = Math.max(1, host.clientWidth - covered - padding * 2)
    const height = Math.max(1, host.clientHeight - phoneSheetHeight - padding * 2)
    const scale = Math.min(MAX_FIT_ZOOM, Math.max(MIN_ZOOM, Math.min(width / Math.max(1, right - left), height / Math.max(1, bottom - top))))
    graph.zoom(scale, duration)
    graph.centerAt((left + right) / 2 + covered / 2 / scale, (top + bottom) / 2 + phoneSheetHeight / 2 / scale, duration)
  }, [graphData.nodes, isPhone, phoneSheetHeight, visiblePaths])

  // A new model is framed once its layout, with the forces applied, settles.
  const handleEngineStop = useCallback(() => {
    if (!pendingFitRef.current) return
    pendingFitRef.current = false
    fitGraph(500)
  }, [fitGraph])

  const clearSelection = useCallback(() => {
    cancelPendingCenter()
    setSelectedPath(null)
    setIsLocal(false)
  }, [cancelPendingCenter])

  // Over the phone's search or view sheet, a tap on the graph changes nothing.
  const handleBackgroundClick = useCallback(() => {
    if (isPhone && phonePanel !== 'graph') return
    clearSelection()
  }, [clearSelection, isPhone, phonePanel])

  const toggleContext = useCallback((key: string) => setHiddenContexts((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }), [])

  const setSheetExpanded = useCallback((expanded: boolean) => {
    setIsSheetExpanded(expanded)
    if (selectedPath) centerNode(selectedPath, expanded ? phoneSheetFullHeight : PHONE_SHEET_PEEK)
  }, [centerNode, phoneSheetFullHeight, selectedPath])

  const closePhoneSearch = useCallback(() => {
    setPhonePanel('graph')
    setQuery('')
  }, [])

  const hasContent = graphData.nodes.length > 0
  const chat = selected && onChatSelectedPathsChange
    ? { isIncluded: chatPaths.has(selected.path), onToggle: () => toggleChatPath(selected.path) }
    : null

  return (
    <div ref={attachRoot} className={`notia-gv${isPhone ? ' notia-gv--phone' : ''}`}>
      {!isPhone ? (
        <GraphTopBar
          visibleNotes={visiblePaths.size}
          visibleLinks={visibleLinkCount}
          isLocal={localOn}
          canShowLocal={selected !== null}
          onShowGlobal={() => setIsLocal(false)}
          onShowLocal={() => setIsLocal(true)}
          chips={chips}
          onToggleChip={toggleContext}
        />
      ) : phonePanel === 'search' ? (
        <GraphPhoneSearchHeader query={query} onQueryChange={setQuery} onClose={closePhoneSearch} />
      ) : (
        <GraphPhoneHeader
          visibleNotes={visiblePaths.size}
          visibleLinks={visibleLinkCount}
          isViewCustomized={hiddenContexts.size > 0 || hasCustomGraphView(preferences)}
          onOpenSearch={() => setPhonePanel('search')}
          onOpenView={() => setPhonePanel('view')}
        />
      )}
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
              linkWidth={(link) => (isActiveLink(link as ForceLink) ? paint.activeLinkWidth : paint.linkWidth)}
              linkCurvature={0.16}
              onRenderFramePre={paintHalos}
              onNodeClick={handleNodeClick}
              // A finger leaves no hover behind: on a phone a tap only selects.
              onNodeHover={isPhone ? undefined : (node) => setHoveredPath((node as ForceNode | null)?.path ?? null)}
              onNodeDragEnd={handleNodeDragEnd}
              onBackgroundClick={handleBackgroundClick}
              onZoom={({ k }) => {
                setZoom(k)
                if (!isPhone) requestFrame()
              }}
              // Only the minimap, which a phone does not show, follows each tick.
              onEngineTick={isPhone ? undefined : requestFrame}
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

        {isPhone ? (
          <>
            {phonePanel === 'graph' && localOn ? <GraphPhoneLocalChip onExit={() => setIsLocal(false)} /> : null}
            {phonePanel === 'graph' ? (
              <GraphPhoneFitButton bottom={phoneSheetHeight > 0 ? phoneSheetHeight + 16 : 24} onFit={() => fitGraph()} />
            ) : null}
            {phonePanel === 'search' ? (
              <GraphPhoneSearchResults
                query={query}
                results={hasQuery ? searchResults : null}
                topConnected={graphModel.summary.topConnected.flatMap((path) => nodeByPath.get(path) ?? [])}
                nodeByPath={nodeByPath}
                libraryName={libraryName}
                colorOf={(path) => nodeByPath.get(path)?.contextColor ?? palette.muted}
                onPick={focusNode}
              />
            ) : null}
            {selected && showsPhoneSheet ? (
              <GraphPhoneNoteSheet
                libraryName={libraryName}
                selected={selected}
                look={lookOf(selected)}
                connections={selected.neighbors.flatMap((path) => nodeByPath.get(path) ?? [])}
                lookOf={lookOf}
                height={phoneSheetHeight}
                isExpanded={isSheetExpanded}
                onExpandedChange={setSheetExpanded}
                isLocal={localOn}
                onToggleLocal={() => setIsLocal((current) => !current)}
                onClose={clearSelection}
                onOpen={onOpenFile}
                onPick={focusNode}
                chat={chat}
              />
            ) : null}
          </>
        ) : (
          <>
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
              chat={chat}
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
          </>
        )}
      </div>

      {isPhone && phonePanel === 'view' ? (
        <GraphPhoneViewSheet
          chips={chips}
          onToggleChip={toggleContext}
          preferences={preferences}
          onChange={updatePreferences}
          orphanCount={graphModel.summary.orphans}
          onClose={() => setPhonePanel('graph')}
        />
      ) : null}
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
