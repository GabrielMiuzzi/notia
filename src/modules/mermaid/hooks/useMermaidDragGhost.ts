import { useCallback, useRef } from 'react'

export type DragItemType = 'shape' | 'icon'

export function useMermaidDragGhost(canvasRef: React.RefObject<HTMLDivElement | null>) {
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const itemTypeRef = useRef<DragItemType | null>(null)
  const itemAliasRef = useRef<string | null>(null)
  const followCleanupRef = useRef<(() => void) | null>(null)

  const removeGhost = useCallback(() => {
    followCleanupRef.current?.()
    followCleanupRef.current = null
    if (ghostRef.current && ghostRef.current.parentNode) {
      ghostRef.current.parentNode.removeChild(ghostRef.current)
    }
    ghostRef.current = null
    itemTypeRef.current = null
    itemAliasRef.current = null
  }, [])

  const createGhost = useCallback(
    (itemType: DragItemType, itemAlias: string, itemHtml: string, e: PointerEvent) => {
      removeGhost()

      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const ghost = document.createElement('div')
      ghost.style.position = 'absolute'
      ghost.style.left = `${x}px`
      ghost.style.top = `${y}px`
      ghost.style.pointerEvents = 'none'
      ghost.style.zIndex = '9999'
      ghost.style.transition = 'transform 0.2s ease, opacity 0.25s ease'
      ghost.style.willChange = 'transform, opacity'
      ghost.style.transform = 'translate(-50%, -50%) scale(1)'

      ghost.innerHTML = itemHtml

      // Ensure SVG inside ghost scales nicely
      const svg = ghost.querySelector('svg')
      if (svg) {
        svg.style.display = 'block'
        svg.style.width = '56px'
        svg.style.height = '56px'
      }

      canvas.appendChild(ghost)
      ghostRef.current = ghost
      itemTypeRef.current = itemType
      itemAliasRef.current = itemAlias

      // Follow cursor until drop or cancel
      const onMove = (ev: PointerEvent) => {
        if (!ghostRef.current) return
        const r = canvas.getBoundingClientRect()
        ghostRef.current.style.left = `${ev.clientX - r.left}px`
        ghostRef.current.style.top = `${ev.clientY - r.top}px`
      }
      document.addEventListener('pointermove', onMove)
      followCleanupRef.current = () => document.removeEventListener('pointermove', onMove)

      // Force reflow to ensure transition works
      void ghost.offsetHeight
    },
    [canvasRef, removeGhost],
  )

  const animateDrop = useCallback(
    (onComplete?: () => void) => {
      const ghost = ghostRef.current
      if (!ghost) {
        onComplete?.()
        return
      }

      followCleanupRef.current?.()
      followCleanupRef.current = null

      ghost.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.35s ease 0.25s'
      ghost.style.transform = 'translate(-50%, -50%) scale(0.75)'
      ghost.style.opacity = '0'

      const onTransitionEnd = () => {
        removeGhost()
        onComplete?.()
      }

      ghost.addEventListener('transitionend', onTransitionEnd, { once: true })
      // Safety cleanup in case transition doesn't fire
      setTimeout(() => {
        removeGhost()
        onComplete?.()
      }, 650)
    },
    [removeGhost],
  )

  return {
    createGhost,
    removeGhost,
    animateDrop,
  }
}

