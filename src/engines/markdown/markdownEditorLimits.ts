/**
 * Milkdown keeps the complete document in a ProseMirror tree. Above this
 * limit, constructing that tree can monopolize the WebView UI thread, so the
 * host uses the lightweight large-document view instead.
 */
export const MARKDOWN_EDITOR_MAX_SOURCE_LENGTH = 1_000_000

export function shouldUseLargeMarkdownView(source: string): boolean {
  return source.length > MARKDOWN_EDITOR_MAX_SOURCE_LENGTH
}

export function formatMarkdownSourceSize(sourceLength: number): string {
  if (sourceLength < 1_000) {
    return `${sourceLength} caracteres`
  }

  const megabytes = sourceLength / (1024 * 1024)
  if (megabytes >= 1) {
    return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(megabytes)} MB`
  }

  return `${new Intl.NumberFormat('es-AR').format(Math.round(sourceLength / 1_000))} mil caracteres`
}
