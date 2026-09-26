import { useEffect, useRef } from 'react'
import { readGraphPalette, withAlpha } from './graphCanvas'

const WIDTH = 188
const HEIGHT = 150
const MARGIN = 8

export interface MinimapNode {
  x: number
  y: number
  color: string
  isSelected: boolean
}

export interface MinimapViewport {
  left: number
  top: number
  right: number
  bottom: number
}

interface GraphMinimapProps {
  nodes: MinimapNode[]
  /** Part of the graph on screen, in graph units. */
  viewport: MinimapViewport | null
  /** Changes on every frame worth redrawing. */
  version: number
}

/** The whole graph at a glance, with the part on screen framed. */
export function GraphMinimap({ nodes, viewport, version }: GraphMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const ratio = window.devicePixelRatio || 1
    if (canvas.width !== WIDTH * ratio) {
      canvas.width = WIDTH * ratio
      canvas.height = HEIGHT * ratio
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, WIDTH, HEIGHT)
    if (nodes.length === 0) return
    const palette = readGraphPalette(canvas)
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const node of nodes) {
      left = Math.min(left, node.x)
      top = Math.min(top, node.y)
      right = Math.max(right, node.x)
      bottom = Math.max(bottom, node.y)
    }
    // The frame of the screen always fits, however far the camera went.
    if (viewport) {
      left = Math.min(left, viewport.left)
      top = Math.min(top, viewport.top)
      right = Math.max(right, viewport.right)
      bottom = Math.max(bottom, viewport.bottom)
    }
    const scale = Math.min((WIDTH - MARGIN * 2) / Math.max(1, right - left), (HEIGHT - MARGIN * 2) / Math.max(1, bottom - top))
    const offsetX = (WIDTH - (right - left) * scale) / 2 - left * scale
    const offsetY = (HEIGHT - (bottom - top) * scale) / 2 - top * scale
    for (const node of nodes) {
      context.beginPath()
      context.arc(node.x * scale + offsetX, node.y * scale + offsetY, node.isSelected ? 2.4 : 1.5, 0, Math.PI * 2)
      context.fillStyle = node.isSelected ? palette.teal : node.color
      context.fill()
    }
    if (viewport) {
      const x = viewport.left * scale + offsetX
      const y = viewport.top * scale + offsetY
      const width = (viewport.right - viewport.left) * scale
      const height = (viewport.bottom - viewport.top) * scale
      context.fillStyle = withAlpha(palette.teal, 0.06)
      context.fillRect(x, y, width, height)
      context.lineWidth = 1.5
      context.strokeStyle = withAlpha(palette.teal, 0.8)
      context.strokeRect(x, y, width, height)
    }
  }, [nodes, viewport, version])

  return (
    <div className="notia-gv-card notia-gv-minimap" aria-hidden="true">
      <canvas ref={canvasRef} style={{ width: WIDTH, height: HEIGHT }} />
    </div>
  )
}
