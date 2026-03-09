import type { MarkdownWikiLinkTarget } from '../../../../types/views/markdownWikiLink'
import { NotiaButton } from '../../../common/NotiaButton'

export interface WikiLinkSuggestionMenuState {
  query: string
  replaceFrom: number
  replaceTo: number
  anchorLeft: number
  anchorTop: number
  suggestions: MarkdownWikiLinkTarget[]
  selectedIndex: number
}

interface WikiLinkSuggestionMenuProps {
  state: WikiLinkSuggestionMenuState | null
  onSelect: (index: number) => void
}

function shouldShowPath(target: MarkdownWikiLinkTarget): boolean {
  const normalizedTitle = target.title.toLowerCase()
  return target.relativePath.toLowerCase() !== normalizedTitle || target.wikiLink.toLowerCase() !== normalizedTitle
}

export function WikiLinkSuggestionMenu({ state, onSelect }: WikiLinkSuggestionMenuProps) {
  if (!state || state.suggestions.length === 0) {
    return null
  }

  return (
    <div
      className="notia-wikilink-menu"
      style={{ left: `${state.anchorLeft}px`, top: `${state.anchorTop + 6}px` }}
      role="listbox"
      aria-label="Wiki link suggestions"
    >
      {state.suggestions.map((target, index) => {
        const isActive = index === state.selectedIndex
        return (
          <NotiaButton
            key={target.path}
            role="option"
            aria-selected={isActive}
            variant={isActive ? 'primary' : 'secondary'}
            className={`notia-wikilink-menu-item ${isActive ? 'notia-wikilink-menu-item--active' : ''}`}
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(index)
            }}
          >
            <span className="notia-wikilink-menu-title">{target.title}</span>
            {shouldShowPath(target) ? (
              <span className="notia-wikilink-menu-path">{target.relativePath}</span>
            ) : null}
          </NotiaButton>
        )
      })}
    </div>
  )
}