export function buildShapePreview(alias: string): string {
  const s = 56
  const pad = 6
  const w = s - pad * 2
  const hh = s * 0.6 - pad
  const color = 'var(--color-accent-text, #4dabf7)'

  let svgContent = ''
  switch (alias) {
    case 'rect':
      svgContent = `<rect x="${pad}" y="${(s - hh) / 2}" width="${w}" height="${hh}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'rounded':
      svgContent = `<rect x="${pad}" y="${(s - hh) / 2}" width="${w}" height="${hh}" rx="6" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'stadium':
      svgContent = `<rect x="${pad}" y="${(s - hh) / 2}" width="${w}" height="${hh}" rx="${hh / 2}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'triangle':
      svgContent = `<polygon points="${s / 2},${pad} ${s - pad},${s - pad} ${pad},${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'diamond':
      svgContent = `<polygon points="${s / 2},${pad} ${s - pad},${s / 2} ${s / 2},${s - pad} ${pad},${s / 2}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'hexagon':
      svgContent = `<polygon points="${s / 2},${pad} ${s - pad * 1.5},${s * 0.25} ${s - pad * 1.5},${s * 0.75} ${s / 2},${s - pad} ${pad * 1.5},${s * 0.75} ${pad * 1.5},${s * 0.25}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'cylinder':
      svgContent = `<rect x="${pad}" y="${s * 0.2}" width="${w}" height="${s * 0.5}" fill="none" stroke="${color}" stroke-width="2" /><ellipse cx="${s / 2}" cy="${s * 0.2}" rx="${w / 2}" ry="3" fill="none" stroke="${color}" stroke-width="2" /><ellipse cx="${s / 2}" cy="${s * 0.7}" rx="${w / 2}" ry="3" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'circle':
      svgContent = `<circle cx="${s / 2}" cy="${s / 2}" r="${w * 0.35}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'double-circle':
      svgContent = `<circle cx="${s / 2}" cy="${s / 2}" r="${w * 0.38}" fill="none" stroke="${color}" stroke-width="2" /><circle cx="${s / 2}" cy="${s / 2}" r="${w * 0.25}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'small-circle':
      svgContent = `<circle cx="${s / 2}" cy="${s / 2}" r="${w * 0.2}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'parallelogram':
      svgContent = `<polygon points="${pad * 2},${pad} ${s - pad},${pad} ${s - pad * 2},${s - pad} ${pad},${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'parallelogram-alt':
      svgContent = `<polygon points="${pad},${pad} ${s - pad * 2},${pad} ${s - pad},${s - pad} ${pad * 2},${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'trapezoid':
      svgContent = `<polygon points="${pad * 2},${pad} ${s - pad * 2},${pad} ${s - pad},${s - pad} ${pad},${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'inv-trapezoid':
      svgContent = `<polygon points="${pad},${pad} ${s - pad},${pad} ${s - pad * 2},${s - pad} ${pad * 2},${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'text':
      svgContent = `<text x="${s / 2}" y="${s / 2 + 5}" text-anchor="middle" fill="${color}" font-size="13" font-weight="600">TEXT</text>`
      break
    case 'subroutine':
      svgContent = `<rect x="${pad}" y="${(s - hh) / 2}" width="${w}" height="${hh}" fill="none" stroke="${color}" stroke-width="2" /><line x1="${pad * 2}" y1="${(s - hh) / 2}" x2="${pad * 2}" y2="${(s + hh) / 2}" stroke="${color}" stroke-width="2" /><line x1="${s - pad * 2}" y1="${(s - hh) / 2}" x2="${s - pad * 2}" y2="${(s + hh) / 2}" stroke="${color}" stroke-width="2" />`
      break
    case 'database':
      svgContent = `<path d="M${pad * 2} ${s * 0.25} Q${s / 2} ${pad} ${s - pad * 2} ${s * 0.25} L${s - pad * 2} ${s * 0.75} Q${s / 2} ${s - pad} ${pad * 2} ${s * 0.75} Z" fill="none" stroke="${color}" stroke-width="2" /><path d="M${pad * 2} ${s * 0.25} Q${s / 2} ${s * 0.5} ${s - pad * 2} ${s * 0.25}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'collate':
      svgContent = `<polygon points="${pad},${pad} ${s - pad},${pad} ${s / 2},${s / 2} ${s - pad},${s - pad} ${pad},${s - pad} ${s / 2},${s / 2}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'divided-process':
      svgContent = `<rect x="${pad}" y="${(s - hh) / 2}" width="${w}" height="${hh}" fill="none" stroke="${color}" stroke-width="2" /><line x1="${pad + w * 0.3}" y1="${(s - hh) / 2}" x2="${pad + w * 0.3}" y2="${(s + hh) / 2}" stroke="${color}" stroke-width="2" />`
      break
    case 'delay':
      svgContent = `<path d="M${pad} ${(s - hh) / 2} L${s - pad - hh / 2} ${(s - hh) / 2} Q${s - pad} ${s / 2} ${s - pad - hh / 2} ${(s + hh) / 2} L${pad} ${(s + hh) / 2} Z" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'lean-right':
      svgContent = `<polygon points="${pad * 2},${pad} ${s - pad},${pad} ${s - pad * 2},${s - pad} ${pad},${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'lean-left':
      svgContent = `<polygon points="${pad},${pad} ${s - pad * 2},${pad} ${s - pad},${s - pad} ${pad * 2},${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'mult-process':
      svgContent = `<rect x="${pad + 2}" y="${(s - hh) / 2 - 2}" width="${w}" height="${hh}" fill="none" stroke="${color}" stroke-width="2" /><rect x="${pad}" y="${(s - hh) / 2}" width="${w}" height="${hh}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'lin-rect':
      svgContent = `<rect x="${pad}" y="${(s - hh) / 2}" width="${w}" height="${hh}" fill="none" stroke="${color}" stroke-width="2" /><line x1="${pad}" y1="${(s - hh) / 2 + 5}" x2="${s - pad}" y2="${(s - hh) / 2 + 5}" stroke="${color}" stroke-width="1.5" />`
      break
    case 'docs':
      svgContent = `<rect x="${pad + 3}" y="${(s - hh) / 2 - 3}" width="${w - 4}" height="${hh}" fill="none" stroke="${color}" stroke-width="2" /><rect x="${pad}" y="${(s - hh) / 2}" width="${w - 4}" height="${hh}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'cross-circ':
      svgContent = `<circle cx="${s / 2}" cy="${s / 2}" r="${w * 0.35}" fill="none" stroke="${color}" stroke-width="2" /><line x1="${s / 2 - w * 0.25}" y1="${s / 2 - w * 0.25}" x2="${s / 2 + w * 0.25}" y2="${s / 2 + w * 0.25}" stroke="${color}" stroke-width="2" /><line x1="${s / 2 + w * 0.25}" y1="${s / 2 - w * 0.25}" x2="${s / 2 - w * 0.25}" y2="${s / 2 + w * 0.25}" stroke="${color}" stroke-width="2" />`
      break
    case 'notch-rect':
      svgContent = `<path d="M${pad} ${(s - hh) / 2} L${s - pad * 3} ${(s - hh) / 2} L${s - pad} ${s / 2} L${s - pad * 3} ${(s + hh) / 2} L${pad} ${(s + hh) / 2} Z" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'brace-l':
      svgContent = `<path d="M${s - pad} ${pad} Q${pad} ${pad} ${pad} ${s / 2} Q${pad} ${s - pad} ${s - pad} ${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'brace-r':
      svgContent = `<path d="M${pad} ${pad} Q${s - pad} ${pad} ${s - pad} ${s / 2} Q${s - pad} ${s - pad} ${pad} ${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'braces':
      svgContent = `<path d="M${s * 0.4} ${pad} Q${pad} ${pad} ${pad} ${s / 2} Q${pad} ${s - pad} ${s * 0.4} ${s - pad}" fill="none" stroke="${color}" stroke-width="2" /><path d="M${s * 0.6} ${pad} Q${s - pad} ${pad} ${s - pad} ${s / 2} Q${s - pad} ${s - pad} ${s * 0.6} ${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'curved-trap':
      svgContent = `<path d="M${pad} ${(s - hh) / 2} Q${s / 2} ${pad} ${s - pad} ${(s - hh) / 2} L${s - pad} ${(s + hh) / 2} Q${s / 2} ${s - pad} ${pad} ${(s + hh) / 2} Z" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'h-cylinder':
      svgContent = `<rect x="${pad}" y="${s * 0.3}" width="${w}" height="${s * 0.35}" fill="none" stroke="${color}" stroke-width="2" /><ellipse cx="${pad}" cy="${s * 0.475}" rx="3" ry="${s * 0.175}" fill="none" stroke="${color}" stroke-width="2" /><ellipse cx="${s - pad}" cy="${s * 0.475}" rx="3" ry="${s * 0.175}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'datastore':
      svgContent = `<path d="M${pad} ${s * 0.25} Q${s / 2} ${pad} ${s - pad} ${s * 0.25} L${s - pad} ${s * 0.75} Q${s / 2} ${s - pad} ${pad} ${s * 0.75} Z" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'das':
      svgContent = `<rect x="${pad}" y="${s * 0.25}" width="${w}" height="${s * 0.45}" fill="none" stroke="${color}" stroke-width="2" /><ellipse cx="${pad}" cy="${s * 0.475}" rx="3" ry="${s * 0.225}" fill="none" stroke="${color}" stroke-width="2" /><ellipse cx="${s - pad}" cy="${s * 0.475}" rx="3" ry="${s * 0.225}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'disk':
      svgContent = `<rect x="${pad}" y="${s * 0.2}" width="${w}" height="${s * 0.5}" fill="none" stroke="${color}" stroke-width="2" /><line x1="${pad}" y1="${s * 0.35}" x2="${s - pad}" y2="${s * 0.35}" stroke="${color}" stroke-width="1.5" /><line x1="${pad}" y1="${s * 0.5}" x2="${s - pad}" y2="${s * 0.5}" stroke="${color}" stroke-width="1.5" /><ellipse cx="${s / 2}" cy="${s * 0.2}" rx="${w / 2}" ry="3" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'lightning-bolt':
      svgContent = `<polygon points="${s * 0.45},${pad} ${s * 0.6},${pad} ${s * 0.5},${s * 0.45} ${s * 0.65},${s * 0.45} ${s * 0.4},${s - pad} ${s * 0.55},${s - pad} ${s * 0.5},${s * 0.55} ${s * 0.35},${s * 0.55}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'bow-rect':
      svgContent = `<path d="M${pad} ${(s - hh) / 2} Q${s / 2} ${pad} ${s - pad} ${(s - hh) / 2} L${s - pad} ${(s + hh) / 2} Q${s / 2} ${s - pad} ${pad} ${(s + hh) / 2} Z" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'flag':
      svgContent = `<line x1="${pad * 1.5}" y1="${s - pad}" x2="${pad * 1.5}" y2="${pad}" stroke="${color}" stroke-width="2" /><path d="M${pad * 1.5} ${pad} L${s - pad} ${s * 0.35} L${pad * 1.5} ${s * 0.6} Z" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'doc':
      svgContent = `<rect x="${pad}" y="${pad}" width="${w}" height="${s * 0.65}" rx="3" fill="none" stroke="${color}" stroke-width="2" /><line x1="${pad}" y1="${pad * 3}" x2="${s - pad}" y2="${pad * 3}" stroke="${color}" stroke-width="2" />`
      break
    case 'lin-doc':
      svgContent = `<rect x="${pad}" y="${pad}" width="${w}" height="${s * 0.65}" rx="3" fill="none" stroke="${color}" stroke-width="2" /><line x1="${pad}" y1="${pad * 3}" x2="${s - pad}" y2="${pad * 3}" stroke="${color}" stroke-width="1.5" /><line x1="${pad}" y1="${pad * 4}" x2="${s - pad}" y2="${pad * 4}" stroke="${color}" stroke-width="1.5" />`
      break
    case 'tag-doc':
      svgContent = `<polygon points="${pad},${pad} ${s - pad * 3},${pad} ${s - pad},${pad * 2.5} ${s - pad * 3},${pad * 4} ${pad},${pad * 4}" fill="none" stroke="${color}" stroke-width="2" /><line x1="${s - pad * 3}" y1="${pad}" x2="${s - pad * 3}" y2="${pad * 4}" stroke="${color}" stroke-width="2" />`
      break
    case 'tag-rect':
      svgContent = `<rect x="${pad}" y="${(s - hh) / 2}" width="${w}" height="${hh}" fill="none" stroke="${color}" stroke-width="2" /><line x1="${pad + 6}" y1="${(s - hh) / 2}" x2="${pad + 6}" y2="${(s + hh) / 2}" stroke="${color}" stroke-width="2" />`
      break
    case 'cloud':
      svgContent = `<path d="M${s * 0.35} ${s * 0.55} Q${s * 0.2} ${s * 0.55} ${s * 0.2} ${s * 0.45} Q${s * 0.2} ${s * 0.3} ${s * 0.35} ${s * 0.3} Q${s * 0.4} ${s * 0.2} ${s * 0.55} ${s * 0.2} Q${s * 0.7} ${s * 0.2} ${s * 0.75} ${s * 0.3} Q${s * 0.85} ${s * 0.35} ${s * 0.8} ${s * 0.5} Q${s * 0.85} ${s * 0.6} ${s * 0.75} ${s * 0.65} Q${s * 0.7} ${s * 0.75} ${s * 0.55} ${s * 0.75} Q${s * 0.45} ${s * 0.75} ${s * 0.35} ${s * 0.65} Q${s * 0.25} ${s * 0.6} ${s * 0.25} ${s * 0.5} Q${s * 0.25} ${s * 0.45} ${s * 0.35} ${s * 0.45} Z" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'odd':
      svgContent = `<path d="M${pad} ${s * 0.4} Q${s * 0.3} ${pad} ${s * 0.5} ${s * 0.35} Q${s * 0.7} ${pad} ${s - pad} ${s * 0.4} Q${s * 0.8} ${s * 0.65} ${s * 0.5} ${s * 0.65} Q${s * 0.2} ${s * 0.65} ${pad} ${s * 0.4} Z" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'bang':
      svgContent = `<polygon points="${s * 0.5},${pad} ${s - pad},${s - pad} ${pad},${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'fork':
      svgContent = `<polygon points="${s * 0.25},${pad} ${s * 0.75},${pad} ${s * 0.75},${s * 0.4} ${s - pad},${s * 0.4} ${s - pad},${s * 0.6} ${s * 0.75},${s * 0.6} ${s * 0.75},${s - pad} ${s * 0.25},${s - pad} ${s * 0.25},${s * 0.6} ${pad},${s * 0.6} ${pad},${s * 0.4} ${s * 0.25},${s * 0.4}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'junction':
      svgContent = `<circle cx="${s / 2}" cy="${s / 2}" r="${w * 0.25}" fill="${color}" stroke="${color}" stroke-width="2" />`
      break
    case 'framed-circle':
      svgContent = `<circle cx="${s / 2}" cy="${s / 2}" r="${w * 0.32}" fill="none" stroke="${color}" stroke-width="2" /><circle cx="${s / 2}" cy="${s / 2}" r="${w * 0.22}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'framed-rectangle':
      svgContent = `<rect x="${pad}" y="${(s - hh) / 2}" width="${w}" height="${hh}" fill="none" stroke="${color}" stroke-width="2" /><rect x="${pad + 4}" y="${(s - hh) / 2 + 4}" width="${w - 8}" height="${hh - 8}" fill="none" stroke="${color}" stroke-width="1.5" />`
      break
    case 'manual-input':
      svgContent = `<polygon points="${pad},${s - pad} ${s * 0.3},${pad} ${s - pad},${pad} ${s - pad},${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'manual-file':
      svgContent = `<polygon points="${pad},${pad * 2} ${s / 2},${pad} ${s - pad},${pad * 2} ${s - pad},${s - pad} ${pad},${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'internal-storage':
      svgContent = `<rect x="${pad + 3}" y="${pad + 3}" width="${w - 6}" height="${w - 6}" fill="none" stroke="${color}" stroke-width="2" /><line x1="${pad + 8}" y1="${pad + 3}" x2="${pad + 8}" y2="${s - pad - 3}" stroke="${color}" stroke-width="1.5" /><line x1="${pad + 3}" y1="${pad + 8}" x2="${s - pad - 3}" y2="${pad + 8}" stroke="${color}" stroke-width="1.5" />`
      break
    case 'loop-limit':
      svgContent = `<polygon points="${pad},${pad * 2} ${s / 2},${pad} ${s - pad},${pad * 2} ${s - pad},${s - pad} ${pad},${s - pad}" fill="none" stroke="${color}" stroke-width="2" />`
      break
    case 'stored-data':
      svgContent = `<path d="M${pad} ${(s - hh) / 2} Q${s / 2} ${pad} ${s - pad} ${(s - hh) / 2} L${s - pad} ${(s + hh) / 2} Q${s / 2} ${s - pad} ${pad} ${(s + hh) / 2} Z" fill="none" stroke="${color}" stroke-width="2" />`
      break
    default:
      svgContent = `<rect x="${pad}" y="${pad}" width="${w}" height="${w}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="3,3" />`
      break
  }

  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" style="display:block">${svgContent}</svg>`
}
