import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from 'react'
import { Eye, Search, SlidersHorizontal, X } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import {
  buildClusteredGraphLayout,
  type PositionedGraphEdge,
  type PositionedGraphNode,
} from '../../../engines/graph/clusteredGraphLayoutEngine'
import type { LibraryGraphModel } from '../../../types/graph/libraryGraph'

const MIN_ZOOM_EPSILON = 1e-9
const MAX_ZOOM = 2.5
const LABEL_VISIBILITY_ZOOM = 1.35
const SLIDER_MIN_NODE_SIZE_MULTIPLIER = 0.4
const SLIDER_MAX_NODE_SIZE_MULTIPLIER = 3.6
const INPUT_MIN_NODE_SIZE_MULTIPLIER = 0.1
const INPUT_MAX_NODE_SIZE_MULTIPLIER = 12
const DEFAULT_SPACING_MULTIPLIER = 68
const DEFAULT_LINKED_SPACING_MULTIPLIER = 10
const DEFAULT_COMPONENT_SPACING_MULTIPLIER = -16
const DEFAULT_COMPONENT_SPACING_SCALE_MULTIPLIER = 100
const DEFAULT_FREE_NODE_SPACING = 8
const DEFAULT_FREE_NODE_SPACING_MULTIPLIER = 1
const DEFAULT_NODE_SIZE_MULTIPLIER = 1
const GRAPH_VIEW_SETTINGS_STORAGE_KEY = 'notia.graphView.settings.v1'
const GRAPH_VIEW_NODE_POSITIONS_STORAGE_KEY = 'notia.graphView.positions.v1'
const GRAPH_PHYSICS_COLLISION_PADDING = 5
const GRAPH_PHYSICS_DAMPING = 0.86
const GRAPH_PHYSICS_MAX_DELTA = 1.6
const GRAPH_PHYSICS_MIN_DELTA = 0.45
const GRAPH_PHYSICS_CONSTRAINT_ITERATIONS = 3
const GRAPH_PHYSICS_EDGE_CONSTRAINT_SLOP = 0.025
const GRAPH_PHYSICS_EDGE_COMPRESSION_STRENGTH = 0.18
const GRAPH_PHYSICS_EDGE_STRETCH_STRENGTH = 0.06
const GRAPH_PHYSICS_COLLISION_SLOP = 0.025
const GRAPH_PHYSICS_FREE_NODE_ANCHOR_PULL = 0.012
const GRAPH_PHYSICS_ANCHORED_NODE_PULL = 0.004
const GRAPH_PHYSICS_DRAG_NEIGHBOR_PULL = 0.016
const GRAPH_PHYSICS_SECOND_RING_PULL = 0.008
const GRAPH_PHYSICS_DRAG_LEAF_RING_PULL = 0.017
const GRAPH_PHYSICS_DRAG_LEAF_RING_SETTLE = 0.1
const GRAPH_PHYSICS_DRAG_LEAF_RING_PADDING = 18
const GRAPH_PHYSICS_DRAG_LEAF_RING_MIN_RADIUS = 44
const GRAPH_PHYSICS_VELOCITY_SLEEP_EPSILON = 0.004
const GRAPH_PHYSICS_MOVEMENT_SLEEP_EPSILON = 0.006
const GRAPH_PHYSICS_MAX_NODE_SPEED = 14
const GRAPH_PHYSICS_CONSTRAINT_VELOCITY_TRANSFER = 0.38
const GRAPH_PHYSICS_DRAG_OUTER_RING_DAMPING = 0.72
const GRAPH_PHYSICS_DRAG_NEIGHBOR_DAMPING = 0.82
const GRAPH_PHYSICS_SETTLE_POSITION_EPSILON = 0.18
const GRAPH_PHYSICS_SETTLE_VELOCITY_EPSILON = 0.035
const GRAPH_PHYSICS_SETTLE_REST_LENGTH_EPSILON = 0.22
const GRAPH_VIEW_FOCUS_ANIMATION_DURATION_MS = 320
const GRAPH_MODEL_SIGNATURE_CACHE_LIMIT = 24
const graphModelBySignatureCache = new Map<string, LibraryGraphModel>()

interface GraphViewSettings {
  nodeSizeMultiplier: number
}

interface PersistedGraphNodePosition {
  x: number
  y: number
}
interface GraphEdgeLike {
  sourcePath: string
  targetPath: string
}

interface GraphNodeLike {
  x: number
  y: number
  radius: number
}

interface GraphSimulationEdge {
  sourceIndex: number
  targetIndex: number
  restLength: number
}

interface GraphSimulationTopology {
  edges: GraphSimulationEdge[]
  pathToIndex: Map<string, number>
  linkedIndexesByIndex: number[][]
  restLengthByPairKey: Map<string, number>
}

interface GraphDragNeighborhood {
  draggedIndex: number
  directLinkedIndexes: Set<number>
  directLeafIndexes: Set<number>
  secondRingIndexes: Set<number>
}

interface GraphRenderNode extends PositionedGraphNode {
  x: number
  y: number
  radius: number
}

class GraphSimulationNode implements PositionedGraphNode {
  id: string
  path: string
  label: string
  degree: number
  clusterIndex: number
  color: string
  x: number
  y: number
  radius: number
  baseX: number
  baseY: number
  vx: number
  vy: number
  linkedNodes: GraphSimulationNode[]
  dragTargetX: number | null
  dragTargetY: number | null
  constructor(node: PositionedGraphNode, persistedPosition?: PersistedGraphNodePosition) {
    this.id = node.id
    this.path = node.path
    this.label = node.label
    this.degree = node.degree
    this.clusterIndex = node.clusterIndex
    this.color = node.color
    this.radius = node.radius
    const initialX = persistedPosition?.x ?? node.x
    const initialY = persistedPosition?.y ?? node.y
    this.x = initialX
    this.y = initialY
    this.baseX = initialX
    this.baseY = initialY
    this.vx = 0
    this.vy = 0
    this.linkedNodes = []
    this.dragTargetX = null
    this.dragTargetY = null
  }

  toRenderNode(): GraphRenderNode {
    return {
      id: this.id,
      path: this.path,
      label: this.label,
      degree: this.degree,
      clusterIndex: this.clusterIndex,
      color: this.color,
      x: this.x,
      y: this.y,
      radius: this.radius,
    }
  }
}

interface NodeDragSession {
  path: string
  targetX: number
  targetY: number
  velocityX: number
  velocityY: number
  pointerOffsetX: number
  pointerOffsetY: number
}

interface GraphViewProps {
  graphModel: LibraryGraphModel
  graphSourcesByPath: Record<string, string>
  libraryName: string
  isLoading: boolean
  onOpenFile: (filePath: string) => void
}

interface GraphSearchResult {
  path: string
  label: string
  preview: string
  score: number
}

interface GraphSearchScrollSession {
  startClientY: number
  startScrollTop: number
  moved: boolean
}

function resolveNodeGlowClass(degree: number): string {
  if (degree === 0) {
    return 'notia-graph-node--isolated'
  }
  if (degree >= 3) {
    return 'notia-graph-node--hub'
  }
  return 'notia-graph-node--connected'
}

function clampSignedMagnitude(value: number, limit: number): number {
  if (value > limit) {
    return limit
  }
  if (value < -limit) {
    return -limit
  }
  return value
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ')
}

function extractSearchableContent(path: string, source: string): string {
  if (path.toLowerCase().endsWith('.inkdoc')) {
    try {
      const parsed = JSON.parse(source) as {
        pages?: Array<{
          textBlocks?: Array<{
            text?: string
            html?: string
          }>
        }>
      }
      const blocks =
        parsed.pages?.flatMap((page) =>
          (page.textBlocks ?? []).map((block) => stripHtmlTags(block.html ?? block.text ?? '')),
        ) ?? []
      const extractedText = blocks.join(' ').replace(/\s+/g, ' ').trim()
      return extractedText || source
    } catch {
      return source
    }
  }

  return source
}

function buildSearchPreview(source: string, normalizedQuery: string): string {
  const flattenedSource = source.replace(/\s+/g, ' ').trim()
  if (!flattenedSource) {
    return 'Coincidencia en el archivo'
  }

  const normalizedSource = normalizeSearchText(flattenedSource)
  const matchIndex = normalizedSource.indexOf(normalizedQuery)
  if (matchIndex < 0) {
    return flattenedSource.slice(0, 140)
  }

  const previewStart = Math.max(0, matchIndex - 44)
  const previewEnd = Math.min(flattenedSource.length, matchIndex + normalizedQuery.length + 72)
  const prefix = previewStart > 0 ? '... ' : ''
  const suffix = previewEnd < flattenedSource.length ? ' ...' : ''
  return `${prefix}${flattenedSource.slice(previewStart, previewEnd)}${suffix}`
}

