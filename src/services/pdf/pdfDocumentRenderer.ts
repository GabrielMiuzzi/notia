import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

export const MAX_PDF_PAGES_FOR_CHAT_AI = 24
const DEFAULT_RENDER_SCALE = 1.5
const MAX_EXTRACTED_PDF_TEXT_CHARS = 40_000

export interface RenderedPdfForAi {
  pageCount: number
  images: string[]
  extractedText: string
}

interface RenderPdfOptions {
  maxPages?: number
  rejectIfMorePages?: boolean
  scale?: number
  extractText?: boolean
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function extractPageText(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  return items
    .map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`)
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function renderPdfForAi(
  base64: string,
  options: RenderPdfOptions = {},
): Promise<RenderedPdfForAi> {
  if (!base64.trim()) {
    throw new Error('No se recibio el PDF para procesarlo.')
  }

  const maxPages = options.maxPages ?? MAX_PDF_PAGES_FOR_CHAT_AI
  const pdf = await pdfjs.getDocument({ data: decodeBase64(base64) }).promise
  try {
    if (pdf.numPages === 0) {
      throw new Error('El PDF no contiene paginas para procesar.')
    }
    if (options.rejectIfMorePages !== false && pdf.numPages > maxPages) {
      throw new Error(`El PDF tiene ${pdf.numPages} paginas. Para procesarlo completo, adjunta un PDF de hasta ${maxPages} paginas.`)
    }

    const pageLimit = Math.min(pdf.numPages, maxPages)
    const images: string[] = []
    const extractedTextParts: string[] = []
    let extractedTextLength = 0
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: options.scale ?? DEFAULT_RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('No se pudo preparar el renderizador del PDF.')
      }

      await page.render({ canvas, canvasContext: context, viewport }).promise
      images.push(canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, ''))

      if (options.extractText !== false && extractedTextLength < MAX_EXTRACTED_PDF_TEXT_CHARS) {
        const textContent = await page.getTextContent()
        const pageText = extractPageText(textContent.items as Array<{ str?: string; hasEOL?: boolean }>)
        if (pageText) {
          const remainingChars = MAX_EXTRACTED_PDF_TEXT_CHARS - extractedTextLength
          const boundedPageText = pageText.slice(0, remainingChars)
          extractedTextParts.push(`Pagina ${pageNumber}:\n${boundedPageText}`)
          extractedTextLength += boundedPageText.length
        }
      }
    }

    return {
      pageCount: pdf.numPages,
      images,
      extractedText: extractedTextParts.join('\n\n'),
    }
  } finally {
    await pdf.destroy()
  }
}
