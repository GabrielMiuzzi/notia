/** Largest side of a rasterized drawing, in pixels. */
const MAX_SIDE_PX = 4096
/** Pixels per CSS pixel: sharp on paper and on dense screens. */
const SCALE = 2

/**
 * Draws an SVG of `width` × `height` CSS pixels on a canvas over
 * `background` and returns the PNG in base64; `null` when the browser
 * cannot draw it.
 */
export function svgToPng(svg: string, width: number, height: number, background: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(SCALE, MAX_SIDE_PX / Math.max(width, height, 1))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(null)
        return
      }
      context.fillStyle = background
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      try {
        resolve(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''))
      } catch {
        // A drawing the browser marks as unsafe cannot be read back.
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}
