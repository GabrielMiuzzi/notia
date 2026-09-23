import { parseFrontmatterDocument } from '../../engines/markdown/frontmatterEngine'
import { resolveLibraryDocumentLogicalPath } from '../../services/libraries/libraryDocumentRuntime'

const MATH_TOKEN_PREFIX = 'NOTIA_MATH_TOKEN_'

type MathToken = {
  latex: string
  display: boolean
}

export type MarkdownExportFormat = 'google-docs' | 'pdf'

export function getExportableMarkdownBody(source: string): string {
  return parseFrontmatterDocument(source).body
}

export function extractMarkdownMath(source: string): { source: string; tokens: MathToken[] } {
  const tokens: MathToken[] = []
  const addToken = (latex: string, display: boolean): string => {
    const index = tokens.push({ latex: latex.trim(), display }) - 1
    return display
      ? `\n\n<div data-notia-math-token="${MATH_TOKEN_PREFIX}${index}"></div>\n\n`
      : `<span data-notia-math-token="${MATH_TOKEN_PREFIX}${index}"></span>`
  }

  let transformed = source.replace(
    /```(?:latex|math|tex)\s*\r?\n([\s\S]*?)```/gi,
    (_match, latex: string) => addToken(latex, true),
  )
  transformed = transformed.replace(/\$\$([\s\S]+?)\$\$/g, (_match, latex: string) => addToken(latex, true))
  transformed = transformed.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_match, prefix: string, latex: string) => (
    `${prefix}${addToken(latex, false)}`
  ))

  return { source: transformed, tokens }
}

function sanitizeExportHtml(html: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('script, iframe, object, embed, form, style, link, meta').forEach((node) => node.remove())
  template.content.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (name.startsWith('on') || (['href', 'src'].includes(name) && value.startsWith('javascript:'))) {
        element.removeAttribute(attribute.name)
      }
    }
  })
  return template.content
}

async function createExportElement(source: string): Promise<HTMLDivElement> {
  const [{ marked }, katex] = await Promise.all([import('marked'), import('katex')])
  const { source: tokenizedSource, tokens } = extractMarkdownMath(source)
  const html = await marked.parse(tokenizedSource, { async: true, gfm: true })
  const container = document.createElement('div')
  container.className = 'notia-markdown-export-document'
  container.append(sanitizeExportHtml(html))

  container.querySelectorAll<HTMLElement>('[data-notia-math-token]').forEach((element) => {
    const rawToken = element.dataset.notiaMathToken ?? ''
    const index = Number(rawToken.replace(MATH_TOKEN_PREFIX, ''))
    const token = tokens[index]
    if (!token) {
      element.remove()
      return
    }
    element.classList.add('notia-markdown-export-math')
    element.dataset.latex = token.latex
    katex.default.render(token.latex, element, {
      displayMode: token.display,
      throwOnError: false,
      strict: false,
      output: 'htmlAndMathml',
    })
  })

  return container
}

function mountExportElement(element: HTMLElement): () => void {
  const host = document.createElement('div')
  host.className = 'notia-markdown-export-host'
  host.setAttribute('aria-hidden', 'true')
  host.append(element)
  document.body.append(host)
  return () => host.remove()
}

function downloadBlobInBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export interface MarkdownExportContext {
  /** Native registry identity used by the backend export command. */
  libraryId?: string | null
  /** Active library path; required to persist exports inside the library on Android. */
  libraryPath?: string | null
  /** Path of the exported source document, used as the export destination folder. */
  sourceDocumentPath?: string | null
}

/**
 * Browser-only persistence. Tauri hosts never render or write exports from the
 * WebView: `exportMarkdownDocument` delegates them to the Rust backend.
 */
async function persistExportBlob(blob: Blob, fileName: string): Promise<boolean> {
  downloadBlobInBrowser(blob, fileName)
  return true
}

function getExportBaseName(documentName: string): string {
  return documentName.replace(/\.md$/i, '').trim() || 'documento'
}

