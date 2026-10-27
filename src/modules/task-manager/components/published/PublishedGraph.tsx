import { lazy, Suspense } from 'react'
import { useLibraryGraphData } from '../../../../hooks/useLibraryGraphData'
import { PUBLISHED_VAULT_ALIAS } from '../../hooks/usePublishedTicketTabs'

// The app's Graph View, loaded when the guest opens it.
const GraphView = lazy(async () => {
  const module = await import('../../../../components/notia/views/GraphView')
  return { default: module.GraphView }
})

interface PublishedGraphProps {
  libraryId: string
  libraryName: string
  /** Bumped after each change of the notes: the graph is read again. */
  revision: number
  onOpenNote: (path: string) => void
}

/** Graph View of the notes of the published boards' contexts, as Rust restricts it. */
export function PublishedGraph({ libraryId, libraryName, revision, onOpenNote }: PublishedGraphProps) {
  const { graphModel, searchGraph, isGraphLoading } = useLibraryGraphData({
    enabled: true,
    libraryId,
    libraryPath: PUBLISHED_VAULT_ALIAS,
    revision,
  })
  return (
    <Suspense fallback={<div className="notia-published-graph-loading" role="status">Preparando graph view…</div>}>
      <GraphView
        graphModel={graphModel}
        searchGraph={searchGraph}
        libraryName={libraryName}
        isLoading={isGraphLoading}
        onOpenFile={onOpenNote}
      />
    </Suspense>
  )
}
