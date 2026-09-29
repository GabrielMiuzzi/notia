import { memo, type ReactNode } from 'react'

/*
 * Ilustración del plato cuando la receta no tiene foto: un plato visto desde
 * arriba con formas de comida generadas a partir del id, siempre iguales
 * para la misma receta. Es solo presentación.
 */

type Shape = 'grain' | 'blob' | 'leaf' | 'dot'
interface Item { shape: Shape; color: string; count: number; width: number; height?: number; zone: [number, number] }

const PALETTES = [
  ['#D9924B', '#8FD17A', '#FF6B6B'],
  ['#E9D8A6', '#6FCF97', '#FFB86B'],
  ['#C98A3E', '#A8D672', '#F4D35E'],
  ['#F2A541', '#5FAF78', '#E0475A'],
]

function hash(value: string): number {
  let result = 2166136261
  for (const character of value) {
    result ^= character.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function random(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16)
  const target = amount > 0 ? 255 : 0
  const factor = Math.abs(amount)
  const channel = (shift: number) => {
    const current = (value >> shift) & 255
    return Math.round(current + (target - current) * factor)
  }
  return `#${((1 << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).slice(1)}`
}

function blobPath(rx: number, ry: number, next: () => number): string {
  const points: Array<[number, number]> = []
  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2
    const jitter = 0.84 + next() * 0.28
    points.push([Math.cos(angle) * rx * jitter, Math.sin(angle) * ry * jitter])
  }
  const mid = (a: [number, number], b: [number, number]) => `${((a[0] + b[0]) / 2).toFixed(2)},${((a[1] + b[1]) / 2).toFixed(2)}`
  let path = `M${mid(points[8], points[0])}`
  points.forEach((point, index) => {
    const following = points[(index + 1) % points.length]
    path += ` Q${point[0].toFixed(2)},${point[1].toFixed(2)} ${mid(point, following)}`
  })
  return `${path}Z`
}

function shape(item: Item, next: () => number, scale: number, key: string): ReactNode {
  const stroke = shade(item.color, -0.28)
  const width = item.width * scale
  const height = (item.height ?? item.width) * scale
  switch (item.shape) {
    case 'grain':
      return <ellipse key={key} rx={width / 2} ry={height / 2} fill={item.color} />
    case 'dot':
      return <circle key={key} r={width / 2} fill={item.color} stroke={stroke} strokeWidth={0.5} />
    case 'blob':
      return <path key={key} d={blobPath(width / 2, height / 2, next)} fill={item.color} stroke={stroke} strokeWidth={width > 25 ? 1.6 : 0.7} />
    case 'leaf':
      return (
        <g key={key}>
          <path d={`M0,${-height / 2} Q${width / 2},0 0,${height / 2} Q${-width / 2},0 0,${-height / 2}Z`} fill={item.color} stroke={stroke} strokeWidth={0.6} />
          <path d={`M0,${(-height / 2) * 0.85} L0,${(height / 2) * 0.85}`} stroke={stroke} strokeWidth={0.6} />
        </g>
      )
  }
}

function PlateIllustrationComponent({ seed, label }: { seed: string; label: string }) {
  const palette = PALETTES[hash(seed) % PALETTES.length]
  const items: Item[] = [
    { shape: 'grain', color: palette[0], count: 40, width: 4, height: 2.6, zone: [0, 0.9] },
    { shape: 'blob', color: palette[0], count: 2, width: 26, height: 20, zone: [0.05, 0.35] },
    { shape: 'leaf', color: palette[1], count: 8, width: 10, height: 17, zone: [0.45, 0.9] },
    { shape: 'dot', color: palette[2], count: 5, width: 9, zone: [0.4, 0.85] },
  ]
  const next = random(hash(`${seed}plate`))
  const pieces: ReactNode[] = []
  items.forEach((item, itemIndex) => {
    for (let index = 0; index < item.count; index += 1) {
      const angle = next() * Math.PI * 2
      const distance = 46 * (item.zone[0] + (item.zone[1] - item.zone[0]) * Math.sqrt(next()))
      const x = 100 + Math.cos(angle) * distance
      const y = 75 + Math.sin(angle) * distance
      const rotation = next() * 360
      const scale = 0.85 + next() * 0.3
      pieces.push(
        <g key={`${itemIndex}-${index}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rotation.toFixed(0)})`}>
          {shape(item, next, scale, 'shape')}
        </g>,
      )
    }
  })
  return (
    <svg className="rcp-plate" viewBox="0 0 200 150" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Ilustración de ${label}`}>
      <ellipse className="rcp-plate__shadow" cx={104} cy={82} rx={62} ry={60} />
      <circle className="rcp-plate__rim" cx={100} cy={75} r={62} />
      <circle className="rcp-plate__well" cx={100} cy={75} r={50} />
      {pieces}
      <circle cx={100} cy={75} r={61} fill="none" stroke="#fff" strokeOpacity={0.05} strokeWidth={3} />
    </svg>
  )
}

export const PlateIllustration = memo(PlateIllustrationComponent)
