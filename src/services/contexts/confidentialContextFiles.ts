import {
  parseFrontmatterDocument,
  serializeFrontmatterDocument,
  setFrontmatterValue,
} from '../../engines/markdown/frontmatterEngine'
import { CONFIDENTIAL_CONTEXT_TAG } from './libraryContexts'

export function ensureConfidentialContext(source: string): { content: string; changed: boolean } {
  const document = parseFrontmatterDocument(source)
  const content = serializeFrontmatterDocument({
    ...document,
    hasFrontmatter: true,
    frontmatter: setFrontmatterValue(document.frontmatter, 'contexto', CONFIDENTIAL_CONTEXT_TAG),
  })
  return { content, changed: content !== source }
}
