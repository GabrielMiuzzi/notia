/*
 * Exports the diagram as drawn on the canvas (theme and hand-drawn look
 * included), without the selection marks.
 */

function cleanSvg(svg: Element): { text: string; width: number; height: number } {
  const copy = svg.cloneNode(true) as SVGSVGElement
  copy.querySelectorAll('.mmd-selected, .mmd-link-source').forEach((element) => element.classList.remove('mmd-selected', 'mmd-link-source'))
  const box = (svg as SVGSVGElement).viewBox?.baseVal
  const width = Math.ceil(box?.width || svg.getBoundingClientRect().width || 800)
  const height = Math.ceil(box?.height || svg.getBoundingClientRect().height || 600)
  copy.setAttribute('width', String(width))
  copy.setAttribute('height', String(height))
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  copy.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  const text = new XMLSerializer().serializeToString(copy).replace(/<br>/g, '<br/>')
  return { text, width, height }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

const fileName = (title: string, extension: string) => `${title.replace(/[\\/:*?"<>|]+/g, '_') || 'diagrama'}.${extension}`

export function exportDiagramSvg(svg: Element | null, title: string) {
  if (!svg) return
  download(new Blob([cleanSvg(svg).text], { type: 'image/svg+xml;charset=utf-8' }), fileName(title, 'svg'))
}

export function exportDiagramPng(svg: Element | null, title: string) {
  if (!svg) return
  const { text, width, height } = cleanSvg(svg)
  const image = new Image()
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }))
  image.onload = () => {
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const context = canvas.getContext('2d')
    if (!context) return
    const stage = svg.closest('.mmd-stage')
    context.fillStyle = stage ? getComputedStyle(stage).backgroundColor : '#0f1420'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    canvas.toBlob((blob) => blob && download(blob, fileName(title, 'png')), 'image/png')
  }
  image.src = url
}
