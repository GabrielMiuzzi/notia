import type { LibraryGraphEdge, LibraryGraphModel, LibraryGraphNode } from '../../types/graph/libraryGraph'

const GOLDEN_ANGLE_RADIANS = Math.PI * (3 - Math.sqrt(5))
const CLUSTER_HUE_PALETTE = [222, 196, 252, 46, 22, 154, 296, 114]

interface ForcePoint {
  x: number
  y: number
  vx: number
  vy: number
}

interface ComponentLayout {
  nodeIndexes: number[]
  pointsByIndex: Map<number, ForcePoint>
  radius: number
}

export interface PositionedGraphNode extends LibraryGraphNode {
  x: number
  y: number
  radius: number
  clusterIndex: number
  color: string
}

export interface PositionedGraphEdge extends LibraryGraphEdge {
  clusterIndex: number
  color: string
}

export interface ClusteredGraphLayout {
  nodes: PositionedGraphNode[]
  edges: PositionedGraphEdge[]
}

export interface ClusteredGraphLayoutOptions {
  spacingMultiplier?: number
  linkedSpacingMultiplier?: number
  componentSpacingMultiplier?: number
  componentSpacingScaleMultiplier?: number
  freeNodeSpacing?: number
  freeNodeSpacingMultiplier?: number
  nodeSizeMultiplier?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createSeededRandom(seedValue: number): () => number {
  let seed = seedValue || 1
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function createAdjacencyList(nodeCount: number, edges: LibraryGraphEdge[], pathToIndex: Map<string, number>): number[][] {
  const adjacencyList = Array.from({ length: nodeCount }, () => [] as number[])
  for (const edge of edges) {
    const sourceIndex = pathToIndex.get(edge.sourcePath)
    const targetIndex = pathToIndex.get(edge.targetPath)
    if (sourceIndex === undefined || targetIndex === undefined || sourceIndex === targetIndex) {
      continue
    }

    adjacencyList[sourceIndex].push(targetIndex)
    adjacencyList[targetIndex].push(sourceIndex)
  }

  return adjacencyList
}

function buildConnectedComponents(adjacencyList: number[][]): number[][] {
  const visited = new Array(adjacencyList.length).fill(false)
  const components: number[][] = []

  for (let index = 0; index < adjacencyList.length; index += 1) {
    if (visited[index]) {
      continue
    }

    const stack = [index]
    const componentNodes: number[] = []
    visited[index] = true

    while (stack.length > 0) {
      const current = stack.pop()!
      componentNodes.push(current)

      for (const neighbor of adjacencyList[current]) {
        if (visited[neighbor]) {
          continue
        }
        visited[neighbor] = true
        stack.push(neighbor)
      }
    }

    components.push(componentNodes)
  }

  components.sort((left, right) => right.length - left.length)
  return components
}

function createComponentEdgePairs(componentNodes: number[], edges: LibraryGraphEdge[], pathToIndex: Map<string, number>) {
  const componentIndexSet = new Set(componentNodes)
  const pairs: Array<[number, number]> = []

  for (const edge of edges) {
    const sourceIndex = pathToIndex.get(edge.sourcePath)
    const targetIndex = pathToIndex.get(edge.targetPath)
    if (sourceIndex === undefined || targetIndex === undefined || sourceIndex === targetIndex) {
      continue
    }

    if (!componentIndexSet.has(sourceIndex) || !componentIndexSet.has(targetIndex)) {
      continue
    }

    pairs.push([sourceIndex, targetIndex])
  }

  return pairs
}

function layoutComponentWithForces(
  graphNodes: LibraryGraphNode[],
  componentNodes: number[],
  componentEdges: Array<[number, number]>,
  seedValue: number,
  spacingMultiplier: number,
): ComponentLayout {
  const random = createSeededRandom(seedValue)
  const nodeCount = componentNodes.length
  const pointsByIndex = new Map<number, ForcePoint>()
  const labelPaddingByNodeIndex = new Map<number, number>()

  if (nodeCount === 1) {
    pointsByIndex.set(componentNodes[0], { x: 0, y: 0, vx: 0, vy: 0 })
    return {
      nodeIndexes: componentNodes,
      pointsByIndex,
      radius: 34,
    }
  }

  const baseRadius = Math.max(48, Math.sqrt(nodeCount) * 48) * spacingMultiplier
  for (let localIndex = 0; localIndex < nodeCount; localIndex += 1) {
    const nodeIndex = componentNodes[localIndex]
    const labelLength = graphNodes[nodeIndex]?.label.length ?? 0
    const labelPadding = clamp(9 + labelLength * 0.9, 9, 94)
    labelPaddingByNodeIndex.set(nodeIndex, labelPadding)
    const angle = (localIndex / nodeCount) * Math.PI * 2 + random() * 0.9
    const radius = baseRadius * (0.68 + random() * 0.46)
    pointsByIndex.set(nodeIndex, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    })
  }

  const repulsionStrength = clamp(9600 + nodeCount * 44, 9600, 76000) * spacingMultiplier * spacingMultiplier
  const springStrength = clamp(0.018 + nodeCount * 0.00007, 0.018, 0.034)
  const gravityStrength = 0.0012
  const idealEdgeLength = clamp(104 + Math.sqrt(nodeCount) * 5.2, 104, 196) * spacingMultiplier
  const collisionDistance = 22 * spacingMultiplier
  const collisionStrength = 0.28
  const iterations = clamp(340 + nodeCount * 5, 340, 680)
  const damping = 0.84
  const timeStep = 0.66

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const forcesByIndex = new Map<number, { fx: number; fy: number }>()
    for (const nodeIndex of componentNodes) {
      forcesByIndex.set(nodeIndex, { fx: 0, fy: 0 })
    }

    for (let leftIndex = 0; leftIndex < componentNodes.length; leftIndex += 1) {
      const sourceNodeIndex = componentNodes[leftIndex]
      const sourcePoint = pointsByIndex.get(sourceNodeIndex)!
      for (let rightIndex = leftIndex + 1; rightIndex < componentNodes.length; rightIndex += 1) {
        const targetNodeIndex = componentNodes[rightIndex]
        const targetPoint = pointsByIndex.get(targetNodeIndex)!
        const sourceLabelPadding = labelPaddingByNodeIndex.get(sourceNodeIndex) ?? 12
        const targetLabelPadding = labelPaddingByNodeIndex.get(targetNodeIndex) ?? 12

        let dx = sourcePoint.x - targetPoint.x
        let dy = sourcePoint.y - targetPoint.y
        let distanceSquared = dx * dx + dy * dy
        if (distanceSquared < 0.2) {
          const nudge = (random() - 0.5) * 0.2
          dx += nudge
          dy += nudge
          distanceSquared = dx * dx + dy * dy + 0.2
        }

        const distance = Math.sqrt(distanceSquared)
        const force = repulsionStrength / distanceSquared
        let fx = (dx / distance) * force
        let fy = (dy / distance) * force

        const minSeparation = collisionDistance + (sourceLabelPadding + targetLabelPadding) * 0.38
        if (distance < minSeparation) {
          const collisionForce = (minSeparation - distance) * collisionStrength
          fx += (dx / distance) * collisionForce
          fy += (dy / distance) * collisionForce
        }

        const sourceForces = forcesByIndex.get(sourceNodeIndex)!
        sourceForces.fx += fx
        sourceForces.fy += fy
        const targetForces = forcesByIndex.get(targetNodeIndex)!
        targetForces.fx -= fx
        targetForces.fy -= fy
      }
    }

    for (const [sourceNodeIndex, targetNodeIndex] of componentEdges) {
      const sourcePoint = pointsByIndex.get(sourceNodeIndex)
      const targetPoint = pointsByIndex.get(targetNodeIndex)
      if (!sourcePoint || !targetPoint) {
        continue
      }

      let dx = targetPoint.x - sourcePoint.x
      let dy = targetPoint.y - sourcePoint.y
      let distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < 0.4) {
        distance = 0.4
        dx = 0.2
        dy = 0.2
      }

      const springForce = (distance - idealEdgeLength) * springStrength
      const fx = (dx / distance) * springForce
      const fy = (dy / distance) * springForce

      const sourceForces = forcesByIndex.get(sourceNodeIndex)!
      sourceForces.fx += fx
      sourceForces.fy += fy
      const targetForces = forcesByIndex.get(targetNodeIndex)!
      targetForces.fx -= fx
      targetForces.fy -= fy
    }

