import type { LibraryGraphModel } from '../../types/graph/libraryGraph'

export interface GraphSearchResult {
  path: string
  label: string
  preview: string
  score: number
}

function normalizeGraphSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ')
}

function extractSearchableContent(path: string, source: string): string {
  if (path.toLowerCase().endsWith('.inkdoc')) {
    try {
      const parsed = JSON.parse(source) as {
        pages?: Array<{
          textBlocks?: Array<{
            text?: string
            html?: string
          }>
        }>
      }
      const blocks =
        parsed.pages?.flatMap((page) =>
          (page.textBlocks ?? []).map((block) => stripHtmlTags(block.html ?? block.text ?? '')),
        ) ?? []
      const extractedText = blocks.join(' ').replace(/\s+/g, ' ').trim()
      return extractedText || source
    } catch {
      return source
    }
  }

  return source
}

function buildSearchPreview(source: string, normalizedQuery: string): string {
  const flattenedSource = source.replace(/\s+/g, ' ').trim()
  if (!flattenedSource) {
    return 'Coincidencia en el archivo'
  }

  const normalizedSource = normalizeGraphSearchText(flattenedSource)
  const matchIndex = normalizedSource.indexOf(normalizedQuery)
  if (matchIndex < 0) {
    return flattenedSource.slice(0, 140)
  }

  const previewStart = Math.max(0, matchIndex - 44)
  const previewEnd = Math.min(flattenedSource.length, matchIndex + normalizedQuery.length + 72)
  const prefix = previewStart > 0 ? '... ' : ''
  const suffix = previewEnd < flattenedSource.length ? ' ...' : ''
  return `${prefix}${flattenedSource.slice(previewStart, previewEnd)}${suffix}`
}

export function buildGraphSearchResults(
  graphModel: LibraryGraphModel,
  graphSourcesByPath: Record<string, string>,
  searchQuery: string,
  maxResults = 8,
): GraphSearchResult[] {
  const normalizedSearchQuery = normalizeGraphSearchText(searchQuery.trim())
  if (!normalizedSearchQuery) {
    return []
  }

  const nextResults: GraphSearchResult[] = []
  for (const node of graphModel.nodes) {
    const normalizedLabel = normalizeGraphSearchText(node.label)
    const extractedContent = extractSearchableContent(node.path, graphSourcesByPath[node.path] ?? '')
    const normalizedContent = normalizeGraphSearchText(extractedContent)
    const titleMatchIndex = normalizedLabel.indexOf(normalizedSearchQuery)
    const contentMatchIndex = normalizedContent.indexOf(normalizedSearchQuery)
    if (titleMatchIndex < 0 && contentMatchIndex < 0) {
      continue
    }

    const titleScore = titleMatchIndex < 0 ? 0 : 600 - titleMatchIndex * 8
    const contentScore = contentMatchIndex < 0 ? 0 : 240 - Math.min(contentMatchIndex, 180)
    nextResults.push({
      path: node.path,
      label: node.label,
      preview: buildSearchPreview(extractedContent, normalizedSearchQuery),
      score: titleScore + contentScore + Math.min(node.degree, 12) * 4,
    })
  }

  return nextResults
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
    })
    .slice(0, maxResults)
}
