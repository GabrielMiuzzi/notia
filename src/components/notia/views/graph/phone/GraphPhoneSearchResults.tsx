import type { GraphSearchResult } from '../../../../../hooks/useLibraryGraphData'
import type { LibraryGraphNode } from '../../../../../types/graph/libraryGraph'
import { HighlightedLabel } from '../GraphSearchPanel'

/** The phone board lists this many notes that match. */
const MAX_SHOWN_RESULTS = 7

interface GraphPhoneSearchResultsProps {
  query: string
  /** Results of the backend search; `null` while it answers. */
  results: GraphSearchResult[] | null
  /** The most connected notes, listed while nothing is typed. */
  topConnected: LibraryGraphNode[]
  nodeByPath: ReadonlyMap<string, LibraryGraphNode>
  libraryName: string
  colorOf: (path: string) => string
  onPick: (path: string) => void
}

function linksText(degree: number): string {
  return degree === 1 ? '1 enlace' : `${degree} enlaces`
}

/** The notes that match the search, or the most connected ones before typing. */
export function GraphPhoneSearchResults({
  query,
  results,
  topConnected,
  nodeByPath,
  libraryName,
  colorOf,
  onPick,
}: GraphPhoneSearchResultsProps) {
  const hasQuery = query.trim().length > 0
  const rows = hasQuery
    ? (results ?? []).slice(0, MAX_SHOWN_RESULTS).map((result) => ({
      path: result.path,
      label: result.label,
      folder: result.folder,
      degree: nodeByPath.get(result.path)?.degree ?? 0,
    }))
    : topConnected.map((node) => ({ path: node.path, label: node.label, folder: node.folder, degree: node.degree }))
  let count = ''
  if (hasQuery) count = results === null ? '…' : results.length === 1 ? '1 nota' : `${results.length} notas`
  return (
    <div className="notia-gv-phone-results" role="region" aria-label={hasQuery ? 'Notas que coinciden' : 'Notas más conectadas'}>
      <p className="notia-gv-phone-section">
        <span>{hasQuery ? 'Resultados' : 'Más conectadas'}</span>
        <span className="notia-gv-phone-section-count" aria-live="polite">{count}</span>
      </p>
      {rows.map((row) => (
        <button key={row.path} type="button" className="notia-gv-phone-result" onClick={() => onPick(row.path)}>
          <span className="notia-gv-phone-dot" style={{ background: colorOf(row.path) }} aria-hidden="true" />
          <span className="notia-gv-phone-result-text">
            <span className="notia-gv-phone-result-label">
              {hasQuery ? <HighlightedLabel label={row.label} query={query} /> : row.label}
            </span>
            <span className="notia-gv-phone-result-meta">{row.folder || libraryName} · {linksText(row.degree)}</span>
          </span>
        </button>
      ))}
      {hasQuery && results !== null && results.length === 0 ? (
        <p className="notia-gv-phone-empty">Ninguna nota coincide con la búsqueda.</p>
      ) : null}
    </div>
  )
}