    for (const nodeIndex of componentNodes) {
      const point = pointsByIndex.get(nodeIndex)!
      const forces = forcesByIndex.get(nodeIndex)!
      const gravityFx = -point.x * gravityStrength
      const gravityFy = -point.y * gravityStrength

      point.vx = (point.vx + (forces.fx + gravityFx) * timeStep) * damping
      point.vy = (point.vy + (forces.fy + gravityFy) * timeStep) * damping
      point.x += point.vx * timeStep
      point.y += point.vy * timeStep
    }
  }

  let componentRadius = 30
  for (const nodeIndex of componentNodes) {
    const point = pointsByIndex.get(nodeIndex)!
    const labelPadding = labelPaddingByNodeIndex.get(nodeIndex) ?? 12
    componentRadius = Math.max(
      componentRadius,
      Math.sqrt(point.x * point.x + point.y * point.y) + 48 * spacingMultiplier + labelPadding * 0.42,
    )
  }

  return {
    nodeIndexes: componentNodes,
    pointsByIndex,
    radius: componentRadius,
  }
}

function getClusterColor(clusterIndex: number): string {
  const paletteHue = CLUSTER_HUE_PALETTE[clusterIndex % CLUSTER_HUE_PALETTE.length]
  const hueOffset = Math.floor(clusterIndex / CLUSTER_HUE_PALETTE.length) * 13
  const hue = (paletteHue + hueOffset) % 360
  return `hsl(${hue} 78% 68%)`
}

