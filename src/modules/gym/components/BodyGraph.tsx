import type { BodyFigure } from '../types/gymTypes'

interface BodyGraphProps {
  figure: BodyFigure | null
  /** Estado o nivel de cada músculo; el tema decide el color. */
  tones: Record<string, string | number | undefined>
  /** `state` (fatigado, recuperándose…) o `level` (principal, secundario). */
  scale: 'state' | 'level'
  height: number
  label: string
  onPick?: (muscle: string) => void
}

/**
 * El cuerpo con los músculos pintados. Los trazos salen de los SVG de
 * `Gym/` (Rust los lee); el color de cada músculo lo pone el tema según su
 * estado o nivel.
 */
export function BodyGraph({ figure, tones, scale, height, label, onPick }: BodyGraphProps) {
  if (!figure) {
    return <div className="gym-body-missing" style={{ height }} role="img" aria-label={label}>Sin cuerpo en Gym/</div>
  }
  const [, , width, viewHeight] = figure.viewBox.split(/\s+/).map(Number)
  const ratio = width && viewHeight ? width / viewHeight : 0.444
  return (
    <svg
      className={`gym-body${onPick ? ' gym-body--pickable' : ''}`}
      viewBox={figure.viewBox}
      width={Math.round(height * ratio)}
      height={height}
      role="img"
      aria-label={label}
    >
      {figure.silhouette.map((d, index) => <path key={`s${index}`} className="gym-body-silhouette" d={d} />)}
      {figure.outline.map((d, index) => <path key={`o${index}`} className="gym-body-outline" d={d} />)}
      {figure.muscles.map((path, index) => (
        <path
          key={`m${index}`}
          className="gym-body-muscle"
          data-scale={scale}
          data-tone={String(tones[path.muscle] ?? (scale === 'state' ? 'none' : 0))}
          d={path.d}
          onClick={onPick ? () => onPick(path.muscle) : undefined}
        />
      ))}
    </svg>
  )
}