async function renderElementToPng(element: HTMLElement, scale = 2): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas')
  return html2canvas(element, {
    backgroundColor: '#ffffff',
    scale,
    logging: false,
    useCORS: true,
  })
}

async function exportPdf(source: string, documentName: string): Promise<boolean> {
  const element = await createExportElement(source)
  const unmount = mountExportElement(element)
  try {
    const canvas = await renderElementToPng(element)
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 40
    const renderWidth = pageWidth - margin * 2
    const pixelsPerPoint = canvas.width / renderWidth
    const sliceHeight = Math.max(1, Math.floor((pageHeight - margin * 2) * pixelsPerPoint))

    for (let top = 0, page = 0; top < canvas.height; top += sliceHeight, page += 1) {
      const height = Math.min(sliceHeight, canvas.height - top)
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvas.width
      pageCanvas.height = height
      pageCanvas.getContext('2d')?.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height)
      if (page > 0) pdf.addPage()
      pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', margin, margin, renderWidth, height / pixelsPerPoint)
    }

    const output = pdf.output('arraybuffer')
    return persistExportBlob(new Blob([output], { type: 'application/pdf' }), `${getExportBaseName(documentName)}.pdf`)
  } finally {
    unmount()
  }
}

async function exportGoogleDocs(source: string, documentName: string): Promise<boolean> {
  const element = await createExportElement(source)
  const unmount = mountExportElement(element)
  try {
    const { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } = await import('docx')
    const children: InstanceType<typeof Paragraph>[] = []

    for (const block of [...element.children] as HTMLElement[]) {
      if (block.querySelector('.notia-markdown-export-math') || block.matches('.notia-markdown-export-math')) {
        const canvas = await renderElementToPng(block, 2)
        const bytes = new Uint8Array(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer())
        const maxWidth = 620
        const width = Math.min(maxWidth, canvas.width / 2)
        const height = Math.max(1, (canvas.height / canvas.width) * width)
        children.push(new Paragraph({ children: [new ImageRun({ data: bytes, transformation: { width, height }, type: 'png' })] }))
        continue
      }

      const text = block.textContent?.trim() ?? ''
      if (!text) continue
      const heading = block.tagName.match(/^H([1-6])$/)?.[1]
      children.push(new Paragraph({
        heading: heading ? HeadingLevel[`HEADING_${heading}` as keyof typeof HeadingLevel] : undefined,
        bullet: block.tagName === 'LI' ? { level: 0 } : undefined,
        children: [new TextRun({ text, bold: block.tagName === 'STRONG' })],
      }))
    }

    const document = new Document({ sections: [{ children }] })
    const blob = await Packer.toBlob(document)
    return persistExportBlob(blob, `${getExportBaseName(documentName)}.docx`)
  } finally {
    unmount()
  }
}

export async function exportMarkdownDocument(
  source: string,
  documentName: string,
  format: MarkdownExportFormat,
  context?: MarkdownExportContext,
): Promise<boolean> {
  const exportableSource = getExportableMarkdownBody(source)
  const { isTauri, invoke } = await import('@tauri-apps/api/core')
  const logicalPath = context?.libraryPath && context.sourceDocumentPath
    ? resolveLibraryDocumentLogicalPath(context.libraryPath, context.sourceDocumentPath)
    : undefined
  if (isTauri()) {
    if (!context?.libraryId || !logicalPath) {
      throw new Error('No se pudo resolver la biblioteca activa para exportar el documento.')
    }
    const result = await invoke<{ ok: boolean; error?: string }>('backend_export_markdown_document', {
      payload: {
        libraryId: context.libraryId,
        sourceLogicalPath: logicalPath,
        format: format === 'pdf' ? 'pdf' : 'docx',
      },
    })
    if (!result.ok) {
      throw new Error(result.error || 'No se pudo exportar el documento.')
    }
    return true
  }
  if (format === 'pdf') {
    return exportPdf(exportableSource, documentName)
  }
  return exportGoogleDocs(exportableSource, documentName)
}