function placeComponentCenters(
  componentLayouts: ComponentLayout[],
  componentSpacingMultiplier: number,
): Array<{ x: number; y: number }> {
  if (componentLayouts.length === 0) {
    return []
  }

  const componentPadding = clamp(componentSpacingMultiplier * 18, -5000, 5000)
  const centers: Array<{ x: number; y: number; radius: number }> = []
  for (let layoutIndex = 0; layoutIndex < componentLayouts.length; layoutIndex += 1) {
    const layout = componentLayouts[layoutIndex]
    if (layoutIndex === 0) {
      centers.push({ x: 0, y: 0, radius: layout.radius })
      continue
    }

    const angle = layoutIndex * GOLDEN_ANGLE_RADIANS
    const initialDistance = Math.sqrt(layoutIndex + 1) * Math.max(8, 34 + componentPadding * 0.82)
    const center = {
      x: Math.cos(angle) * initialDistance,
      y: Math.sin(angle) * initialDistance,
      radius: layout.radius,
    }
    centers.push(center)
  }

  // Compact all connected components near the center while preserving non-overlap.
  for (let iteration = 0; iteration < 260; iteration += 1) {
    for (let centerIndex = 1; centerIndex < centers.length; centerIndex += 1) {
      centers[centerIndex].x *= 0.992
      centers[centerIndex].y *= 0.992
    }

    let hadOverlap = false
    for (let leftIndex = 0; leftIndex < centers.length; leftIndex += 1) {
      const leftCenter = centers[leftIndex]
      for (let rightIndex = leftIndex + 1; rightIndex < centers.length; rightIndex += 1) {
        const rightCenter = centers[rightIndex]
        const baseDistance = leftCenter.radius + rightCenter.radius
        const minDistance = Math.max(baseDistance * 0.28, baseDistance + componentPadding)
        let dx = rightCenter.x - leftCenter.x
        let dy = rightCenter.y - leftCenter.y
        let distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < 0.001) {
          const nudgeAngle = (leftIndex + rightIndex + iteration + 1) * GOLDEN_ANGLE_RADIANS
          dx = Math.cos(nudgeAngle)
          dy = Math.sin(nudgeAngle)
          distance = 1
        }

        if (distance >= minDistance) {
          continue
        }

        hadOverlap = true
        const overlap = minDistance - distance
        const adjustmentX = (dx / distance) * (overlap * 0.5)
        const adjustmentY = (dy / distance) * (overlap * 0.5)
        leftCenter.x -= adjustmentX
        leftCenter.y -= adjustmentY
        rightCenter.x += adjustmentX
        rightCenter.y += adjustmentY
      }
    }

    if (!hadOverlap && iteration > 40) {
      break
    }
  }

  return centers.map(({ x, y }) => ({ x, y }))
}

