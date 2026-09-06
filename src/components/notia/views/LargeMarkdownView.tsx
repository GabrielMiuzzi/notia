import { useState } from 'react'
import { formatMarkdownSourceSize } from '../../../engines/markdown/markdownEditorLimits'
import { TextView } from './TextView'

const LARGE_DOCUMENT_PREVIEW_LENGTH = 12_000

interface LargeMarkdownViewProps {
  source: string
  onSourceChange: (nextSource: string) => void
}

export function LargeMarkdownView({ source, onSourceChange }: LargeMarkdownViewProps) {
  const [isTextEditorOpen, setIsTextEditorOpen] = useState(false)

  if (isTextEditorOpen) {
    return (
      <div className="notia-large-markdown-editor">
        <div className="notia-large-markdown-editor__toolbar">
          <span>Editor de texto</span>
          <button type="button" onClick={() => setIsTextEditorOpen(false)}>
            Volver al aviso
          </button>
        </div>
        <TextView source={source} onSourceChange={onSourceChange} />
      </div>
    )
  }

  const preview = source.slice(0, LARGE_DOCUMENT_PREVIEW_LENGTH)

  return (
    <section className="notia-large-markdown-view" aria-labelledby="notia-large-markdown-title">
      <div className="notia-large-markdown-card">
        <span className="notia-large-markdown-card__eyebrow">Documento grande</span>
        <h3 id="notia-large-markdown-title">El editor visual está pausado para proteger la interfaz</h3>
        <p>
          Este archivo ocupa <strong>{formatMarkdownSourceSize(source.length)}</strong>. Milkdown necesita crear un
          elemento editable por cada bloque y podría bloquear la aplicación durante varios minutos.
        </p>
        <p>
          La nota sigue disponible y no fue modificada. Podés abrirla como texto para revisarla o corregirla.
        </p>
        <div className="notia-large-markdown-card__actions">
          <button type="button" onClick={() => setIsTextEditorOpen(true)}>
            Editar como texto
          </button>
        </div>
        <details className="notia-large-markdown-preview">
          <summary>Ver una vista previa del comienzo</summary>
          <pre>{preview}{source.length > LARGE_DOCUMENT_PREVIEW_LENGTH ? '\n\n…' : ''}</pre>
        </details>
      </div>
    </section>
  )
}