function easeInOutCubic(value: number): number {
  if (value < 0.5) {
    return 4 * value * value * value
  }

  return 1 - Math.pow(-2 * value + 2, 3) / 2
}

function isNodeNearRestState(
  nodeIndex: number,
  nodes: readonly GraphSimulationNode[],
  topology: GraphSimulationTopology,
): boolean {
  const node = nodes[nodeIndex]
  if (!node) {
    return false
  }

  if (
    Math.abs(node.baseX - node.x) > GRAPH_PHYSICS_SETTLE_POSITION_EPSILON ||
    Math.abs(node.baseY - node.y) > GRAPH_PHYSICS_SETTLE_POSITION_EPSILON
  ) {
    return false
  }

  const linkedIndexes = topology.linkedIndexesByIndex[nodeIndex] ?? []
  for (const linkedIndex of linkedIndexes) {
    const linkedNode = nodes[linkedIndex]
    if (!linkedNode) {
      continue
    }

    const pairKey = buildEdgePairKey(node.path, linkedNode.path)
    const restLength = topology.restLengthByPairKey.get(pairKey)
    if (!restLength) {
      continue
    }

    const distance = Math.hypot(linkedNode.x - node.x, linkedNode.y - node.y)
    if (Math.abs(distance - restLength) > GRAPH_PHYSICS_SETTLE_REST_LENGTH_EPSILON) {
      return false
    }
  }

  return true
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function createEmptySimulationTopology(): GraphSimulationTopology {
  return {
    edges: [],
    pathToIndex: new Map(),
    linkedIndexesByIndex: [],
    restLengthByPairKey: new Map(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveLibraryStorageKey(libraryName: string): string {
  const normalizedName = libraryName.trim()
  return normalizedName.length > 0 ? normalizedName : '__default__'
}

function buildGraphModelSignature(graphModel: LibraryGraphModel): string {
  const nodeTokens = graphModel.nodes
    .map((node) => `${node.path}\u0001${node.label}\u0001${node.degree}`)
    .sort((left, right) => left.localeCompare(right))
  const edgeTokens = graphModel.edges
    .map((edge) => buildEdgePairKey(edge.sourcePath, edge.targetPath))
    .sort((left, right) => left.localeCompare(right))

  return `${nodeTokens.join('\u0002')}||${edgeTokens.join('\u0002')}`
}

function getStableGraphModelBySignature(signature: string, graphModel: LibraryGraphModel): LibraryGraphModel {
  const cachedGraphModel = graphModelBySignatureCache.get(signature)
  if (cachedGraphModel) {
    return cachedGraphModel
  }

  graphModelBySignatureCache.set(signature, graphModel)
  if (graphModelBySignatureCache.size > GRAPH_MODEL_SIGNATURE_CACHE_LIMIT) {
    const oldestSignature = graphModelBySignatureCache.keys().next().value
    if (oldestSignature) {
      graphModelBySignatureCache.delete(oldestSignature)
    }
  }

  return graphModel
}

function readGraphViewSettings(): Partial<GraphViewSettings> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const rawValue = window.localStorage.getItem(GRAPH_VIEW_SETTINGS_STORAGE_KEY)
    if (!rawValue) {
      return {}
    }
    const parsedValue = JSON.parse(rawValue)
    if (!parsedValue || typeof parsedValue !== 'object') {
      return {}
    }
    return parsedValue as Partial<GraphViewSettings>
  } catch {
    return {}
  }
}

function readGraphViewNodePositionsStore(): Record<string, Record<string, PersistedGraphNodePosition>> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const rawValue = window.localStorage.getItem(GRAPH_VIEW_NODE_POSITIONS_STORAGE_KEY)
    if (!rawValue) {
      return {}
    }

    const parsedValue: unknown = JSON.parse(rawValue)
    if (!isRecord(parsedValue)) {
      return {}
    }

    const store: Record<string, Record<string, PersistedGraphNodePosition>> = {}
    for (const [libraryKey, libraryValue] of Object.entries(parsedValue)) {
      if (!isRecord(libraryValue)) {
        continue
      }

      const positionsByPath: Record<string, PersistedGraphNodePosition> = {}
      for (const [path, pathValue] of Object.entries(libraryValue)) {
        if (!isRecord(pathValue)) {
          continue
        }

        const x = pathValue.x
        const y = pathValue.y
        if (typeof x !== 'number' || Number.isNaN(x) || typeof y !== 'number' || Number.isNaN(y)) {
          continue
        }

        positionsByPath[path] = { x, y }
      }

      store[libraryKey] = positionsByPath
    }

    return store
  } catch {
    return {}
  }
}

function readGraphViewNodePositionsForLibrary(libraryName: string): Map<string, PersistedGraphNodePosition> {
  const libraryStorageKey = resolveLibraryStorageKey(libraryName)
  const store = readGraphViewNodePositionsStore()
  const libraryPositions = store[libraryStorageKey]
  if (!libraryPositions) {
    return new Map()
  }

  return new Map(Object.entries(libraryPositions))
}

function resolveInitialNumber(
  storedSettings: Partial<GraphViewSettings>,
  key: keyof GraphViewSettings,
  fallback: number,
  min: number,
  max: number,
): number {
  const candidateValue = storedSettings[key]
  if (typeof candidateValue !== 'number' || Number.isNaN(candidateValue)) {
    return fallback
  }
  return clamp(candidateValue, min, max)
}

function formatZoomValue(scale: number): string {
  if (scale >= 1) {
    return `${scale.toFixed(2)}x`
  }

  if (scale >= 0.1) {
    return `${scale.toFixed(3)}x`
  }

  return `${scale.toExponential(2)}x`
}

function buildLinkedPathSet(focusPath: string | null, edges: readonly GraphEdgeLike[]): Set<string> | null {
  if (!focusPath) {
    return null
  }

  const connectedPaths = new Set<string>([focusPath])
  for (const edge of edges) {
    if (edge.sourcePath === focusPath || edge.targetPath === focusPath) {
      connectedPaths.add(edge.sourcePath)
      connectedPaths.add(edge.targetPath)
    }
  }

  return connectedPaths
}

function buildEdgeBorderEndpoints(sourceNode: GraphNodeLike, targetNode: GraphNodeLike) {
  const deltaX = targetNode.x - sourceNode.x
  const deltaY = targetNode.y - sourceNode.y
  const distance = Math.hypot(deltaX, deltaY)
  if (distance <= 0.001) {
    return null
  }

  const minDistanceWithoutOverlap = sourceNode.radius + targetNode.radius
  if (distance <= minDistanceWithoutOverlap) {
    return null
  }

  const directionX = deltaX / distance
  const directionY = deltaY / distance

  return {
    x1: sourceNode.x + directionX * sourceNode.radius,
    y1: sourceNode.y + directionY * sourceNode.radius,
    x2: targetNode.x - directionX * targetNode.radius,
    y2: targetNode.y - directionY * targetNode.radius,
  }
}

function toSimulationNodes(
  nodes: readonly PositionedGraphNode[],
  persistedPositions: Map<string, PersistedGraphNodePosition>,
): GraphSimulationNode[] {
  return nodes.map((node) => new GraphSimulationNode(node, persistedPositions.get(node.path)))
}

function buildEdgePairKey(leftPath: string, rightPath: string): string {
  return leftPath < rightPath ? `${leftPath}::${rightPath}` : `${rightPath}::${leftPath}`
}

function computeStableAngleOffset(path: string): number {
  let hash = 2166136261
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return ((hash % 360) * Math.PI) / 180
}