function placeFreeNodeComponentCenters(
  componentLayouts: ComponentLayout[],
  groupedComponentIndexes: number[],
  groupedCenters: Array<{ x: number; y: number }>,
  freeComponentIndexes: number[],
  freeNodeSpacing: number,
): Array<{ x: number; y: number }> {
  if (freeComponentIndexes.length === 0) {
    return []
  }

  const freeSeparation = clamp(freeNodeSpacing, -1000, 1000)
  const groupedObstacles: Array<{ x: number; y: number; radius: number }> = []
  let groupedOuterRadius = 0

  for (let index = 0; index < groupedComponentIndexes.length; index += 1) {
    const groupedComponentIndex = groupedComponentIndexes[index]
    const groupedLayout = componentLayouts[groupedComponentIndex]
    const groupedCenter = groupedCenters[index]
    if (!groupedLayout || !groupedCenter) {
      continue
    }

    groupedObstacles.push({
      x: groupedCenter.x,
      y: groupedCenter.y,
      radius: groupedLayout.radius,
    })
    groupedOuterRadius = Math.max(
      groupedOuterRadius,
      Math.sqrt(groupedCenter.x * groupedCenter.x + groupedCenter.y * groupedCenter.y) + groupedLayout.radius,
    )
  }

  const hasGroupedObstacles = groupedObstacles.length > 0
  const groupedBoundaryPadding = clamp(2 + freeSeparation * 1.2, -180, 240)
  const minOuterRadius = hasGroupedObstacles ? Math.max(0, groupedOuterRadius + groupedBoundaryPadding) : 0
  const freeNodePadding = clamp(1 + freeSeparation * 0.42, -140, 180)
  const obstaclePadding = clamp(4 + freeSeparation * 0.52, -140, 180)
  const ringStep = clamp(4 + freeSeparation * 0.48, 1.5, 96)

  const centers = freeComponentIndexes.map((componentIndex, freeIndex) => {
    const componentRadius = componentLayouts[componentIndex]?.radius ?? 34
    const angle = freeIndex * GOLDEN_ANGLE_RADIANS
    const layerIndex = Math.floor(freeIndex / 10)
    const staggerOffset = (freeIndex % 3) * ringStep * 0.28
    const radialDistance = minOuterRadius + ringStep + layerIndex * ringStep + staggerOffset
    return {
      x: Math.cos(angle) * radialDistance,
      y: Math.sin(angle) * radialDistance,
      radius: componentRadius,
    }
  })

  for (let iteration = 0; iteration < 320; iteration += 1) {
    for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
      centers[centerIndex].x *= 0.985
      centers[centerIndex].y *= 0.985
    }

    let hadOverlap = false

    for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
      const center = centers[centerIndex]

      if (hasGroupedObstacles) {
        let radialDistance = Math.sqrt(center.x * center.x + center.y * center.y)
        if (radialDistance < 0.001) {
          const nudgeAngle = (centerIndex + iteration + 1) * GOLDEN_ANGLE_RADIANS
          center.x = Math.cos(nudgeAngle)
          center.y = Math.sin(nudgeAngle)
          radialDistance = 1
        }

        if (radialDistance < minOuterRadius) {
          const scale = minOuterRadius / radialDistance
          center.x *= scale
          center.y *= scale
        }
      }

      for (const obstacle of groupedObstacles) {
        let dx = center.x - obstacle.x
        let dy = center.y - obstacle.y
        let distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < 0.001) {
          const nudgeAngle = (centerIndex + iteration + 1) * GOLDEN_ANGLE_RADIANS
          dx = Math.cos(nudgeAngle)
          dy = Math.sin(nudgeAngle)
          distance = 1
        }

        const minDistance = obstacle.radius + center.radius + obstaclePadding
        if (distance >= minDistance) {
          continue
        }

        hadOverlap = true
        const overlap = minDistance - distance
        center.x += (dx / distance) * overlap
        center.y += (dy / distance) * overlap
      }
    }

    for (let leftIndex = 0; leftIndex < centers.length; leftIndex += 1) {
      const leftCenter = centers[leftIndex]
      for (let rightIndex = leftIndex + 1; rightIndex < centers.length; rightIndex += 1) {
        const rightCenter = centers[rightIndex]
        let dx = rightCenter.x - leftCenter.x
        let dy = rightCenter.y - leftCenter.y
        let distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < 0.001) {
          const nudgeAngle = (leftIndex + rightIndex + iteration + 1) * GOLDEN_ANGLE_RADIANS
          dx = Math.cos(nudgeAngle)
          dy = Math.sin(nudgeAngle)
          distance = 1
        }

        const minDistance = leftCenter.radius + rightCenter.radius + freeNodePadding
        if (distance >= minDistance) {
          continue
        }

        hadOverlap = true
        const overlap = minDistance - distance
        const adjustmentX = (dx / distance) * (overlap * 0.5)
        const adjustmentY = (dy / distance) * (overlap * 0.5)
        leftCenter.x -= adjustmentX
        leftCenter.y -= adjustmentY
        rightCenter.x += adjustmentX
        rightCenter.y += adjustmentY
      }
    }

    if (!hadOverlap && iteration > 48) {
      break
    }
  }

  return centers.map(({ x, y }) => ({ x, y }))
}

