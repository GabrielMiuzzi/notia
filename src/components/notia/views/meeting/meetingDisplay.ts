/** `mm:ss`, or `h:mm:ss` past the first hour, for the minute labels. */
export function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor(totalSeconds / 60) % 60
  const seconds = totalSeconds % 60
  const pad = (value: number) => value.toString().padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** CSS class of the palette color a speaker is drawn with. */
export const speakerColorClass = (colorIndex: number) => `notia-meeting-speaker-color--${colorIndex % 6}`
