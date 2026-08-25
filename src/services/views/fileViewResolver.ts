import type { NotiaFileViewKind } from '../../types/views/fileDocument'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkdn', 'mkd'])
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
])

export function resolveFileViewKind(extension: string): NotiaFileViewKind {
  if (extension === 'mmd') {
    return 'mermaid'
  }

  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return 'markdown'
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }

  return 'text'
}

export function isTextualViewKind(viewKind: NotiaFileViewKind): viewKind is 'markdown' | 'text' | 'mermaid' {
  return viewKind === 'markdown' || viewKind === 'text' || viewKind === 'mermaid'
}
