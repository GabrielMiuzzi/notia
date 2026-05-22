import { useCallback, useEffect, useRef, useState } from 'react'
import type { MermaidDiagram, MermaidShapeType } from '../types/mermaidTypes'
import { buildDefaultMermaidDiagram, createNode, createEdge, parseMermaidSource, serializeMermaidDiagram } from '../engines/mermaidEngine'

interface UseMermaidEditorParams {
  source: string
  onPersist: (nextSource: string) => void
}

export function useMermaidEditor({ source, onPersist }: UseMermaidEditorParams) {
  const [diagram, setDiagram] = useState<MermaidDiagram>(() => {
    const parsed = parseMermaidSource(source)
    if (parsed.nodes.length === 0) {
      return buildDefaultMermaidDiagram()
    }
    return parsed
  })
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null)
  const [placingShape, setPlacingShape] = useState<MermaidShapeType | null>(null)

  const dirtyRef = useRef(false)
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Parse source when it changes externally
  useEffect(() => {
    const next = parseMermaidSource(source)
    setDiagram(next)
  }, [source])

  const schedulePersist = useCallback((nextDiagram: MermaidDiagram) => {
    dirtyRef.current = true
    if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current)
    persistTimeoutRef.current = setTimeout(() => {
      const serialized = serializeMermaidDiagram(nextDiagram)
      onPersist(serialized)
      dirtyRef.current = false
    }, 800)
  }, [onPersist])

  const addNode = useCallback((shape: MermaidShapeType, label?: string) => {
    const newNode = createNode(shape, 0, 0, label)
    setDiagram((prev) => {
      const next = { nodes: [...prev.nodes, newNode], edges: prev.edges }
      schedulePersist(next)
      return next
    })
    setSelectedNodeId(newNode.id)
    return newNode.id
  }, [schedulePersist])

  const addNodeAtCenter = useCallback((shape: MermaidShapeType) => {
    addNode(shape)
  }, [addNode])

  const deleteNode = useCallback((nodeId: string) => {
    setDiagram((prev) => {
      const nextNodes = prev.nodes.filter((n) => n.id !== nodeId)
      const nextEdges = prev.edges.filter((e) => e.from !== nodeId && e.to !== nodeId)
      const next = { nodes: nextNodes, edges: nextEdges }
      schedulePersist(next)
      return next
    })
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev))
  }, [schedulePersist])

  const addEdge = useCallback((from: string, to: string, label?: string) => {
    if (from === to) return
    setDiagram((prev) => {
      const alreadyExists = prev.edges.some((e) => e.from === from && e.to === to)
      if (alreadyExists) return prev
      const next = { nodes: prev.nodes, edges: [...prev.edges, createEdge(from, to, label)] }
      schedulePersist(next)
      return next
    })
  }, [schedulePersist])

  const updateNodeLabel = useCallback((nodeId: string, label: string) => {
    setDiagram((prev) => {
      const nextNodes = prev.nodes.map((n) => (n.id === nodeId ? { ...n, label } : n))
      const next = { nodes: nextNodes, edges: prev.edges }
      schedulePersist(next)
      return next
    })
  }, [schedulePersist])

  const toggleConnecting = useCallback(() => {
    setIsConnecting((prev) => {
      const next = !prev
      if (!next) setConnectingFromId(null)
      return next
    })
  }, [])

  const persistNow = useCallback(() => {
    const serialized = serializeMermaidDiagram(diagram)
    onPersist(serialized)
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current)
      persistTimeoutRef.current = null
    }
    dirtyRef.current = false
  }, [diagram, onPersist])

  // Node click handler: called by canvas when user clicks on a node (not a pan)
  const handleNodeClick = useCallback((nodeId: string) => {
    // Connection mode
    if (isConnecting) {
      if (!connectingFromId) {
        setConnectingFromId(nodeId)
        setSelectedNodeId(nodeId)
      } else {
        addEdge(connectingFromId, nodeId)
        setConnectingFromId(null)
        setIsConnecting(false)
      }
      return
    }

    // Normal selection
    setSelectedNodeId(nodeId)
  }, [isConnecting, connectingFromId, addEdge])

  // Empty click handler: called by canvas when user clicks on empty space (not a pan)
  const handleEmptyClick = useCallback(() => {
    // Placing shape
    if (placingShape) {
      addNode(placingShape)
      setPlacingShape(null)
      return
    }

    // Cancel connecting
    if (isConnecting) {
      setIsConnecting(false)
      setConnectingFromId(null)
      return
    }

    // Deselect
    setSelectedNodeId(null)
  }, [placingShape, isConnecting, addNode])

  // Cleanup
  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current)
    }
  }, [])

  return {
    diagram,
    selectedNodeId,
    isConnecting,
    connectingFromId,
    placingShape,
    addNode,
    addNodeAtCenter,
    deleteNode,
    addEdge,
    updateNodeLabel,
    toggleConnecting,
    persistNow,
    setPlacingShape,
    handleNodeClick,
    handleEmptyClick,
  }
}