function normalizeLayoutScale(
  nodes: PositionedGraphNode[],
  canvasWidth: number,
  canvasHeight: number,
  nodeSizeMultiplier: number,
): PositionedGraphNode[] {
  if (nodes.length === 0) {
    return nodes
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    maxX = Math.max(maxX, node.x)
    minY = Math.min(minY, node.y)
    maxY = Math.max(maxY, node.y)
  }

  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  const targetWidth = Math.max(canvasWidth, 760) * 0.95
  const targetHeight = Math.max(canvasHeight, 520) * 0.95
  const fitScale = Math.min(targetWidth / width, targetHeight / height)
  const scale = clamp(Number.isFinite(fitScale) ? fitScale : 1, 0.08, 2.25)

  return nodes.map((node) => ({
    ...node,
    x: (node.x - centerX) * scale,
    y: (node.y - centerY) * scale,
    radius: clamp(node.radius * nodeSizeMultiplier, 3.8, 34),
  }))
}

export function buildClusteredGraphLayout(
  graphModel: LibraryGraphModel,
  canvasWidth: number,
  canvasHeight: number,
  options?: ClusteredGraphLayoutOptions,
): ClusteredGraphLayout {
  if (graphModel.nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
    }
  }

  const spacingMultiplier = clamp(options?.spacingMultiplier ?? 1, 0.1, 100000)
  const linkedSpacingMultiplier = clamp(options?.linkedSpacingMultiplier ?? 1, 0.01, 1000)
  const componentSpacingMultiplier = clamp(options?.componentSpacingMultiplier ?? 1, -1000, 1000)
  const componentSpacingScaleMultiplier = clamp(options?.componentSpacingScaleMultiplier ?? 1, 0, 1000)
  const freeNodeSpacing = clamp(options?.freeNodeSpacing ?? 1, -1000, 1000)
  const freeNodeSpacingMultiplier = clamp(options?.freeNodeSpacingMultiplier ?? 1, 0, 1000)
  const nodeSizeMultiplier = clamp(options?.nodeSizeMultiplier ?? 1, 0.1, 12)
  const effectiveLinkedSpacing = clamp(spacingMultiplier * linkedSpacingMultiplier, 0.1, 1000000)
  const effectiveComponentSpacing = clamp(
    componentSpacingMultiplier * componentSpacingScaleMultiplier,
    -1000,
    1000,
  )
  const effectiveFreeNodeSpacing = clamp(freeNodeSpacing * freeNodeSpacingMultiplier, -1000, 1000)
  const linkedSpacingScale = Math.sqrt(effectiveLinkedSpacing)

  const pathToIndex = new Map<string, number>()
  graphModel.nodes.forEach((node, index) => {
    pathToIndex.set(node.path, index)
  })

  const adjacencyList = createAdjacencyList(graphModel.nodes.length, graphModel.edges, pathToIndex)
  const components = buildConnectedComponents(adjacencyList)
  const componentLayouts: ComponentLayout[] = []

  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    const componentNodes = components[componentIndex]
    const componentEdges = createComponentEdgePairs(componentNodes, graphModel.edges, pathToIndex)
    const seedInput = componentNodes.map((nodeIndex) => graphModel.nodes[nodeIndex].path).join('|')
    const seedValue = hashString(seedInput)
    const componentLayout = layoutComponentWithForces(
      graphModel.nodes,
      componentNodes,
      componentEdges,
      seedValue,
      linkedSpacingScale,
    )

    componentLayouts.push(componentLayout)
  }

  const groupedComponentIndexes: number[] = []
  const freeComponentIndexes: number[] = []
  for (let componentIndex = 0; componentIndex < componentLayouts.length; componentIndex += 1) {
    const layout = componentLayouts[componentIndex]
    if (layout.nodeIndexes.length === 1) {
      freeComponentIndexes.push(componentIndex)
      continue
    }

    groupedComponentIndexes.push(componentIndex)
  }

  const groupedComponentLayouts = groupedComponentIndexes.map((componentIndex) => componentLayouts[componentIndex])
  const groupedComponentCenters = placeComponentCenters(groupedComponentLayouts, effectiveComponentSpacing)
  const freeComponentCenters = placeFreeNodeComponentCenters(
    componentLayouts,
    groupedComponentIndexes,
    groupedComponentCenters,
    freeComponentIndexes,
    effectiveFreeNodeSpacing,
  )
  const componentCenters: Array<{ x: number; y: number }> = Array.from({ length: componentLayouts.length }, () => ({
    x: 0,
    y: 0,
  }))
  for (let index = 0; index < groupedComponentIndexes.length; index += 1) {
    const componentIndex = groupedComponentIndexes[index]
    const center = groupedComponentCenters[index]
    if (!center) {
      continue
    }

    componentCenters[componentIndex] = center
  }
  for (let index = 0; index < freeComponentIndexes.length; index += 1) {
    const componentIndex = freeComponentIndexes[index]
    const center = freeComponentCenters[index]
    if (!center) {
      continue
    }

    componentCenters[componentIndex] = center
  }
  const positionedNodes: PositionedGraphNode[] = []

  for (let componentIndex = 0; componentIndex < componentLayouts.length; componentIndex += 1) {
    const componentLayout = componentLayouts[componentIndex]
    const componentCenter = componentCenters[componentIndex] ?? { x: 0, y: 0 }
    const clusterColor = getClusterColor(componentIndex)

    for (const nodeIndex of componentLayout.nodeIndexes) {
      const node = graphModel.nodes[nodeIndex]
      const localPoint = componentLayout.pointsByIndex.get(nodeIndex)
      if (!localPoint) {
        continue
      }

      positionedNodes.push({
        ...node,
        clusterIndex: componentIndex,
        color: clusterColor,
        x: componentCenter.x + localPoint.x,
        y: componentCenter.y + localPoint.y,
        radius: clamp(4.8 + Math.log2(node.degree + 1) * 2, 4.5, 12.5),
      })
    }
  }

  const scaledNodes = normalizeLayoutScale(
    positionedNodes,
    canvasWidth,
    canvasHeight,
    nodeSizeMultiplier,
  )
  const clusterByPath = new Map(scaledNodes.map((node) => [node.path, node.clusterIndex]))
  const colorByCluster = new Map<number, string>()
  for (const node of scaledNodes) {
    if (!colorByCluster.has(node.clusterIndex)) {
      colorByCluster.set(node.clusterIndex, node.color)
    }
  }

  const positionedEdges: PositionedGraphEdge[] = graphModel.edges.map((edge) => {
    const clusterIndex = clusterByPath.get(edge.sourcePath) ?? clusterByPath.get(edge.targetPath) ?? 0
    return {
      ...edge,
      clusterIndex,
      color: colorByCluster.get(clusterIndex) ?? getClusterColor(clusterIndex),
    }
  })

  return {
    nodes: scaledNodes,
    edges: positionedEdges,
  }
}
