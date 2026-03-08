import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Binary, Hash, List, Plus, Tag } from 'lucide-react'
import {
  findWikiLinkMatches,
  resolveWikiLinkTarget,
  type MarkdownWikiLinkLookup,
} from '../../../engines/markdown/wikiLinkEngine'
import {
  parsePropertyInputValue,
  type FrontmatterEntry,
  type FrontmatterScalarValue,
  type FrontmatterValue,
} from '../../../engines/markdown/frontmatterEngine'

interface MarkdownPropertiesPanelProps {
  entries: FrontmatterEntry[]
  wikiLinkLookup: MarkdownWikiLinkLookup
  onAddProperty: (entry: FrontmatterEntry) => void
  onOpenLinkedFile: (filePath: string) => void
}

function getPropertyIcon(value: FrontmatterValue, key: string) {
  if (key.toLowerCase() === 'tags') {
    return Tag
  }

  if (Array.isArray(value)) {
    return List
  }

  if (typeof value === 'number') {
    return Binary
  }

  return Hash
}

function renderWikiLinkedText(
  value: string,
  lookup: MarkdownWikiLinkLookup,
  onOpenLinkedFile: (filePath: string) => void,
  keyBase: string,
): ReactNode {
  const matches = findWikiLinkMatches(value)
  if (matches.length === 0) {
    return <span>{value}</span>
  }

  const chunks: ReactNode[] = []
  let cursor = 0

  matches.forEach((match, index) => {
    if (match.startOffset > cursor) {
      chunks.push(
        <Fragment key={`${keyBase}-text-${index}`}>
          {value.slice(cursor, match.startOffset)}
        </Fragment>,
      )
    }

    const target = resolveWikiLinkTarget(lookup, match.reference)
    if (target) {
      chunks.push(
        <button
          key={`${keyBase}-link-${index}`}
          type="button"
          className="notia-properties-wikilink"
          onClick={() => onOpenLinkedFile(target.path)}
        >
          {match.displayLabel}
        </button>,
      )
    } else {
      chunks.push(
        <span key={`${keyBase}-broken-${index}`} className="notia-properties-wikilink notia-properties-wikilink--broken">
          {match.displayLabel}
        </span>,
      )
    }

    cursor = match.endOffset
  })

  if (cursor < value.length) {
    chunks.push(<Fragment key={`${keyBase}-tail`}>{value.slice(cursor)}</Fragment>)
  }

  return chunks
}

function renderScalarPropertyValue(
  value: FrontmatterScalarValue,
  lookup: MarkdownWikiLinkLookup,
  onOpenLinkedFile: (filePath: string) => void,
  keyBase: string,
): ReactNode {
  if (value === '') {
    return <span className="notia-properties-empty">Empty</span>
  }

  if (value === null) {
    return <span>null</span>
  }

  if (typeof value === 'string') {
    return renderWikiLinkedText(value, lookup, onOpenLinkedFile, keyBase)
  }

  return <span>{String(value)}</span>
}

function renderPropertyValue(
  entry: FrontmatterEntry,
  lookup: MarkdownWikiLinkLookup,
  onOpenLinkedFile: (filePath: string) => void,
) {
  if (entry.key.toLowerCase() === 'tags' && Array.isArray(entry.value)) {
    if (entry.value.length === 0) {
      return <span className="notia-properties-empty">Empty</span>
    }

    return (
      <div className="notia-properties-tags">
        {entry.value.map((tagValue, index) => (
          <span key={`${entry.key}-${index}`} className="notia-properties-tag-chip">
            {String(tagValue)}
          </span>
        ))}
      </div>
    )
  }

  if (Array.isArray(entry.value)) {
    if (entry.value.length === 0) {
      return <span className="notia-properties-empty">Empty</span>
    }

    return (
      <span>
        {entry.value.map((item, index) => (
          <Fragment key={`${entry.key}-value-${index}`}>
            {index > 0 ? ', ' : null}
            {renderScalarPropertyValue(item, lookup, onOpenLinkedFile, `${entry.key}-${index}`)}
          </Fragment>
        ))}
      </span>
    )
  }

  return renderScalarPropertyValue(entry.value, lookup, onOpenLinkedFile, `${entry.key}-scalar`)
}

export function MarkdownPropertiesPanel({
  entries,
  wikiLinkLookup,
  onAddProperty,
  onOpenLinkedFile,
}: MarkdownPropertiesPanelProps) {
  const [isAddingProperty, setIsAddingProperty] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [valueInput, setValueInput] = useState('')

  const existingKeys = useMemo(() => new Set(entries.map((entry) => entry.key.toLowerCase())), [entries])

  const submitAddProperty = () => {
    const normalizedKey = keyInput.trim()
    if (!normalizedKey) {
      return
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(normalizedKey)) {
      return
    }

    if (existingKeys.has(normalizedKey.toLowerCase())) {
      return
    }

    onAddProperty({
      key: normalizedKey,
      value: parsePropertyInputValue(valueInput),
    })

    setIsAddingProperty(false)
    setKeyInput('')
    setValueInput('')
  }

  return (
    <section className="notia-properties-panel" aria-label="File properties">
      <h3>Properties</h3>
      <div className="notia-properties-list">
        {entries.map((entry) => {
          const Icon = getPropertyIcon(entry.value, entry.key)

          return (
            <div key={entry.key} className="notia-properties-row">
              <div className="notia-properties-key">
                <Icon size={14} />
                <span>{entry.key}</span>
              </div>
              <div className="notia-properties-value">
                {renderPropertyValue(entry, wikiLinkLookup, onOpenLinkedFile)}
              </div>
            </div>
          )
        })}

        {isAddingProperty ? (
          <div className="notia-properties-add-form">
            <input
              className="notia-properties-input"
              placeholder="property"
              value={keyInput}
              onChange={(event) => setKeyInput(event.currentTarget.value)}
            />
            <input
              className="notia-properties-input"
              placeholder="value"
              value={valueInput}
              onChange={(event) => setValueInput(event.currentTarget.value)}
            />
            <div className="notia-properties-add-actions">
              <button type="button" onClick={submitAddProperty}>
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingProperty(false)
                  setKeyInput('')
                  setValueInput('')
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="notia-properties-add-button"
        onClick={() => setIsAddingProperty(true)}
      >
        <Plus size={15} />
        <span>Add property</span>
      </button>
    </section>
  )
}