function buildGraphSimulationTopology(
  nodes: readonly GraphSimulationNode[],
  edges: readonly PositionedGraphEdge[],
  preferredRestLengthByPairKey?: ReadonlyMap<string, number>,
): GraphSimulationTopology {
  for (const node of nodes) {
    node.linkedNodes = []
  }

  const pathToIndex = new Map<string, number>()
  nodes.forEach((node, index) => {
    pathToIndex.set(node.path, index)
  })

  const linkedIndexesByIndex = Array.from({ length: nodes.length }, () => [] as number[])
  const restLengthByPairKey = new Map<string, number>()
  const simulationEdges: GraphSimulationEdge[] = []

  for (const edge of edges) {
    const sourceIndex = pathToIndex.get(edge.sourcePath)
    const targetIndex = pathToIndex.get(edge.targetPath)
    if (sourceIndex === undefined || targetIndex === undefined || sourceIndex === targetIndex) {
      continue
    }

    const sourceNode = nodes[sourceIndex]
    const targetNode = nodes[targetIndex]
    const pairKey = buildEdgePairKey(sourceNode.path, targetNode.path)
    const fallbackDistance = Math.max(1, Math.hypot(targetNode.x - sourceNode.x, targetNode.y - sourceNode.y))
    const distance = Math.max(1, preferredRestLengthByPairKey?.get(pairKey) ?? fallbackDistance)
    simulationEdges.push({
      sourceIndex,
      targetIndex,
      restLength: distance,
    })
    linkedIndexesByIndex[sourceIndex].push(targetIndex)
    linkedIndexesByIndex[targetIndex].push(sourceIndex)
    restLengthByPairKey.set(pairKey, distance)
    sourceNode.linkedNodes.push(targetNode)
    targetNode.linkedNodes.push(sourceNode)
  }

  return {
    edges: simulationEdges,
    pathToIndex,
    linkedIndexesByIndex,
    restLengthByPairKey,
  }
}

function resolveEdgeCorrectionStrength(
  baseStrength: number,
  sourceIndex: number,
  targetIndex: number,
  dragNeighborhood: GraphDragNeighborhood | null,
): number {
  if (!dragNeighborhood) {
    return baseStrength
  }

  const { draggedIndex, directLinkedIndexes, secondRingIndexes } = dragNeighborhood
  const sourceIsDragged = sourceIndex === draggedIndex
  const targetIsDragged = targetIndex === draggedIndex
  if (sourceIsDragged || targetIsDragged) {
    const neighborIndex = sourceIsDragged ? targetIndex : sourceIndex
    if (directLinkedIndexes.has(neighborIndex)) {
      return baseStrength * 0.52
    }
    return baseStrength * 0.75
  }

  const sourceIsDirect = directLinkedIndexes.has(sourceIndex)
  const targetIsDirect = directLinkedIndexes.has(targetIndex)
  if (sourceIsDirect && targetIsDirect) {
    return baseStrength * 0.22
  }

  const sourceIsSecondRing = secondRingIndexes.has(sourceIndex)
  const targetIsSecondRing = secondRingIndexes.has(targetIndex)
  if ((sourceIsDirect && targetIsSecondRing) || (targetIsDirect && sourceIsSecondRing)) {
    return baseStrength * 0.35
  }
  if (sourceIsSecondRing && targetIsSecondRing) {
    return baseStrength * 0.28
  }

  return baseStrength
}

function applyElasticEdgeConstraints(
  nodes: GraphSimulationNode[],
  topology: GraphSimulationTopology,
  draggedNodeIndex: number,
  dragNeighborhood: GraphDragNeighborhood | null,
  activeClusterIndex: number | null,
) {
  for (const edge of topology.edges) {
    const sourceNode = nodes[edge.sourceIndex]
    const targetNode = nodes[edge.targetIndex]
    if (
      activeClusterIndex !== null &&
      sourceNode.clusterIndex !== activeClusterIndex &&
      targetNode.clusterIndex !== activeClusterIndex
    ) {
      continue
    }
    let dx = targetNode.x - sourceNode.x
    let dy = targetNode.y - sourceNode.y
    let distance = Math.hypot(dx, dy)
    if (distance < 0.001) {
      dx = 0.001
      dy = 0.001
      distance = 0.001
    }

    const edgeError = distance - edge.restLength
    const isCompressed = edgeError < 0
    if (Math.abs(edgeError) <= GRAPH_PHYSICS_EDGE_CONSTRAINT_SLOP) {
      continue
    }

    const errorMagnitude = Math.abs(edgeError)
    const normalizedError = errorMagnitude / distance
    const baseCorrectionStrength = isCompressed
      ? GRAPH_PHYSICS_EDGE_COMPRESSION_STRENGTH
      : GRAPH_PHYSICS_EDGE_STRETCH_STRENGTH
    const correctionStrength = resolveEdgeCorrectionStrength(
      baseCorrectionStrength,
      edge.sourceIndex,
      edge.targetIndex,
      dragNeighborhood,
    )
    const correctionX = dx * normalizedError * correctionStrength
    const correctionY = dy * normalizedError * correctionStrength
    const sourceIsDragged = edge.sourceIndex === draggedNodeIndex
    const targetIsDragged = edge.targetIndex === draggedNodeIndex

    if (sourceIsDragged && !targetIsDragged) {
      targetNode.x += isCompressed ? correctionX : -correctionX
      targetNode.y += isCompressed ? correctionY : -correctionY
      continue
    }
    if (targetIsDragged && !sourceIsDragged) {
      sourceNode.x += isCompressed ? -correctionX : correctionX
      sourceNode.y += isCompressed ? -correctionY : correctionY
      continue
    }

    sourceNode.x += isCompressed ? -correctionX * 0.5 : correctionX * 0.5
    sourceNode.y += isCompressed ? -correctionY * 0.5 : correctionY * 0.5
    targetNode.x += isCompressed ? correctionX * 0.5 : -correctionX * 0.5
    targetNode.y += isCompressed ? correctionY * 0.5 : -correctionY * 0.5
  }
}

function applyCollisionConstraints(
  nodes: GraphSimulationNode[],
  draggedNodeIndex: number,
  activeClusterIndex: number | null,
) {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const leftNode = nodes[leftIndex]
    if (activeClusterIndex !== null && leftNode.clusterIndex !== activeClusterIndex) {
      continue
    }
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const rightNode = nodes[rightIndex]
      if (leftNode.clusterIndex !== rightNode.clusterIndex) {
        continue
      }
      if (activeClusterIndex !== null && rightNode.clusterIndex !== activeClusterIndex) {
        continue
      }
      let dx = rightNode.x - leftNode.x
      let dy = rightNode.y - leftNode.y
      let distance = Math.hypot(dx, dy)
      if (distance < 0.001) {
        const jitter = ((leftIndex + rightIndex) % 2 === 0 ? 1 : -1) * 0.001
        dx = jitter
        dy = jitter
        distance = 0.001
      }

      const minDistance = leftNode.radius + rightNode.radius + GRAPH_PHYSICS_COLLISION_PADDING
      if (distance >= minDistance) {
        continue
      }

      const overlap = minDistance - distance
      if (overlap <= GRAPH_PHYSICS_COLLISION_SLOP) {
        continue
      }

      const effectiveOverlap = overlap - GRAPH_PHYSICS_COLLISION_SLOP
      const correctionX = (dx / distance) * effectiveOverlap
      const correctionY = (dy / distance) * effectiveOverlap
      const leftIsDragged = leftIndex === draggedNodeIndex
      const rightIsDragged = rightIndex === draggedNodeIndex

      if (leftIsDragged && !rightIsDragged) {
        rightNode.x += correctionX
        rightNode.y += correctionY
        continue
      }
      if (rightIsDragged && !leftIsDragged) {
        leftNode.x -= correctionX
        leftNode.y -= correctionY
        continue
      }

      leftNode.x -= correctionX * 0.5
      leftNode.y -= correctionY * 0.5
      rightNode.x += correctionX * 0.5
      rightNode.y += correctionY * 0.5
    }
  }
}

