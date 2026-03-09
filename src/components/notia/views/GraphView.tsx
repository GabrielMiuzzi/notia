import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
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
const GRAPH_PHYSICS_DAMPING = 0.82
const GRAPH_PHYSICS_MAX_DELTA = 2.2
const GRAPH_PHYSICS_MIN_DELTA = 0.45
const GRAPH_PHYSICS_CONSTRAINT_ITERATIONS = 4
const GRAPH_PHYSICS_RELEASE_TRANSITION_STRENGTH = 0.019
const GRAPH_PHYSICS_DRAG_TRANSITION_STRENGTH = 0.064
const GRAPH_PHYSICS_RELEASE_TRANSITION_EPSILON = 1.2
const GRAPH_PHYSICS_EDGE_CONSTRAINT_SLOP = 0.025
const GRAPH_PHYSICS_EDGE_COMPRESSION_STRENGTH = 0.38
const GRAPH_PHYSICS_EDGE_STRETCH_STRENGTH = 0.055
const GRAPH_PHYSICS_COLLISION_SLOP = 0.025
const GRAPH_PHYSICS_FREE_NODE_ANCHOR_PULL = 0.018
const GRAPH_PHYSICS_VELOCITY_SLEEP_EPSILON = 0.006
const GRAPH_PHYSICS_MOVEMENT_SLEEP_EPSILON = 0.009
const GRAPH_PHYSICS_RELEASE_RING_PADDING = 8
const GRAPH_PHYSICS_RELEASE_RING_MIN_RADIUS = 26
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
  transitionTargetX: number | null
  transitionTargetY: number | null

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
    this.transitionTargetX = null
    this.transitionTargetY = null
  }

  setTransitionTarget(targetX: number, targetY: number) {
    this.transitionTargetX = targetX
    this.transitionTargetY = targetY
  }

  clearTransitionTarget() {
    this.transitionTargetX = null
    this.transitionTargetY = null
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
  libraryName: string
  isLoading: boolean
  onOpenFile: (filePath: string) => void
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

function buildGraphSimulationTopology(
  nodes: readonly GraphSimulationNode[],
  edges: readonly PositionedGraphEdge[],
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
    const distance = Math.max(1, Math.hypot(targetNode.x - sourceNode.x, targetNode.y - sourceNode.y))
    simulationEdges.push({
      sourceIndex,
      targetIndex,
      restLength: distance,
    })
    linkedIndexesByIndex[sourceIndex].push(targetIndex)
    linkedIndexesByIndex[targetIndex].push(sourceIndex)
    restLengthByPairKey.set(buildEdgePairKey(sourceNode.path, targetNode.path), distance)
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
) {
  for (const edge of topology.edges) {
    const sourceNode = nodes[edge.sourceIndex]
    const targetNode = nodes[edge.targetIndex]
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

function applyCollisionConstraints(nodes: GraphSimulationNode[], draggedNodeIndex: number) {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const leftNode = nodes[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const rightNode = nodes[rightIndex]
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
  const dragNeighborhood =
    draggedNodeIndex >= 0
      ? (() => {
          const directIndexes = new Set(topology.linkedIndexesByIndex[draggedNodeIndex] ?? [])
          const secondRingIndexes = new Set<number>()
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
            secondRingIndexes,
          } satisfies GraphDragNeighborhood
        })()
      : null
  const isNodeDragActive = dragSession !== null && draggedNodeIndex >= 0
  if (isNodeDragActive) {
    const draggedNode = nodes[draggedNodeIndex]
    draggedNode.x = dragSession.targetX
    draggedNode.y = dragSession.targetY
    applyHierarchicalCircularTargets(nodes, topology, draggedNodeIndex, false)
  }
  const previousPositions = nodes.map((node) => ({ x: node.x, y: node.y }))
  let hasTransitionTargets = false
  const transitionStrength = isNodeDragActive
    ? GRAPH_PHYSICS_DRAG_TRANSITION_STRENGTH
    : GRAPH_PHYSICS_RELEASE_TRANSITION_STRENGTH

  for (let index = 0; index < nodes.length; index += 1) {
    if (index === draggedNodeIndex) {
      continue
    }

    const node = nodes[index]
    const isFreeNode = (topology.linkedIndexesByIndex[index]?.length ?? 0) === 0
    if (isFreeNode) {
      // Free nodes should preserve manual drops; pull them back to their own anchor.
      node.vx += (node.baseX - node.x) * GRAPH_PHYSICS_FREE_NODE_ANCHOR_PULL * deltaScale
      node.vy += (node.baseY - node.y) * GRAPH_PHYSICS_FREE_NODE_ANCHOR_PULL * deltaScale
    }

    if (node.transitionTargetX !== null && node.transitionTargetY !== null) {
      hasTransitionTargets = true
      const targetDx = node.transitionTargetX - node.x
      const targetDy = node.transitionTargetY - node.y
      node.vx += targetDx * transitionStrength * deltaScale
      node.vy += targetDy * transitionStrength * deltaScale
      if (Math.hypot(targetDx, targetDy) <= GRAPH_PHYSICS_RELEASE_TRANSITION_EPSILON) {
        node.clearTransitionTarget()
      }
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
  }

  for (let iteration = 0; iteration < GRAPH_PHYSICS_CONSTRAINT_ITERATIONS; iteration += 1) {
    applyElasticEdgeConstraints(nodes, topology, draggedNodeIndex, dragNeighborhood)
    applyCollisionConstraints(nodes, draggedNodeIndex)
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
    const previous = previousPositions[index]
    const nextVx = node.x - previous.x
    const nextVy = node.y - previous.y
    node.vx = Math.abs(nextVx) <= GRAPH_PHYSICS_VELOCITY_SLEEP_EPSILON ? 0 : nextVx
    node.vy = Math.abs(nextVy) <= GRAPH_PHYSICS_VELOCITY_SLEEP_EPSILON ? 0 : nextVy
    maxMovement = Math.max(maxMovement, Math.hypot(node.vx, node.vy))
  }

  return maxMovement > GRAPH_PHYSICS_MOVEMENT_SLEEP_EPSILON || dragSession !== null || hasTransitionTargets
}

function computeStableAngleOffset(path: string): number {
  let hash = 2166136261
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const degrees = hash % 360
  return (degrees * Math.PI) / 180
}

function applyCircularTargetsAroundCenter(
  nodes: GraphSimulationNode[],
  topology: GraphSimulationTopology,
  centerIndex: number,
  childIndexes: number[],
  angleSeedPath: string,
  persistAsBase: boolean,
): void {
  if (childIndexes.length === 0) {
    return
  }

  const centerNode = nodes[centerIndex]
  const centerX = centerNode.x
  const centerY = centerNode.y
  const orderedChildIndexes = [...childIndexes].sort((leftIndex, rightIndex) =>
    nodes[leftIndex].path.localeCompare(nodes[rightIndex].path),
  )
  const childCount = orderedChildIndexes.length
  const maxChildDiameter = orderedChildIndexes.reduce(
    (maxDiameter, nodeIndex) =>
      Math.max(maxDiameter, nodes[nodeIndex].radius * 2 + GRAPH_PHYSICS_COLLISION_PADDING * 2),
    0,
  )
  const averageDistance =
    orderedChildIndexes.reduce(
      (distanceSum, nodeIndex) =>
        distanceSum + Math.hypot(nodes[nodeIndex].x - centerX, nodes[nodeIndex].y - centerY),
      0,
    ) / childCount

  const minRadiusByArc = (maxChildDiameter * childCount) / (Math.PI * 2)
  const ringRadius = Math.max(
    GRAPH_PHYSICS_RELEASE_RING_MIN_RADIUS,
    centerNode.radius + maxChildDiameter * 0.55 + GRAPH_PHYSICS_RELEASE_RING_PADDING,
    minRadiusByArc + GRAPH_PHYSICS_RELEASE_RING_PADDING,
    averageDistance * 0.7,
  )
  const angleStep = (Math.PI * 2) / childCount
  const angleOffset = computeStableAngleOffset(angleSeedPath)

  for (let orderIndex = 0; orderIndex < orderedChildIndexes.length; orderIndex += 1) {
    const childIndex = orderedChildIndexes[orderIndex]
    const childNode = nodes[childIndex]
    const angle = angleOffset + orderIndex * angleStep
    const pairKey = buildEdgePairKey(centerNode.path, childNode.path)
    const minDistanceFromCollision =
      centerNode.radius + childNode.radius + GRAPH_PHYSICS_COLLISION_PADDING * 2
    const minDistanceFromLink = topology.restLengthByPairKey.get(pairKey) ?? ringRadius
    const targetDistance = persistAsBase
      ? Math.max(minDistanceFromCollision, minDistanceFromLink)
      : Math.max(minDistanceFromCollision, ringRadius)
    const nextX = centerX + Math.cos(angle) * targetDistance
    const nextY = centerY + Math.sin(angle) * targetDistance
    childNode.setTransitionTarget(nextX, nextY)
    if (persistAsBase) {
      childNode.baseX = nextX
      childNode.baseY = nextY
      childNode.vx *= 0.6
      childNode.vy *= 0.6
    }
  }
}

function applyHierarchicalCircularTargets(
  nodes: GraphSimulationNode[],
  topology: GraphSimulationTopology,
  anchorIndex: number,
  persistAsBase: boolean,
): void {
  const directLinkedIndexes = Array.from(new Set(topology.linkedIndexesByIndex[anchorIndex] ?? []))
  if (directLinkedIndexes.length === 0) {
    return
  }

  const anchorPath = nodes[anchorIndex]?.path
  if (!anchorPath) {
    return
  }

  const primaryLinkedSet = new Set(directLinkedIndexes)
  const reservedIndexes = new Set<number>([anchorIndex, ...directLinkedIndexes])

  applyCircularTargetsAroundCenter(
    nodes,
    topology,
    anchorIndex,
    directLinkedIndexes,
    anchorPath,
    persistAsBase,
  )

  for (const centerIndex of directLinkedIndexes) {
    const secondaryLinkedIndexes = (topology.linkedIndexesByIndex[centerIndex] ?? []).filter(
      (nodeIndex) => nodeIndex !== anchorIndex && !primaryLinkedSet.has(nodeIndex) && !reservedIndexes.has(nodeIndex),
    )
    if (secondaryLinkedIndexes.length === 0) {
      continue
    }

    applyCircularTargetsAroundCenter(
      nodes,
      topology,
      centerIndex,
      secondaryLinkedIndexes,
      nodes[centerIndex].path,
      persistAsBase,
    )
    for (const nodeIndex of secondaryLinkedIndexes) {
      reservedIndexes.add(nodeIndex)
    }
  }
}

function reorganizeLinkedNodesInCircle(
  nodes: readonly GraphSimulationNode[],
  topology: GraphSimulationTopology,
  anchorPath: string,
): GraphSimulationNode[] {
  const anchorIndex = topology.pathToIndex.get(anchorPath)
  if (anchorIndex === undefined) {
    return [...nodes]
  }

  const nextNodes = nodes.map((node) => {
    const clonedNode = new GraphSimulationNode(node)
    clonedNode.baseX = node.baseX
    clonedNode.baseY = node.baseY
    clonedNode.vx = node.vx
    clonedNode.vy = node.vy
    clonedNode.linkedNodes = node.linkedNodes
    clonedNode.transitionTargetX = node.transitionTargetX
    clonedNode.transitionTargetY = node.transitionTargetY
    return clonedNode
  })
  applyHierarchicalCircularTargets(nextNodes, topology, anchorIndex, true)

  return nextNodes
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

export function GraphView({ graphModel, libraryName, isLoading, onOpenFile }: GraphViewProps) {
  const initialSettings = useMemo(() => readGraphViewSettings(), [])
  const graphModelSignature = useMemo(() => buildGraphModelSignature(graphModel), [graphModel])
  const stableGraphModel = useMemo(
    () => getStableGraphModelBySignature(graphModelSignature, graphModel),
    [graphModel, graphModelSignature],
  )
  const canvasRef = useRef<HTMLDivElement>(null)
  const controlsButtonRef = useRef<HTMLButtonElement>(null)
  const controlsPanelRef = useRef<HTMLDivElement>(null)
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
  const simulationLastTimestampRef = useRef<number | null>(null)
  const simulationNeedsSyncRef = useRef(true)
  const dragMovedRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 })
  const [displayedNodes, setDisplayedNodes] = useState<GraphRenderNode[]>([])
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [isControlsOpen, setIsControlsOpen] = useState(false)
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

  const commitDraggedNodePositions = useCallback((anchorPath: string) => {
    const simulationNodes = simulationNodesRef.current
    if (simulationNodes.length === 0) {
      return
    }

    const frozenNodes = simulationNodes.map((node) => {
      const frozenNode = new GraphSimulationNode(node)
      frozenNode.linkedNodes = node.linkedNodes
      frozenNode.baseX = node.x
      frozenNode.baseY = node.y
      frozenNode.vx = 0
      frozenNode.vy = 0
      return frozenNode
    })
    const nextSimulationNodes = reorganizeLinkedNodesInCircle(
      frozenNodes,
      simulationTopologyRef.current,
      anchorPath,
    )

    simulationNodesRef.current = nextSimulationNodes
    simulationTopologyRef.current = buildGraphSimulationTopology(nextSimulationNodes, graphLayout.edges)
    simulationNeedsSyncRef.current = true
    setDisplayedNodes(nextSimulationNodes.map((node) => node.toRenderNode()))
    persistGraphNodePositionsForLibrary(libraryName, nextSimulationNodes)
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
      commitDraggedNodePositions(releasedNodePath)
    }
    nodeDragRef.current = null
    setDraggedPath(null)
    dragStartRef.current = null
    setIsDragging(false)
  }

  const handleCanvasMouseLeave = () => {
    const releasedNodePath = nodeDragRef.current?.path
    if (releasedNodePath) {
      commitDraggedNodePositions(releasedNodePath)
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
        commitDraggedNodePositions(releasedNodePath)
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

  const hasNodes = graphLayout.nodes.length > 0

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
        {isLoading ? <div className="notia-graph-empty">Construyendo grafo...</div> : null}
        {!isLoading && !hasNodes ? <div className="notia-graph-empty">No hay archivos para mostrar.</div> : null}
        {!isLoading && hasNodes ? (
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
                    <line
                      key={edge.id}
                      className={`notia-graph-edge ${isConnectedToFocus ? '' : 'notia-graph-edge--dim'} ${
                        isConnectedToSelection ? 'notia-graph-edge--selected' : ''
                      }`}
                      stroke={edge.color}
                      x1={edgeEndpoints.x1}
                      y1={edgeEndpoints.y1}
                      x2={edgeEndpoints.x2}
                      y2={edgeEndpoints.y2}
                    />
                  )
                })}
                {renderedNodes.map((node) => {
                  const isConnectedToFocus = highlightedPaths?.has(node.path) ?? true
                  const isSelected = selectedPathInLayout === node.path
                  const isLinkedToHover = linkedToHoveredPath?.has(node.path) ?? false
                  const isLinkedToSelected = linkedToSelectedPath?.has(node.path) ?? false
                  const isDragged = draggedPath === node.path
                  const showLabel = viewport.scale >= LABEL_VISIBILITY_ZOOM || isLinkedToSelected || isLinkedToHover

                  return (
                    <g
                      key={node.id}
                      className={`notia-graph-node ${isConnectedToFocus ? '' : 'notia-graph-node--dim'} ${
                        hoveredPath === node.path ? 'notia-graph-node--hovered' : ''
                      } ${isLinkedToSelected ? 'notia-graph-node--linked' : ''} ${
                        isSelected ? 'notia-graph-node--selected' : ''
                      } ${isDragged ? 'notia-graph-node--dragged' : ''}`}
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
                      <circle r={node.radius} fill={node.color} fillOpacity={0.26} stroke={node.color} strokeOpacity={0.94} />
                      {showLabel ? (
                        <text x={node.radius + 6} y={4}>
                          {node.label}
                        </text>
                      ) : null}
                    </g>
                  )
                })}
              </g>
            </svg>
          </div>
        ) : null}
      </section>
    </main>
  )
}
