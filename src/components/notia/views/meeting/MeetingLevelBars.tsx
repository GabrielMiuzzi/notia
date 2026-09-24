interface MeetingLevelBarsProps {
  /** Levels from 0 to 1, oldest first. */
  levels: number[]
  /** Bars drawn; missing levels draw flat. */
  count: number
  /** Newest bars drawn with the source color. */
  highlight: number
  maxHeight: number
  className?: string
}

/** Decorative level meter; the text next to it says what it means. */
export function MeetingLevelBars({ levels, count, highlight, maxHeight, className }: MeetingLevelBarsProps) {
  const padded = Array.from({ length: count }, (_, index) => levels[levels.length - count + index] ?? 0)
  return (
    <div className={`notia-meeting-bars${className ? ` ${className}` : ''}`} aria-hidden="true">
      {padded.map((level, index) => (
        <span
          key={index}
          data-active={index >= count - highlight && level > 0.02 ? 'true' : undefined}
          style={{ height: `${Math.max(2, Math.round(level * maxHeight))}px` }}
        />
      ))}
    </div>
  )
}
