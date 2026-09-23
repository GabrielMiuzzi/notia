import { useEffect, useState } from 'react'
import { loadChatImageAttachmentPreviews, type ChatImageAttachmentPreview } from '../../../services/chat/chatDocumentStorage'

const PREVIEW_DEBOUNCE_MS = 400

interface ChatAttachmentImagesProps {
  source: string
}

export function ChatAttachmentImages({ source }: ChatAttachmentImagesProps) {
  const [previews, setPreviews] = useState<ChatImageAttachmentPreview[]>([])
  useEffect(() => {
    let isCurrent = true
    // Edits change the source on every keystroke; parse once typing pauses.
    const timer = window.setTimeout(() => {
      void loadChatImageAttachmentPreviews(source)
        .then((next) => { if (isCurrent) setPreviews(next) })
        .catch(() => { if (isCurrent) setPreviews([]) })
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      isCurrent = false
      window.clearTimeout(timer)
    }
  }, [source])
  if (previews.length === 0) {
    return null
  }

  return (
    <section className="notia-chat-document-images" aria-label="Imágenes adjuntas del chat">
      <strong>Imágenes adjuntas</strong>
      <div className="notia-chat-document-images__grid">
        {previews.map((preview, index) => (
          <figure key={`${preview.name}-${preview.pageNumber ?? 0}-${index}`} className="notia-chat-document-images__item">
            <img
              src={`data:${preview.mimeType};base64,${preview.base64}`}
              alt={preview.pageNumber ? `${preview.name}, página ${preview.pageNumber}` : preview.name}
              loading="lazy"
            />
            <figcaption>
              {preview.name}{preview.pageNumber ? ` · página ${preview.pageNumber}` : ''}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
