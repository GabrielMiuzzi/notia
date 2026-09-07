import { describe, expect, it } from 'vitest'
import {
  buildChatAttachmentPrompt,
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
})