function stepGraphSimulation(
  nodes: GraphSimulationNode[],
  topology: GraphSimulationTopology,
  dragSession: NodeDragSession | null,
  deltaScale: number,
): boolean {
  if (nodes.length === 0) {
    return false
  }

  const draggedNodeIndex = dragSession === null ? -1 : (topology.pathToIndex.get(dragSession.path) ?? -1)
  const activeClusterIndex = draggedNodeIndex >= 0 ? nodes[draggedNodeIndex]?.clusterIndex ?? null : null
  const dragNeighborhood =
    draggedNodeIndex >= 0
      ? (() => {
          const directIndexes = new Set(topology.linkedIndexesByIndex[draggedNodeIndex] ?? [])
          const directLeafIndexes = new Set<number>()
          const secondRingIndexes = new Set<number>()

          for (const directIndex of directIndexes) {
            const linkedIndexes = topology.linkedIndexesByIndex[directIndex] ?? []
            const linksExcludingDragged = linkedIndexes.filter((index) => index !== draggedNodeIndex)
            if (linksExcludingDragged.length === 0) {
              directLeafIndexes.add(directIndex)
            }
          }

          for (const directIndex of directIndexes) {
            const secondRingCandidates = topology.linkedIndexesByIndex[directIndex] ?? []
            for (const candidateIndex of secondRingCandidates) {
              if (candidateIndex === draggedNodeIndex || directIndexes.has(candidateIndex)) {
                continue
              }
              secondRingIndexes.add(candidateIndex)
            }
          }

          return {
            draggedIndex: draggedNodeIndex,
            directLinkedIndexes: directIndexes,
            directLeafIndexes,
            secondRingIndexes,
          } satisfies GraphDragNeighborhood
        })()
      : null
  const isNodeDragActive = dragSession !== null && draggedNodeIndex >= 0
  if (isNodeDragActive) {
    const draggedNode = nodes[draggedNodeIndex]
    draggedNode.x = dragSession.targetX
    draggedNode.y = dragSession.targetY
  }
  const previousPositions = nodes.map((node) => ({ x: node.x, y: node.y }))
  for (const node of nodes) {
    node.dragTargetX = null
    node.dragTargetY = null
  }

  for (let index = 0; index < nodes.length; index += 1) {
    if (index === draggedNodeIndex) {
      continue
    }

    const node = nodes[index]
    if (activeClusterIndex !== null && node.clusterIndex !== activeClusterIndex) {
      node.vx = 0
      node.vy = 0
      continue
    }
    const isFreeNode = (topology.linkedIndexesByIndex[index]?.length ?? 0) === 0
    if (isFreeNode) {
      node.vx += (node.baseX - node.x) * GRAPH_PHYSICS_FREE_NODE_ANCHOR_PULL * deltaScale
      node.vy += (node.baseY - node.y) * GRAPH_PHYSICS_FREE_NODE_ANCHOR_PULL * deltaScale
    } else {
      node.vx += (node.baseX - node.x) * GRAPH_PHYSICS_ANCHORED_NODE_PULL * deltaScale
      node.vy += (node.baseY - node.y) * GRAPH_PHYSICS_ANCHORED_NODE_PULL * deltaScale
    }

    node.vx *= GRAPH_PHYSICS_DAMPING
    node.vy *= GRAPH_PHYSICS_DAMPING
    node.x += node.vx * deltaScale
    node.y += node.vy * deltaScale
  }

  if (dragSession && draggedNodeIndex >= 0) {
    const draggedNode = nodes[draggedNodeIndex]
    draggedNode.x = dragSession.targetX
    draggedNode.y = dragSession.targetY

    const draggedNodePath = draggedNode.path
    const directLeafIndexes = Array.from(dragNeighborhood?.directLeafIndexes ?? [])
      .sort((leftIndex, rightIndex) => nodes[leftIndex].path.localeCompare(nodes[rightIndex].path))
    if (directLeafIndexes.length > 0) {
      const maxLeafRadius = directLeafIndexes.reduce(
        (currentMax, nodeIndex) => Math.max(currentMax, nodes[nodeIndex]?.radius ?? 0),
        0,
      )
      const requiredCircumference =
        directLeafIndexes.length * Math.max(maxLeafRadius * 2 + GRAPH_PHYSICS_COLLISION_PADDING * 2, 18)
      const leafRingRadius = Math.max(
        GRAPH_PHYSICS_DRAG_LEAF_RING_MIN_RADIUS,
        draggedNode.radius + maxLeafRadius + GRAPH_PHYSICS_DRAG_LEAF_RING_PADDING,
        requiredCircumference / (Math.PI * 2),
      )
      const angleStep = (Math.PI * 2) / directLeafIndexes.length
      const angleOffset = computeStableAngleOffset(draggedNode.path)

      for (let orderIndex = 0; orderIndex < directLeafIndexes.length; orderIndex += 1) {
        const linkedIndex = directLeafIndexes[orderIndex]
        const linkedNode = nodes[linkedIndex]
        const targetAngle = angleOffset + orderIndex * angleStep
        const targetX = draggedNode.x + Math.cos(targetAngle) * leafRingRadius
        const targetY = draggedNode.y + Math.sin(targetAngle) * leafRingRadius
        linkedNode.dragTargetX = targetX
        linkedNode.dragTargetY = targetY
        linkedNode.vx += (targetX - linkedNode.x) * GRAPH_PHYSICS_DRAG_LEAF_RING_PULL * deltaScale
        linkedNode.vy += (targetY - linkedNode.y) * GRAPH_PHYSICS_DRAG_LEAF_RING_PULL * deltaScale
      }
    }

    for (const linkedIndex of dragNeighborhood?.directLinkedIndexes ?? []) {
      if (dragNeighborhood?.directLeafIndexes.has(linkedIndex)) {
        continue
      }

      const linkedNode = nodes[linkedIndex]
      const pairKey = buildEdgePairKey(draggedNodePath, linkedNode.path)
      const preferredDistance = topology.restLengthByPairKey.get(pairKey) ?? Math.max(24, draggedNode.radius + linkedNode.radius + 14)
      const dx = draggedNode.x - linkedNode.x
      const dy = draggedNode.y - linkedNode.y
      const distance = Math.max(0.001, Math.hypot(dx, dy))
      const distanceError = distance - preferredDistance
      if (distanceError > 0) {
        linkedNode.vx += (dx / distance) * distanceError * GRAPH_PHYSICS_DRAG_NEIGHBOR_PULL * deltaScale
        linkedNode.vy += (dy / distance) * distanceError * GRAPH_PHYSICS_DRAG_NEIGHBOR_PULL * deltaScale
      }
    }

    for (const linkedIndex of dragNeighborhood?.secondRingIndexes ?? []) {
      const linkedNode = nodes[linkedIndex]
      linkedNode.vx += (linkedNode.baseX - linkedNode.x) * GRAPH_PHYSICS_SECOND_RING_PULL * deltaScale
      linkedNode.vy += (linkedNode.baseY - linkedNode.y) * GRAPH_PHYSICS_SECOND_RING_PULL * deltaScale
    }
  }

  for (let iteration = 0; iteration < GRAPH_PHYSICS_CONSTRAINT_ITERATIONS; iteration += 1) {
    for (let index = 0; index < nodes.length; index += 1) {
      if (index === draggedNodeIndex) {
        continue
      }

      const node = nodes[index]
      if (node.dragTargetX !== null && node.dragTargetY !== null) {
        node.x += (node.dragTargetX - node.x) * GRAPH_PHYSICS_DRAG_LEAF_RING_SETTLE
        node.y += (node.dragTargetY - node.y) * GRAPH_PHYSICS_DRAG_LEAF_RING_SETTLE
      }
    }

    applyElasticEdgeConstraints(nodes, topology, draggedNodeIndex, dragNeighborhood, activeClusterIndex)
    applyCollisionConstraints(nodes, draggedNodeIndex, activeClusterIndex)
    if (dragSession && draggedNodeIndex >= 0) {
      const draggedNode = nodes[draggedNodeIndex]
      draggedNode.x = dragSession.targetX
      draggedNode.y = dragSession.targetY
    }
  }

  let maxMovement = 0
  for (let index = 0; index < nodes.length; index += 1) {
    if (index === draggedNodeIndex) {
      nodes[index].vx = dragSession?.velocityX ?? 0
      nodes[index].vy = dragSession?.velocityY ?? 0
      continue
    }

    const node = nodes[index]
    if (activeClusterIndex !== null && node.clusterIndex !== activeClusterIndex) {
      node.vx = 0
      node.vy = 0
      continue
    }
    const previous = previousPositions[index]
    const positionalDeltaX = node.x - previous.x
    const positionalDeltaY = node.y - previous.y
    let nextVx = node.vx * (1 - GRAPH_PHYSICS_CONSTRAINT_VELOCITY_TRANSFER) + positionalDeltaX * GRAPH_PHYSICS_CONSTRAINT_VELOCITY_TRANSFER
    let nextVy = node.vy * (1 - GRAPH_PHYSICS_CONSTRAINT_VELOCITY_TRANSFER) + positionalDeltaY * GRAPH_PHYSICS_CONSTRAINT_VELOCITY_TRANSFER
    if (
      dragNeighborhood &&
      index !== draggedNodeIndex &&
      !dragNeighborhood.directLinkedIndexes.has(index)
    ) {
      const isSecondRingNode = dragNeighborhood.secondRingIndexes.has(index)
      const damping = isSecondRingNode ? GRAPH_PHYSICS_DRAG_NEIGHBOR_DAMPING : GRAPH_PHYSICS_DRAG_OUTER_RING_DAMPING
      nextVx *= damping
      nextVy *= damping
    }

    nextVx = clampSignedMagnitude(nextVx, GRAPH_PHYSICS_MAX_NODE_SPEED)
    nextVy = clampSignedMagnitude(nextVy, GRAPH_PHYSICS_MAX_NODE_SPEED)
    if (
      Math.abs(nextVx) <= GRAPH_PHYSICS_SETTLE_VELOCITY_EPSILON &&
      Math.abs(nextVy) <= GRAPH_PHYSICS_SETTLE_VELOCITY_EPSILON &&
      isNodeNearRestState(index, nodes, topology)
    ) {
      node.x = node.baseX
      node.y = node.baseY
      node.vx = 0
      node.vy = 0
      continue
    }

    node.vx = Math.abs(nextVx) <= GRAPH_PHYSICS_VELOCITY_SLEEP_EPSILON ? 0 : nextVx
    node.vy = Math.abs(nextVy) <= GRAPH_PHYSICS_VELOCITY_SLEEP_EPSILON ? 0 : nextVy
    maxMovement = Math.max(maxMovement, Math.hypot(node.vx, node.vy))
  }

  return maxMovement > GRAPH_PHYSICS_MOVEMENT_SLEEP_EPSILON || dragSession !== null
}

