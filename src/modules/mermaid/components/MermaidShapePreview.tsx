import { memo } from 'react'

interface MermaidShapePreviewProps {
  alias: string
  size?: number
  color?: string
}

export const MermaidShapePreview = memo(function MermaidShapePreview({
  alias,
  size = 48,
  color = 'currentColor',
}: MermaidShapePreviewProps) {
  const s = size
  const h = s * 0.6
  const pad = 4
  const w = s - pad * 2
  const hh = h - pad

  const render = () => {
    switch (alias) {
      // ── BÁSICAS ──
      case 'rect':
        return <rect x={pad} y={(s - hh) / 2} width={w} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
      case 'rounded':
        return <rect x={pad} y={(s - hh) / 2} width={w} height={hh} rx={6} fill="none" stroke={color} strokeWidth="1.5" />
      case 'stadium':
        return <rect x={pad} y={(s - hh) / 2} width={w} height={hh} rx={hh / 2} fill="none" stroke={color} strokeWidth="1.5" />
      case 'triangle':
        return <polygon points={`${s / 2},${pad} ${s - pad},${s - pad} ${pad},${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'diamond':
        return <polygon points={`${s / 2},${pad} ${s - pad},${s / 2} ${s / 2},${s - pad} ${pad},${s / 2}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'hexagon':
        return <polygon points={`${s / 2},${pad} ${s - pad * 1.5},${s * 0.25} ${s - pad * 1.5},${s * 0.75} ${s / 2},${s - pad} ${pad * 1.5},${s * 0.75} ${pad * 1.5},${s * 0.25}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'cylinder':
        return (
          <>
            <rect x={pad} y={s * 0.2} width={w} height={s * 0.5} fill="none" stroke={color} strokeWidth="1.5" />
            <ellipse cx={s / 2} cy={s * 0.2} rx={w / 2} ry={3} fill="none" stroke={color} strokeWidth="1.5" />
            <ellipse cx={s / 2} cy={s * 0.7} rx={w / 2} ry={3} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'circle':
        return <circle cx={s / 2} cy={s / 2} r={w * 0.35} fill="none" stroke={color} strokeWidth="1.5" />
      case 'double-circle':
        return (
          <>
            <circle cx={s / 2} cy={s / 2} r={w * 0.38} fill="none" stroke={color} strokeWidth="1.5" />
            <circle cx={s / 2} cy={s / 2} r={w * 0.25} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'small-circle':
        return <circle cx={s / 2} cy={s / 2} r={w * 0.2} fill="none" stroke={color} strokeWidth="1.5" />
      case 'parallelogram':
        return <polygon points={`${pad * 2},${pad} ${s - pad},${pad} ${s - pad * 2},${s - pad} ${pad},${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'parallelogram-alt':
        return <polygon points={`${pad},${pad} ${s - pad * 2},${pad} ${s - pad},${s - pad} ${pad * 2},${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'trapezoid':
        return <polygon points={`${pad * 2},${pad} ${s - pad * 2},${pad} ${s - pad},${s - pad} ${pad},${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'inv-trapezoid':
        return <polygon points={`${pad},${pad} ${s - pad},${pad} ${s - pad * 2},${s - pad} ${pad * 2},${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'text':
        return <text x={s / 2} y={s / 2 + 4} textAnchor="middle" fill={color} fontSize="11" fontWeight="600">TEXT</text>

      // ── PROCESOS ──
      case 'subroutine':
        return (
          <>
            <rect x={pad} y={(s - hh) / 2} width={w} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
            <line x1={pad * 2} y1={(s - hh) / 2} x2={pad * 2} y2={(s + hh) / 2} stroke={color} strokeWidth="1.5" />
            <line x1={s - pad * 2} y1={(s - hh) / 2} x2={s - pad * 2} y2={(s + hh) / 2} stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'database':
        return (
          <>
            <path d={`M${pad * 2} ${s * 0.25} Q${s / 2} ${pad} ${s - pad * 2} ${s * 0.25} L${s - pad * 2} ${s * 0.75} Q${s / 2} ${s - pad} ${pad * 2} ${s * 0.75} Z`} fill="none" stroke={color} strokeWidth="1.5" />
            <path d={`M${pad * 2} ${s * 0.25} Q${s / 2} ${s * 0.5} ${s - pad * 2} ${s * 0.25}`} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'collate':
        return <polygon points={`${pad},${pad} ${s - pad},${pad} ${s / 2},${s / 2} ${s - pad},${s - pad} ${pad},${s - pad} ${s / 2},${s / 2}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'divided-process':
        return (
          <>
            <rect x={pad} y={(s - hh) / 2} width={w} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
            <line x1={pad + w * 0.3} y1={(s - hh) / 2} x2={pad + w * 0.3} y2={(s + hh) / 2} stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'delay':
        return <path d={`M${pad} ${(s - hh) / 2} L${s - pad - hh / 2} ${(s - hh) / 2} Q${s - pad} ${s / 2} ${s - pad - hh / 2} ${(s + hh) / 2} L${pad} ${(s + hh) / 2} Z`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'lean-right':
        return <polygon points={`${pad * 2},${pad} ${s - pad},${pad} ${s - pad * 2},${s - pad} ${pad},${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'lean-left':
        return <polygon points={`${pad},${pad} ${s - pad * 2},${pad} ${s - pad},${s - pad} ${pad * 2},${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'mult-process':
        return (
          <>
            <rect x={pad + 2} y={(s - hh) / 2 - 2} width={w} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
            <rect x={pad} y={(s - hh) / 2} width={w} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'lin-rect':
        return (
          <>
            <rect x={pad} y={(s - hh) / 2} width={w} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
            <line x1={pad} y1={(s - hh) / 2 + 4} x2={s - pad} y2={(s - hh) / 2 + 4} stroke={color} strokeWidth="1" />
          </>
        )
      case 'docs':
        return (
          <>
            <rect x={pad + 3} y={(s - hh) / 2 - 3} width={w - 4} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
            <rect x={pad} y={(s - hh) / 2} width={w - 4} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'cross-circ':
        return (
          <>
            <circle cx={s / 2} cy={s / 2} r={w * 0.35} fill="none" stroke={color} strokeWidth="1.5" />
            <line x1={s / 2 - w * 0.25} y1={s / 2 - w * 0.25} x2={s / 2 + w * 0.25} y2={s / 2 + w * 0.25} stroke={color} strokeWidth="1.5" />
            <line x1={s / 2 + w * 0.25} y1={s / 2 - w * 0.25} x2={s / 2 - w * 0.25} y2={s / 2 + w * 0.25} stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'notch-rect':
        return <path d={`M${pad} ${(s - hh) / 2} L${s - pad * 3} ${(s - hh) / 2} L${s - pad} ${s / 2} L${s - pad * 3} ${(s + hh) / 2} L${pad} ${(s + hh) / 2} Z`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'brace-l':
        return <path d={`M${s - pad} ${pad} Q${pad} ${pad} ${pad} ${s / 2} Q${pad} ${s - pad} ${s - pad} ${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'brace-r':
        return <path d={`M${pad} ${pad} Q${s - pad} ${pad} ${s - pad} ${s / 2} Q${s - pad} ${s - pad} ${pad} ${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'braces':
        return (
          <>
            <path d={`M${s * 0.4} ${pad} Q${pad} ${pad} ${pad} ${s / 2} Q${pad} ${s - pad} ${s * 0.4} ${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
            <path d={`M${s * 0.6} ${pad} Q${s - pad} ${pad} ${s - pad} ${s / 2} Q${s - pad} ${s - pad} ${s * 0.6} ${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'curved-trap':
        return <path d={`M${pad} ${(s - hh) / 2} Q${s / 2} ${pad} ${s - pad} ${(s - hh) / 2} L${s - pad} ${(s + hh) / 2} Q${s / 2} ${s - pad} ${pad} ${(s + hh) / 2} Z`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'stacked-rect':
        return (
          <>
            <rect x={pad + 3} y={(s - hh) / 2 - 3} width={w - 3} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
            <rect x={pad} y={(s - hh) / 2} width={w - 3} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )

      // ── TÉCNICAS ──
      case 'h-cylinder':
        return (
          <>
            <rect x={pad} y={s * 0.3} width={w} height={s * 0.35} fill="none" stroke={color} strokeWidth="1.5" />
            <ellipse cx={pad} cy={s * 0.475} rx={3} ry={s * 0.175} fill="none" stroke={color} strokeWidth="1.5" />
            <ellipse cx={s - pad} cy={s * 0.475} rx={3} ry={s * 0.175} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'datastore':
        return <path d={`M${pad} ${s * 0.25} Q${s / 2} ${pad} ${s - pad} ${s * 0.25} L${s - pad} ${s * 0.75} Q${s / 2} ${s - pad} ${pad} ${s * 0.75} Z`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'das':
        return (
          <>
            <rect x={pad} y={s * 0.25} width={w} height={s * 0.45} fill="none" stroke={color} strokeWidth="1.5" />
            <ellipse cx={pad} cy={s * 0.475} rx={3} ry={s * 0.225} fill="none" stroke={color} strokeWidth="1.5" />
            <ellipse cx={s - pad} cy={s * 0.475} rx={3} ry={s * 0.225} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'disk':
        return (
          <>
            <rect x={pad} y={s * 0.2} width={w} height={s * 0.5} fill="none" stroke={color} strokeWidth="1.5" />
            <line x1={pad} y1={s * 0.35} x2={s - pad} y2={s * 0.35} stroke={color} strokeWidth="1" />
            <line x1={pad} y1={s * 0.5} x2={s - pad} y2={s * 0.5} stroke={color} strokeWidth="1" />
            <ellipse cx={s / 2} cy={s * 0.2} rx={w / 2} ry={3} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'lightning-bolt':
        return <polygon points={`${s * 0.45},${pad} ${s * 0.6},${pad} ${s * 0.5},${s * 0.45} ${s * 0.65},${s * 0.45} ${s * 0.4},${s - pad} ${s * 0.55},${s - pad} ${s * 0.5},${s * 0.55} ${s * 0.35},${s * 0.55}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'bow-rect':
        return <path d={`M${pad} ${(s - hh) / 2} Q${s / 2} ${pad} ${s - pad} ${(s - hh) / 2} L${s - pad} ${(s + hh) / 2} Q${s / 2} ${s - pad} ${pad} ${(s + hh) / 2} Z`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'flag':
        return (
          <>
            <line x1={pad * 1.5} y1={s - pad} x2={pad * 1.5} y2={pad} stroke={color} strokeWidth="1.5" />
            <path d={`M${pad * 1.5} ${pad} L${s - pad} ${s * 0.35} L${pad * 1.5} ${s * 0.6} Z`} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'doc':
        return (
          <>
            <rect x={pad} y={pad} width={w} height={s * 0.65} rx={3} fill="none" stroke={color} strokeWidth="1.5" />
            <line x1={pad} y1={pad * 3} x2={s - pad} y2={pad * 3} stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'lin-doc':
        return (
          <>
            <rect x={pad} y={pad} width={w} height={s * 0.65} rx={3} fill="none" stroke={color} strokeWidth="1.5" />
            <line x1={pad} y1={pad * 3} x2={s - pad} y2={pad * 3} stroke={color} strokeWidth="1" />
            <line x1={pad} y1={pad * 4} x2={s - pad} y2={pad * 4} stroke={color} strokeWidth="1" />
          </>
        )
      case 'tag-doc':
        return (
          <>
            <polygon points={`${pad},${pad} ${s - pad * 3},${pad} ${s - pad},${pad * 2.5} ${s - pad * 3},${pad * 4} ${pad},${pad * 4}`} fill="none" stroke={color} strokeWidth="1.5" />
            <line x1={s - pad * 3} y1={pad} x2={s - pad * 3} y2={pad * 4} stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'tag-rect':
        return (
          <>
            <rect x={pad} y={(s - hh) / 2} width={w} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
            <line x1={pad + 6} y1={(s - hh) / 2} x2={pad + 6} y2={(s + hh) / 2} stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'cloud':
        return <path d={`M${s * 0.35} ${s * 0.55} Q${s * 0.2} ${s * 0.55} ${s * 0.2} ${s * 0.45} Q${s * 0.2} ${s * 0.3} ${s * 0.35} ${s * 0.3} Q${s * 0.4} ${s * 0.2} ${s * 0.55} ${s * 0.2} Q${s * 0.7} ${s * 0.2} ${s * 0.75} ${s * 0.3} Q${s * 0.85} ${s * 0.35} ${s * 0.8} ${s * 0.5} Q${s * 0.85} ${s * 0.6} ${s * 0.75} ${s * 0.65} Q${s * 0.7} ${s * 0.75} ${s * 0.55} ${s * 0.75} Q${s * 0.45} ${s * 0.75} ${s * 0.35} ${s * 0.65} Q${s * 0.25} ${s * 0.6} ${s * 0.25} ${s * 0.5} Q${s * 0.25} ${s * 0.45} ${s * 0.35} ${s * 0.45} Z`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'odd':
        return <path d={`M${pad} ${s * 0.4} Q${s * 0.3} ${pad} ${s * 0.5} ${s * 0.35} Q${s * 0.7} ${pad} ${s - pad} ${s * 0.4} Q${s * 0.8} ${s * 0.65} ${s * 0.5} ${s * 0.65} Q${s * 0.2} ${s * 0.65} ${pad} ${s * 0.4} Z`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'bang':
        return <polygon points={`${s * 0.5},${pad} ${s - pad},${s - pad} ${pad},${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />

      case 'junction':
        return <circle cx={s / 2} cy={s / 2} r={w * 0.25} fill={color} stroke={color} strokeWidth="1.5" />
      case 'framed-circle':
        return (
          <>
            <circle cx={s / 2} cy={s / 2} r={w * 0.32} fill="none" stroke={color} strokeWidth="1.5" />
            <circle cx={s / 2} cy={s / 2} r={w * 0.22} fill="none" stroke={color} strokeWidth="1.5" />
          </>
        )
      case 'framed-rectangle':
        return (
          <>
            <rect x={pad} y={(s - hh) / 2} width={w} height={hh} fill="none" stroke={color} strokeWidth="1.5" />
            <rect x={pad + 4} y={(s - hh) / 2 + 4} width={w - 8} height={hh - 8} fill="none" stroke={color} strokeWidth="1" />
          </>
        )
      case 'manual-input':
        return <polygon points={`${pad},${s - pad} ${s * 0.3},${pad} ${s - pad},${pad} ${s - pad},${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'manual-file':
        return <polygon points={`${pad},${pad * 2} ${s / 2},${pad} ${s - pad},${pad * 2} ${s - pad},${s - pad} ${pad},${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'internal-storage':
        return (
          <>
            <rect x={pad + 3} y={pad + 3} width={w - 6} height={w - 6} fill="none" stroke={color} strokeWidth="1.5" />
            <line x1={pad + 8} y1={pad + 3} x2={pad + 8} y2={s - pad - 3} stroke={color} strokeWidth="1" />
            <line x1={pad + 3} y1={pad + 8} x2={s - pad - 3} y2={pad + 8} stroke={color} strokeWidth="1" />
          </>
        )
      case 'loop-limit':
        return <polygon points={`${pad},${pad * 2} ${s / 2},${pad} ${s - pad},${pad * 2} ${s - pad},${s - pad} ${pad},${s - pad}`} fill="none" stroke={color} strokeWidth="1.5" />
      case 'stored-data':
        return <path d={`M${pad} ${(s - hh) / 2} Q${s / 2} ${pad} ${s - pad} ${(s - hh) / 2} L${s - pad} ${(s + hh) / 2} Q${s / 2} ${s - pad} ${pad} ${(s + hh) / 2} Z`} fill="none" stroke={color} strokeWidth="1.5" />

      default:
        return <rect x={pad} y={pad} width={w} height={w} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="3,3" />
    }
  }

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ display: 'block' }}>
      {render()}
    </svg>
  )
})

MermaidShapePreview.displayName = 'MermaidShapePreview'
