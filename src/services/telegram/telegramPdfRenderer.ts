import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

const MAX_PDF_PAGES_FOR_AI = 12
const PDF_RENDER_SCALE = 1.5

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export async function renderTelegramPdfPages(base64: string): Promise<string[]> {
  if (!base64.trim()) throw new Error('Telegram no devolvió el PDF para renderizar.')
  const pdf = await pdfjs.getDocument({ data: decodeBase64(base64) }).promise
  const images: string[] = []
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PDF_PAGES_FOR_AI); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No se pudo preparar el renderizador del PDF.')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    images.push(canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, ''))
  }
  if (images.length === 0) throw new Error('El PDF no contiene páginas para visualizar.')
  return images
}