function persistGraphNodePositionsForLibrary(libraryName: string, nodes: readonly GraphSimulationNode[]): void {
  if (typeof window === 'undefined') {
    return
  }

  const libraryStorageKey = resolveLibraryStorageKey(libraryName)
  const nextStore = readGraphViewNodePositionsStore()
  const positionsByPath: Record<string, PersistedGraphNodePosition> = {}

  for (const node of nodes) {
    if (!Number.isFinite(node.baseX) || !Number.isFinite(node.baseY)) {
      continue
    }

    positionsByPath[node.path] = {
      x: node.baseX,
      y: node.baseY,
    }
  }

  nextStore[libraryStorageKey] = positionsByPath
  window.localStorage.setItem(GRAPH_VIEW_NODE_POSITIONS_STORAGE_KEY, JSON.stringify(nextStore))
}

function clearGraphNodePositionsForLibrary(libraryName: string): void {
  if (typeof window === 'undefined') {
    return
  }

  const libraryStorageKey = resolveLibraryStorageKey(libraryName)
  const nextStore = readGraphViewNodePositionsStore()
  if (!(libraryStorageKey in nextStore)) {
    return
  }

  delete nextStore[libraryStorageKey]
  if (Object.keys(nextStore).length === 0) {
    window.localStorage.removeItem(GRAPH_VIEW_NODE_POSITIONS_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(GRAPH_VIEW_NODE_POSITIONS_STORAGE_KEY, JSON.stringify(nextStore))
}

export function GraphView({ graphModel, graphSourcesByPath, libraryName, isLoading, onOpenFile }: GraphViewProps) {
  const initialSettings = useMemo(() => readGraphViewSettings(), [])
  const graphModelSignature = useMemo(() => buildGraphModelSignature(graphModel), [graphModel])
  const stableGraphModel = useMemo(
    () => getStableGraphModelBySignature(graphModelSignature, graphModel),
    [graphModel, graphModelSignature],
  )
  const canvasRef = useRef<HTMLDivElement>(null)
  const searchResultsRef = useRef<HTMLDivElement>(null)
  const controlsButtonRef = useRef<HTMLButtonElement>(null)
  const controlsPanelRef = useRef<HTMLDivElement>(null)
  const searchScrollSessionRef = useRef<GraphSearchScrollSession | null>(null)
  const dragStartRef = useRef<{
    originX: number
    originY: number
    pointerX: number
    pointerY: number
  } | null>(null)
  const nodeDragRef = useRef<NodeDragSession | null>(null)
  const simulationNodesRef = useRef<GraphSimulationNode[]>([])
  const simulationTopologyRef = useRef<GraphSimulationTopology>(createEmptySimulationTopology())
  const simulationFrameRef = useRef<number | null>(null)
  const viewportAnimationFrameRef = useRef<number | null>(null)
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 })
  const simulationLastTimestampRef = useRef<number | null>(null)
  const simulationNeedsSyncRef = useRef(true)
  const dragMovedRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 })
  const [displayedNodes, setDisplayedNodes] = useState<GraphRenderNode[]>([])
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const [hoveredSearchResultPath, setHoveredSearchResultPath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [isControlsOpen, setIsControlsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [nodeSizeMultiplier, setNodeSizeMultiplier] = useState(() =>
    resolveInitialNumber(
      initialSettings,
      'nodeSizeMultiplier',
      DEFAULT_NODE_SIZE_MULTIPLIER,
      INPUT_MIN_NODE_SIZE_MULTIPLIER,
      INPUT_MAX_NODE_SIZE_MULTIPLIER,
    ),
  )

  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const settingsToPersist: GraphViewSettings = {
      nodeSizeMultiplier,
    }

    window.localStorage.setItem(GRAPH_VIEW_SETTINGS_STORAGE_KEY, JSON.stringify(settingsToPersist))
  }, [nodeSizeMultiplier])

  useEffect(() => {
    const canvasElement = canvasRef.current
    if (!canvasElement) {
      return
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const firstEntry = entries[0]
      if (!firstEntry) {
        return
      }

      const nextWidth = Math.floor(firstEntry.contentRect.width)
      const nextHeight = Math.floor(firstEntry.contentRect.height)
      setCanvasSize((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current
        }

        return {
          width: nextWidth,
          height: nextHeight,
        }
      })
    })

    resizeObserver.observe(canvasElement)
    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!isControlsOpen) {
      return
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      const clickedButton = Boolean(controlsButtonRef.current?.contains(target))
      const clickedPanel = Boolean(controlsPanelRef.current?.contains(target))
      if (clickedButton || clickedPanel) {
        return
      }

      setIsControlsOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsControlsOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isControlsOpen])

  const graphLayout = useMemo(
    () =>
      buildClusteredGraphLayout(stableGraphModel, canvasSize.width, canvasSize.height, {
        spacingMultiplier: DEFAULT_SPACING_MULTIPLIER,
        linkedSpacingMultiplier: DEFAULT_LINKED_SPACING_MULTIPLIER,
        componentSpacingMultiplier: DEFAULT_COMPONENT_SPACING_MULTIPLIER,
        componentSpacingScaleMultiplier: DEFAULT_COMPONENT_SPACING_SCALE_MULTIPLIER,
        freeNodeSpacing: DEFAULT_FREE_NODE_SPACING,
        freeNodeSpacingMultiplier: DEFAULT_FREE_NODE_SPACING_MULTIPLIER,
        nodeSizeMultiplier,
      }),
    [
      canvasSize.height,
      canvasSize.width,
      stableGraphModel,
      nodeSizeMultiplier,
    ],
  )

  const buildInitialSimulationNodes = useCallback(
    (): GraphSimulationNode[] =>
      toSimulationNodes(graphLayout.nodes, readGraphViewNodePositionsForLibrary(libraryName)),
    [graphLayout.nodes, libraryName],
  )

  useEffect(() => {
    const nextSimulationNodes = buildInitialSimulationNodes()
    simulationNodesRef.current = nextSimulationNodes
    simulationTopologyRef.current = buildGraphSimulationTopology(nextSimulationNodes, graphLayout.edges)
    nodeDragRef.current = null
    dragStartRef.current = null
    simulationNeedsSyncRef.current = true
    simulationLastTimestampRef.current = null
  }, [buildInitialSimulationNodes, graphLayout.edges])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (simulationFrameRef.current !== null) {
      window.cancelAnimationFrame(simulationFrameRef.current)
      simulationFrameRef.current = null
    }

    const tick = (timestamp: number) => {
      if (simulationLastTimestampRef.current === null) {
        simulationLastTimestampRef.current = timestamp
      }
      const elapsedMs = timestamp - simulationLastTimestampRef.current
      simulationLastTimestampRef.current = timestamp
      const deltaScale = clamp(elapsedMs / 16.667, GRAPH_PHYSICS_MIN_DELTA, GRAPH_PHYSICS_MAX_DELTA)
      const simulationNodes = simulationNodesRef.current
      const hadMovement = stepGraphSimulation(
        simulationNodes,
        simulationTopologyRef.current,
        nodeDragRef.current,
        deltaScale,
      )
      if (hadMovement || simulationNeedsSyncRef.current) {
        simulationNeedsSyncRef.current = false
        setDisplayedNodes(simulationNodes.map((node) => node.toRenderNode()))
      }
      simulationFrameRef.current = window.requestAnimationFrame(tick)
    }

    simulationFrameRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (simulationFrameRef.current !== null) {
        window.cancelAnimationFrame(simulationFrameRef.current)
      }
      simulationFrameRef.current = null
      simulationLastTimestampRef.current = null
    }
  }, [graphLayout.edges])

  const renderedNodes = useMemo(() => {
    if (displayedNodes.length > 0) {
      return displayedNodes
    }
    return buildInitialSimulationNodes().map((node) => node.toRenderNode())
  }, [buildInitialSimulationNodes, displayedNodes])

  const positionedNodesByPath = useMemo(() => {
    const map = new Map<string, GraphRenderNode>()
    for (const node of renderedNodes) {
      map.set(node.path, node)
    }
    return map
  }, [renderedNodes])
  const normalizedSearchQuery = useMemo(() => normalizeSearchText(searchQuery.trim()), [searchQuery])
  const searchResults = useMemo(() => {
    if (!normalizedSearchQuery) {
      return [] as GraphSearchResult[]
    }

    const nextResults: GraphSearchResult[] = []
    for (const node of graphModel.nodes) {
      const normalizedLabel = normalizeSearchText(node.label)
      const extractedContent = extractSearchableContent(node.path, graphSourcesByPath[node.path] ?? '')
      const normalizedContent = normalizeSearchText(extractedContent)
      const titleMatchIndex = normalizedLabel.indexOf(normalizedSearchQuery)
      const contentMatchIndex = normalizedContent.indexOf(normalizedSearchQuery)
      if (titleMatchIndex < 0 && contentMatchIndex < 0) {
        continue
      }

      const titleScore = titleMatchIndex < 0 ? 0 : 600 - titleMatchIndex * 8
      const contentScore = contentMatchIndex < 0 ? 0 : 240 - Math.min(contentMatchIndex, 180)
      nextResults.push({
        path: node.path,
        label: node.label,
        preview: buildSearchPreview(extractedContent, normalizedSearchQuery),
        score: titleScore + contentScore + Math.min(node.degree, 12) * 4,
      })
    }

    return nextResults
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }
        return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
      })
      .slice(0, 8)
  }, [graphModel.nodes, graphSourcesByPath, normalizedSearchQuery])
  const searchMatchedPaths = useMemo(() => new Set(searchResults.map((result) => result.path)), [searchResults])

  const visibleEdges = useMemo(() => {
    return graphLayout.edges.filter(
      (edge) => positionedNodesByPath.has(edge.sourcePath) && positionedNodesByPath.has(edge.targetPath),
    )
  }, [graphLayout.edges, positionedNodesByPath])

  const selectedPathInLayout = selectedPath && positionedNodesByPath.has(selectedPath) ? selectedPath : null

  const linkedToHoveredPath = useMemo(() => {
    return buildLinkedPathSet(hoveredPath, visibleEdges)
  }, [hoveredPath, visibleEdges])

  const linkedToSelectedPath = useMemo(() => {
    return buildLinkedPathSet(selectedPathInLayout, visibleEdges)
  }, [selectedPathInLayout, visibleEdges])

  const highlightedPaths = linkedToSelectedPath ?? linkedToHoveredPath

  const resolveGraphCoordinatesFromClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const canvasElement = canvasRef.current
      if (!canvasElement || canvasSize.width <= 0 || canvasSize.height <= 0) {
        return null
      }

      const rect = canvasElement.getBoundingClientRect()
      const localX = clientX - rect.left - canvasSize.width / 2
      const localY = clientY - rect.top - canvasSize.height / 2

      return {
        x: (localX - viewport.x) / viewport.scale,
        y: (localY - viewport.y) / viewport.scale,
      }
    },
    [canvasSize.height, canvasSize.width, viewport.scale, viewport.x, viewport.y],
  )

  const updateNodeDragTarget = useCallback(
    (clientX: number, clientY: number) => {
      const dragSession = nodeDragRef.current
      if (!dragSession) {
        return false
      }

      const graphCoordinates = resolveGraphCoordinatesFromClientPoint(clientX, clientY)
      if (!graphCoordinates) {
        return false
      }

      const nextTargetX = graphCoordinates.x + dragSession.pointerOffsetX
      const nextTargetY = graphCoordinates.y + dragSession.pointerOffsetY
      const deltaX = nextTargetX - dragSession.targetX
      const deltaY = nextTargetY - dragSession.targetY

      dragSession.velocityX = deltaX
      dragSession.velocityY = deltaY
      dragSession.targetX = nextTargetX
      dragSession.targetY = nextTargetY
      return Math.hypot(deltaX, deltaY) > 0.2
    },
    [resolveGraphCoordinatesFromClientPoint],
  )

  const commitDraggedNodePositions = useCallback(() => {
    const simulationNodes = simulationNodesRef.current
    if (simulationNodes.length === 0) {
      return
    }

    const previousRestLengthByPairKey = simulationTopologyRef.current.restLengthByPairKey

    for (const node of simulationNodes) {
      node.baseX = node.x
      node.baseY = node.y
      node.vx *= 0.5
      node.vy *= 0.5
    }

    simulationTopologyRef.current = buildGraphSimulationTopology(
      simulationNodes,
      graphLayout.edges,
      previousRestLengthByPairKey,
    )
    simulationNeedsSyncRef.current = true
    setDisplayedNodes(simulationNodes.map((node) => node.toRenderNode()))
    persistGraphNodePositionsForLibrary(libraryName, simulationNodes)
  }, [graphLayout.edges, libraryName])

  const handleCanvasMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    if (nodeDragRef.current) {
      return
    }

    dragMovedRef.current = false
    dragStartRef.current = {
      originX: viewport.x,
      originY: viewport.y,
      pointerX: event.clientX,
      pointerY: event.clientY,
    }
    setIsDragging(true)
  }

  const handleCanvasMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (nodeDragRef.current) {
      if (updateNodeDragTarget(event.clientX, event.clientY)) {
        dragMovedRef.current = true
      }
      return
    }

    const dragStart = dragStartRef.current
    if (!dragStart) {
      return
    }

    const deltaX = event.clientX - dragStart.pointerX
    const deltaY = event.clientY - dragStart.pointerY
    if (Math.abs(deltaX) + Math.abs(deltaY) > 2) {
      dragMovedRef.current = true
    }

    setViewport((current) => {
      const nextX = dragStart.originX + deltaX
      const nextY = dragStart.originY + deltaY

      if (current.x === nextX && current.y === nextY) {
        return current
      }

      return {
        ...current,
        x: nextX,
        y: nextY,
      }
    })
  }

  const handleCanvasMouseUp = () => {
    const releasedNodePath = nodeDragRef.current?.path
    if (releasedNodePath) {
      commitDraggedNodePositions()
    }
    nodeDragRef.current = null
    setDraggedPath(null)
    dragStartRef.current = null
    setIsDragging(false)
  }

  const handleCanvasMouseLeave = () => {
    const releasedNodePath = nodeDragRef.current?.path
    if (releasedNodePath) {
      commitDraggedNodePositions()
    }
    nodeDragRef.current = null
    setDraggedPath(null)
    dragStartRef.current = null
    setIsDragging(false)
    setHoveredPath(null)
  }

  useEffect(() => {
    if (!isDragging) {
      return
    }

    const handleWindowMouseMove = (event: globalThis.MouseEvent) => {
      if (nodeDragRef.current) {
        if (updateNodeDragTarget(event.clientX, event.clientY)) {
          dragMovedRef.current = true
        }
        return
      }

      const dragStart = dragStartRef.current
      if (!dragStart) {
        return
      }

      const deltaX = event.clientX - dragStart.pointerX
      const deltaY = event.clientY - dragStart.pointerY
      if (Math.abs(deltaX) + Math.abs(deltaY) > 2) {
        dragMovedRef.current = true
      }

      setViewport((current) => ({
        ...current,
        x: dragStart.originX + deltaX,
        y: dragStart.originY + deltaY,
      }))
    }

    const handleWindowMouseUp = () => {
      const releasedNodePath = nodeDragRef.current?.path
      if (releasedNodePath) {
        commitDraggedNodePositions()
      }
      nodeDragRef.current = null
      setDraggedPath(null)
      dragStartRef.current = null
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [commitDraggedNodePositions, isDragging, updateNodeDragTarget])

  const handleCanvasClick = () => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false
      return
    }

    setSelectedPath(null)
  }

  const handleCanvasWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const canvasElement = canvasRef.current
    if (!canvasElement) {
      return
    }

    const rect = canvasElement.getBoundingClientRect()
    const pointerX = event.clientX - rect.left - canvasSize.width / 2
    const pointerY = event.clientY - rect.top - canvasSize.height / 2
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9

    setViewport((current) => {
      const rawNextScale = current.scale * zoomFactor
      const nextScale =
        zoomFactor < 1
          ? Math.max(rawNextScale, MIN_ZOOM_EPSILON)
          : Math.min(rawNextScale, MAX_ZOOM)
      if (nextScale === current.scale) {
        return current
      }

      const scaleRatio = nextScale / current.scale
      return {
        scale: nextScale,
        x: current.x - pointerX * (scaleRatio - 1),
        y: current.y - pointerY * (scaleRatio - 1),
      }
    })
  }

  const handleResetViewport = () => {
    if (typeof window !== 'undefined' && viewportAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportAnimationFrameRef.current)
      viewportAnimationFrameRef.current = null
    }

    setViewport({ x: 0, y: 0, scale: 1 })
    clearGraphNodePositionsForLibrary(libraryName)

    const naturalNodes = toSimulationNodes(graphLayout.nodes, new Map<string, PersistedGraphNodePosition>())
    simulationNodesRef.current = naturalNodes
    simulationTopologyRef.current = buildGraphSimulationTopology(naturalNodes, graphLayout.edges)
    simulationNeedsSyncRef.current = true
    simulationLastTimestampRef.current = null
    nodeDragRef.current = null
    dragStartRef.current = null
    setDraggedPath(null)
    setIsDragging(false)
    setDisplayedNodes(naturalNodes.map((node) => node.toRenderNode()))
  }

  const focusNodeInViewport = useCallback(
    (filePath: string) => {
      const node = positionedNodesByPath.get(filePath)
      if (!node) {
        return
      }

      const nextScale = Math.min(MAX_ZOOM, Math.max(viewport.scale, 1.65))
      const nextViewport = {
        scale: nextScale,
        x: -node.x * nextScale,
        y: -node.y * nextScale,
      }

      if (typeof window === 'undefined') {
        setViewport(nextViewport)
      } else {
        if (viewportAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(viewportAnimationFrameRef.current)
          viewportAnimationFrameRef.current = null
        }

        const startViewport = viewportRef.current
        const animationStart = window.performance.now()
        const tick = (timestamp: number) => {
          const elapsed = timestamp - animationStart
          const progress = clamp(elapsed / GRAPH_VIEW_FOCUS_ANIMATION_DURATION_MS, 0, 1)
          const easedProgress = easeInOutCubic(progress)
          setViewport({
            scale: startViewport.scale + (nextViewport.scale - startViewport.scale) * easedProgress,
            x: startViewport.x + (nextViewport.x - startViewport.x) * easedProgress,
            y: startViewport.y + (nextViewport.y - startViewport.y) * easedProgress,
          })

          if (progress < 1) {
            viewportAnimationFrameRef.current = window.requestAnimationFrame(tick)
            return
          }

          viewportAnimationFrameRef.current = null
        }

        viewportAnimationFrameRef.current = window.requestAnimationFrame(tick)
      }

      setSelectedPath(filePath)
      setHoveredSearchResultPath(filePath)
    },
    [positionedNodesByPath, viewport.scale],
  )

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && viewportAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportAnimationFrameRef.current)
      }
    }
  }, [])

  const handleNodeSizeSliderChange = (value: string) => {
    const parsedValue = Number.parseFloat(value)
    if (Number.isNaN(parsedValue)) {
      return
    }
    setNodeSizeMultiplier(clamp(parsedValue, SLIDER_MIN_NODE_SIZE_MULTIPLIER, SLIDER_MAX_NODE_SIZE_MULTIPLIER))
  }

  const handleNodeSizeNumberChange = (value: string) => {
    const parsedValue = Number.parseFloat(value)
    if (Number.isNaN(parsedValue)) {
      return
    }
    setNodeSizeMultiplier(clamp(parsedValue, INPUT_MIN_NODE_SIZE_MULTIPLIER, INPUT_MAX_NODE_SIZE_MULTIPLIER))
  }

  const handleNodeMouseDown = (event: MouseEvent<SVGGElement>, filePath: string) => {
    if (event.button !== 0) {
      return
    }

    event.stopPropagation()
    const node = positionedNodesByPath.get(filePath)
    if (!node) {
      return
    }

    const graphCoordinates = resolveGraphCoordinatesFromClientPoint(event.clientX, event.clientY)
    if (!graphCoordinates) {
      return
    }

    dragMovedRef.current = false
    nodeDragRef.current = {
      path: filePath,
      targetX: node.x,
      targetY: node.y,
      velocityX: 0,
      velocityY: 0,
      pointerOffsetX: node.x - graphCoordinates.x,
      pointerOffsetY: node.y - graphCoordinates.y,
    }
    setDraggedPath(filePath)
    setIsDragging(true)
  }

  const handleNodeClick = (filePath: string) => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false
      return
    }

    setSelectedPath((current) => (current === filePath ? null : filePath))
  }

  const handleNodeDoubleClick = (filePath: string) => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false
      return
    }

    onOpenFile(filePath)
  }

  const handleSearchResultsMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const resultsElement = searchResultsRef.current
    if (!resultsElement) {
      return
    }

    searchScrollSessionRef.current = {
      startClientY: event.clientY,
      startScrollTop: resultsElement.scrollTop,
      moved: false,
    }
    event.stopPropagation()
  }

  const handleSearchResultsMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const resultsElement = searchResultsRef.current
    const session = searchScrollSessionRef.current
    if (!resultsElement || !session) {
      return
    }

    const deltaY = event.clientY - session.startClientY
    if (Math.abs(deltaY) > 2) {
      session.moved = true
    }

    if (session.moved) {
      resultsElement.scrollTop = session.startScrollTop - deltaY
      event.preventDefault()
    }
    event.stopPropagation()
  }

  const handleSearchResultsMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    window.setTimeout(() => {
      searchScrollSessionRef.current = null
    }, 0)
  }

  const handleSearchResultsWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  const handleSearchResultsClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!searchScrollSessionRef.current?.moved) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    searchScrollSessionRef.current = null
  }

  const hasNodes = graphLayout.nodes.length > 0
  const shouldShowLoadingScreen = isLoading && !hasNodes

  return (
    <main className="notia-main">
      <header className="notia-main-header">
        <div className="notia-main-title-group">
          <h2>Graph view</h2>
          <span>{libraryName}</span>
        </div>
        <div className="notia-graph-meta">
          <span>{graphLayout.nodes.length} archivos</span>
          <span>{graphLayout.edges.length} enlaces</span>
          <NotiaButton type="button" variant="secondary" className="notia-graph-reset" onClick={handleResetViewport}>
            Reset view
          </NotiaButton>
        </div>
      </header>
      <section className="notia-main-content notia-graph-content">
        {shouldShowLoadingScreen ? (
          <div className="notia-graph-loading-screen" role="status" aria-live="polite">
            <div className="notia-graph-loading-card">
              <div className="notia-graph-loading-spinner" aria-hidden="true" />
              <strong>Cargando graph view</strong>
              <span>Preparando nodos y enlaces de la libreria actual...</span>
            </div>
          </div>
        ) : null}
        {!isLoading && !hasNodes ? <div className="notia-graph-empty">No hay archivos para mostrar.</div> : null}
        {(hasNodes || isLoading) ? (
          <div
            ref={canvasRef}
            className={`notia-graph-canvas ${isDragging ? 'notia-graph-canvas--dragging' : ''}`}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseLeave}
            onWheel={handleCanvasWheel}
            onClick={handleCanvasClick}
          >
            <div
              className="notia-graph-controls"
              onMouseDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              <NotiaButton
                ref={controlsButtonRef}
                size="icon"
                variant="ghost"
                className="notia-graph-controls-button"
                title="Configurar grafo"
                onClick={() => {
                  setIsControlsOpen((current) => !current)
                }}
              >
                <SlidersHorizontal size={14} />
              </NotiaButton>
              {isControlsOpen ? (
                <div ref={controlsPanelRef} className="notia-graph-controls-panel">
                  <div className="notia-graph-controls-header">
                    <span>Configuracion</span>
                    <NotiaButton
                      size="icon"
                      variant="ghost"
                      className="notia-graph-controls-close"
                      onClick={() => {
                        setIsControlsOpen(false)
                      }}
                    >
                      <X size={13} />
                    </NotiaButton>
                  </div>
                  <div className="notia-graph-control-value">
                    <span>Zoom actual</span>
                    <strong>{formatZoomValue(viewport.scale)}</strong>
                  </div>
                  <div className="notia-graph-control-value">
                    <span>Links</span>
                    <strong>Longitud fija</strong>
                  </div>
                  <div className="notia-graph-control-value">
                    <span>Fisica</span>
                    <strong>No colision</strong>
                  </div>
                  <label className="notia-graph-control-label">Tamano de nodos</label>
                  <div className="notia-graph-control-inputs">
                    <input
                      type="range"
                      min={SLIDER_MIN_NODE_SIZE_MULTIPLIER}
                      max={SLIDER_MAX_NODE_SIZE_MULTIPLIER}
                      step={0.05}
                      value={clamp(nodeSizeMultiplier, SLIDER_MIN_NODE_SIZE_MULTIPLIER, SLIDER_MAX_NODE_SIZE_MULTIPLIER)}
                      onChange={(event) => handleNodeSizeSliderChange(event.target.value)}
                    />
                    <input
                      type="number"
                      min={INPUT_MIN_NODE_SIZE_MULTIPLIER}
                      max={INPUT_MAX_NODE_SIZE_MULTIPLIER}
                      step={0.05}
                      value={nodeSizeMultiplier}
                      onChange={(event) => handleNodeSizeNumberChange(event.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <svg className="notia-graph-svg" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}>
              <g
                transform={`translate(${canvasSize.width / 2 + viewport.x} ${
                  canvasSize.height / 2 + viewport.y
                }) scale(${viewport.scale})`}
              >
                {visibleEdges.map((edge) => {
                  const sourceNode = positionedNodesByPath.get(edge.sourcePath)
                  const targetNode = positionedNodesByPath.get(edge.targetPath)
                  if (!sourceNode || !targetNode) {
                    return null
                  }
                  const edgeEndpoints = buildEdgeBorderEndpoints(sourceNode, targetNode)
                  if (!edgeEndpoints) {
                    return null
                  }

                  const isConnectedToFocus =
                    highlightedPaths === null ||
                    (highlightedPaths.has(sourceNode.path) && highlightedPaths.has(targetNode.path))
                  const isConnectedToSelection =
                    linkedToSelectedPath !== null &&
                    linkedToSelectedPath.has(sourceNode.path) &&
                    linkedToSelectedPath.has(targetNode.path)

                  return (
                    <g key={edge.id}>
                      <line
                        className={`notia-graph-edge-halo notia-graph-edge-halo--outer ${
                          isConnectedToFocus ? '' : 'notia-graph-edge--dim'
                        } ${isConnectedToSelection ? 'notia-graph-edge--selected' : ''}`}
                        x1={edgeEndpoints.x1}
                        y1={edgeEndpoints.y1}
                        x2={edgeEndpoints.x2}
                        y2={edgeEndpoints.y2}
                      />
                      <line
                        className={`notia-graph-edge-halo notia-graph-edge-halo--inner ${
                          isConnectedToFocus ? '' : 'notia-graph-edge--dim'
                        } ${isConnectedToSelection ? 'notia-graph-edge--selected' : ''}`}
                        x1={edgeEndpoints.x1}
                        y1={edgeEndpoints.y1}
                        x2={edgeEndpoints.x2}
                        y2={edgeEndpoints.y2}
                      />
                      <line
                        className={`notia-graph-edge ${isConnectedToFocus ? '' : 'notia-graph-edge--dim'} ${
                          isConnectedToSelection ? 'notia-graph-edge--selected' : ''
                        }`}
                        stroke={edge.color}
                        x1={edgeEndpoints.x1}
                        y1={edgeEndpoints.y1}
                        x2={edgeEndpoints.x2}
                        y2={edgeEndpoints.y2}
                      />
                    </g>
                  )
                })}
                {renderedNodes.map((node) => {
                  const isConnectedToFocus = highlightedPaths?.has(node.path) ?? true
                  const isSelected = selectedPathInLayout === node.path
                  const isLinkedToHover = linkedToHoveredPath?.has(node.path) ?? false
                  const isLinkedToSelected = linkedToSelectedPath?.has(node.path) ?? false
                  const isDragged = draggedPath === node.path
                  const isSearchMatch = searchMatchedPaths.has(node.path)
                  const isSearchPreview = hoveredSearchResultPath === node.path
                  const nodeGlowClass = resolveNodeGlowClass(node.degree)
                  const showLabel =
                    isSearchMatch ||
                    isSearchPreview ||
                    viewport.scale >= LABEL_VISIBILITY_ZOOM ||
                    isLinkedToSelected ||
                    isLinkedToHover

                  return (
                    <g
                      key={node.id}
                      className={`notia-graph-node ${isConnectedToFocus ? '' : 'notia-graph-node--dim'} ${
                        hoveredPath === node.path ? 'notia-graph-node--hovered' : ''
                      } ${isLinkedToSelected ? 'notia-graph-node--linked' : ''} ${
                        isSelected ? 'notia-graph-node--selected' : ''
                      } ${isDragged ? 'notia-graph-node--dragged' : ''} ${
                        isSearchMatch ? 'notia-graph-node--search-match' : ''
                      } ${isSearchPreview ? 'notia-graph-node--search-preview' : ''} ${
                        isSearchPreview ? 'notia-graph-node--title-emphasis' : ''
                      } ${nodeGlowClass}`}
                      onMouseDown={(event) => {
                        handleNodeMouseDown(event, node.path)
                      }}
                      transform={`translate(${node.x} ${node.y})`}
                      onMouseEnter={() => setHoveredPath(node.path)}
                      onMouseLeave={() => setHoveredPath((current) => (current === node.path ? null : current))}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleNodeClick(node.path)
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation()
                        handleNodeDoubleClick(node.path)
                      }}
                    >
                      <circle className="notia-graph-node-halo notia-graph-node-halo--outer" r={node.radius * 2.5} />
                      <circle className="notia-graph-node-halo notia-graph-node-halo--inner" r={node.radius * 1.7} />
                      <circle r={node.radius} fill={node.color} fillOpacity={0.26} stroke={node.color} strokeOpacity={0.94} />
                      {showLabel ? (
                        <text className={isSearchPreview ? 'notia-graph-node-title--search-preview' : ''} x={node.radius + 6} y={4}>
                          {node.label}
                        </text>
                      ) : null}
                    </g>
                  )
                })}
              </g>
            </svg>
            <div
              className="notia-graph-search-shell"
              onMouseDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              {searchQuery.trim() ? (
                <button
                  type="button"
                  className="notia-graph-search-clear"
                  title="Limpiar busqueda"
                  aria-label="Limpiar busqueda"
                  onClick={() => {
                    setSearchQuery('')
                    setHoveredSearchResultPath(null)
                  }}
                >
                  <X size={14} />
                </button>
              ) : null}
              {searchResults.length > 0 ? (
                <div
                  ref={searchResultsRef}
                  className="notia-graph-search-results"
                  role="listbox"
                  aria-label="Resultados de busqueda del grafo"
                  onMouseDown={handleSearchResultsMouseDown}
                  onMouseMove={handleSearchResultsMouseMove}
                  onMouseUp={handleSearchResultsMouseUp}
                  onMouseLeave={handleSearchResultsMouseUp}
                  onWheel={handleSearchResultsWheel}
                  onClickCapture={handleSearchResultsClickCapture}
                >
                  {searchResults.map((result) => (
                    <div
                      key={result.path}
                      className="notia-graph-search-result"
                      onMouseEnter={() => {
                        setHoveredSearchResultPath(result.path)
                      }}
                      onMouseLeave={() => {
                        setHoveredSearchResultPath((current) => (current === result.path ? null : current))
                      }}
                    >
                      <button
                        type="button"
                        className="notia-graph-search-result-main"
                        onClick={() => onOpenFile(result.path)}
                      >
                        <strong>{result.label}</strong>
                        <span>{result.preview}</span>
                      </button>
                      <button
                        type="button"
                        className="notia-graph-search-result-focus"
                        title="Centrar nodo en el grafo"
                        aria-label={`Centrar ${result.label} en el grafo`}
                        onClick={(event) => {
                          event.stopPropagation()
                          focusNodeInViewport(result.path)
                        }}
                      >
                        <Eye size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <label className="notia-graph-search-bar" aria-label="Buscar en graph view">
                <Search size={15} aria-hidden="true" />
                <input
                  type="text"
                  value={searchQuery}
                  placeholder="Buscar por titulo o contenido..."
                  onChange={(event) => {
                    setSearchQuery(event.target.value)
                  }}
                />
              </label>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}
