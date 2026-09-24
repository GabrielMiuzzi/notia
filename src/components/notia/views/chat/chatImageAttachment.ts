import { callBackend } from '../../../../services/transport'
import type { StoredChatAttachment } from '../../../../services/chat/chatDocumentStorage'

export type SelectedImageAttachment = StoredChatAttachment

/*
 * The backend decides which files can be attached and their limits
 * (`backend-core::chat_attachments`), validates them again when the message
 * is sent and composes the prompt. The WebView only reads the picked file:
 * images as Base64, text as text and PDFs as rendered pages, because the
 * renderer (pdf.js) runs here.
 */

type AttachmentKind = StoredChatAttachment['kind']

function classifyFile(file: File): Promise<AttachmentKind> {
  return callBackend<AttachmentKind>('backend_classify_chat_file', {
    payload: { name: file.name, mediaType: file.type, byteLength: file.size },
  })
}

function readFile(file: File, as: 'text' | 'dataUrl'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name || 'el archivo'}.`))
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    if (as === 'text') reader.readAsText(file)
    else reader.readAsDataURL(file)
  })
}

export async function readChatFileAsAttachment(file: File): Promise<SelectedImageAttachment> {
  const kind = await classifyFile(file)
  if (kind === 'text') {
    const text = await readFile(file, 'text')
    if (!text.trim()) throw new Error('El archivo de texto está vacío.')
    return { name: file.name || 'archivo.txt', mimeType: file.type || 'text/plain', base64: '', kind, textContent: text }
  }
  const dataUrl = await readFile(file, 'dataUrl')
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  if (!base64.trim()) throw new Error(`No se pudo procesar ${file.name || 'el archivo'}.`)
  if (kind === 'image') {
    return { name: file.name || 'imagen', mimeType: file.type || 'image/png', base64, kind }
  }
  const { renderPdfForAi } = await import('../../../../services/pdf/pdfDocumentRenderer')
  const rendered = await renderPdfForAi(base64)
  const [firstPage, ...remainingPages] = rendered.images
  if (!firstPage) throw new Error('El PDF no contiene páginas para visualizar.')
  return {
    name: file.name || 'documento.pdf',
    mimeType: 'application/pdf',
    base64: firstPage,
    additionalBase64: remainingPages,
    kind,
    extractedText: rendered.extractedText || undefined,
    pageCount: rendered.pageCount,
  }
}
