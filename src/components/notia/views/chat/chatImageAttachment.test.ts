import { describe, expect, it } from 'vitest'
import {
  buildChatAttachmentPrompt,
  buildChatImageAttachment,
  isPdfFile,
  isTextFile,
  type SelectedImageAttachment,
} from './chatImageAttachment'

describe('chatImageAttachment', () => {
  it('detects PDFs by MIME type or extension', () => {
    expect(isPdfFile({ name: 'apunte.bin', type: 'application/pdf' })).toBe(true)
    expect(isPdfFile({ name: 'apunte.PDF', type: '' })).toBe(true)
    expect(isPdfFile({ name: 'apunte.png', type: 'image/png' })).toBe(false)
    expect(isTextFile({ name: 'datos.csv', type: '' })).toBe(true)
    expect(isTextFile({ name: 'datos.bin', type: 'application/octet-stream' })).toBe(false)
  })

  it('adds extracted PDF text as bounded source context without changing the user request', () => {
    const attachment: SelectedImageAttachment = {
      name: 'apunte.pdf',
      mimeType: 'application/pdf',
      base64: 'page-one',
      kind: 'pdf',
      extractedText: 'Pagina 1:\nLa ecuacion es x^2 = 4.',
    }

    const prompt = buildChatAttachmentPrompt('Transcribi este PDF al archivo activo.', attachment)

    expect(prompt).toContain('Transcribi este PDF al archivo activo.')
    expect(prompt).toContain('<pdf_text>')
    expect(prompt).toContain('La ecuacion es x^2 = 4.')
  })

  it('does not add PDF-only context to image requests', () => {
    const attachment: SelectedImageAttachment = {
      name: 'captura.png',
      mimeType: 'image/png',
      base64: 'image',
      kind: 'image',
      extractedText: 'no corresponde',
    }

    expect(buildChatAttachmentPrompt('Analiza esta imagen.', attachment)).toBe('Analiza esta imagen.')
  })

  it('includes a directly attached text file as isolated context', () => {
    const attachment: SelectedImageAttachment = {
      name: 'notas.md',
      mimeType: 'text/markdown',
      base64: '',
      kind: 'text',
      textContent: '# Notas\n\nContenido del archivo.',
    }

    const prompt = buildChatAttachmentPrompt('Resume este archivo.', attachment)

    expect(prompt).toContain('<attached_file name="notas.md">')
    expect(prompt).toContain('# Notas')
  })

  it('keeps several text attachments together in the same prompt', () => {
    const attachments: SelectedImageAttachment[] = [
      { name: 'uno.md', mimeType: 'text/markdown', base64: '', kind: 'text', textContent: 'Contenido uno.' },
      { name: 'dos.txt', mimeType: 'text/plain', base64: '', kind: 'text', textContent: 'Contenido dos.' },
    ]

    const prompt = buildChatAttachmentPrompt('Compará estos archivos.', attachments)

    expect(prompt).toContain('<attached_file name="uno.md">')
    expect(prompt).toContain('<attached_file name="dos.txt">')
    expect(prompt.indexOf('Contenido uno.')).toBeLessThan(prompt.indexOf('Contenido dos.'))
  })

  it('sends visual pages from several attachments as one ordered image collection', () => {
    const image = buildChatImageAttachment([
      { name: 'primera.png', mimeType: 'image/png', base64: 'image-one', kind: 'image' },
      { name: 'documento.pdf', mimeType: 'application/pdf', base64: 'page-one', additionalBase64: ['page-two'], kind: 'pdf' },
      { name: 'notas.md', mimeType: 'text/markdown', base64: '', kind: 'text', textContent: 'texto' },
      { name: 'segunda.jpg', mimeType: 'image/jpeg', base64: 'image-two', kind: 'image' },
    ])

    expect(image).toEqual({
      name: 'primera.png',
      mimeType: 'image/png',
      base64: 'image-one',
      additionalBase64: ['page-one', 'page-two', 'image-two'],
    })
  })
})
