import { useEffect, useState } from 'react'
import type { NotiaFileNode } from '../../../types/notia'
import type { MarkdownWikiLinkTarget } from '../../../types/views/markdownWikiLink'
import { readLinkTargets } from '../../../services/libraries/libraryLinkRuntime'

const NO_TARGETS: MarkdownWikiLinkTarget[] = []

/**
 * Notes a wikilink of the open library can point to, as the backend lists
 * them. `treeNodes` only signals that the library's files may have changed.
 */
export function useWikiLinkTargets(libraryId: string | undefined, treeNodes: NotiaFileNode[]): MarkdownWikiLinkTarget[] {
  const [targets, setTargets] = useState<{ libraryId: string; items: MarkdownWikiLinkTarget[] } | null>(null)

  useEffect(() => {
    if (!libraryId) return
    let current = true
    void readLinkTargets(libraryId)
      .then((items) => { if (current) setTargets({ libraryId, items }) })
      .catch(() => { if (current) setTargets({ libraryId, items: NO_TARGETS }) })
    return () => { current = false }
  }, [libraryId, treeNodes])

  return libraryId && targets && targets.libraryId === libraryId ? targets.items : NO_TARGETS
}
