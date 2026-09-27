/** `mm:ss`, or `h:mm:ss` past the first hour, for the minute labels. */
export function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor(totalSeconds / 60) % 60
  const seconds = totalSeconds % 60
  const pad = (value: number) => value.toString().padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** Size of a file as a person reads it: `850 KB`, `142 MB`, `1.4 GB`. */
export function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  if (megabytes < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (megabytes < 1024) return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`
  return `${(megabytes / 1024).toFixed(1)} GB`
}

/** CSS class of the palette color a speaker is drawn with. */
export const speakerColorClass = (colorIndex: number) => `notia-meeting-speaker-color--${colorIndex % 6}`
