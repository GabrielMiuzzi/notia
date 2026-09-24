import { useId, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Binary, Calendar, ChevronRight, Hash, Link2, ListChecks, Plus, SquareCheck, Type, X, type LucideIcon } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import type { MarkdownWikiLinkLookup } from '../../../engines/markdown/wikiLinkEngine'
import type { FrontmatterEntry, FrontmatterValue } from '../../../engines/markdown/frontmatterEngine'
import type { LibraryContext } from '../../../services/contexts/libraryContexts'
import { PropertyValue } from './markdown/properties/PropertyValue'
import {
  NEW_PROPERTY_TYPES,
  inferPropertyKind,
  isContextKey,
  isProtectedKey,
  summarizeProperties,
  validatePropertyKey,
  type PropertyKind,
} from './markdown/properties/propertyKinds'

const OPEN_STORAGE_KEY = 'notia.markdown.propertiesOpen'

interface MarkdownPropertiesPanelProps {
  entries: FrontmatterEntry[]
  wikiLinkLookup: MarkdownWikiLinkLookup
  libraryId?: string
  onAddProperty: (entry: FrontmatterEntry) => void
  onEditProperty: (key: string, value: FrontmatterValue) => void
  onDeleteProperty: (key: string) => void
  onOpenLinkedFile: (filePath: string) => void
  /** Creates a note next to this one for a link property; resolves to an error message or `null`. */
  onCreateLinkedNote?: (title: string) => Promise<string | null>
  contexts?: readonly LibraryContext[]
  lockedContextTag?: string
}

const KIND_ICONS: Record<PropertyKind, LucideIcon> = {
  context: Hash,
  noteLink: Link2,
  timestamp: Calendar,
  date: Calendar,
  checkbox: SquareCheck,
  number: Binary,
  tags: ListChecks,
  text: Type,
}

function iconFor(key: string, kind: PropertyKind): LucideIcon {
  if (key.toLowerCase() === 'nextpage') return ArrowRight
  if (key.toLowerCase() === 'previouspage') return ArrowLeft
  return KIND_ICONS[kind]
}

/** The panel remembers whether it was folded, on this device only. */
function readStoredOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function storeOpen(isOpen: boolean): void {
  try {
    window.localStorage.setItem(OPEN_STORAGE_KEY, String(isOpen))
  } catch {
    // Some WebViews disable localStorage; the panel just opens unfolded.
  }
}

function AddPropertyForm({
  existingKeys,
  onAdd,
  onCancel,
}: {
  existingKeys: ReadonlySet<string>
  onAdd: (key: string, type: typeof NEW_PROPERTY_TYPES[number]) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()
  const choose = (type: typeof NEW_PROPERTY_TYPES[number]) => {
    const key = name.trim()
    const failure = validatePropertyKey(key, existingKeys)
    if (failure) {
      setError(failure)
      return
    }
    onAdd(key, type)
  }
  return (
    <div className="notia-properties-add-form">
      <input
        className="notia-properties-input notia-properties-input--active"
        value={name}
        placeholder="Nombre de la propiedad"
        aria-label="Nombre de la propiedad"
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        autoFocus
        onChange={(event) => {
          setName(event.currentTarget.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && NEW_PROPERTY_TYPES[0]) {
            event.preventDefault()
            choose(NEW_PROPERTY_TYPES[0])
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="notia-properties-type-menu" role="group" aria-label="Tipo de la propiedad">
        {NEW_PROPERTY_TYPES.map((type) => (
          <NotiaButton key={type.kind} variant="ghost" className="notia-properties-type-option" onClick={() => choose(type)}>
            <span className="notia-properties-type-glyph" aria-hidden="true">{type.glyph}</span>
            {type.label}
          </NotiaButton>
        ))}
      </div>
      {error ? <p id={errorId} className="notia-properties-error" role="alert">{error}</p> : null}
      <NotiaButton variant="ghost" className="notia-properties-add-cancel" onClick={onCancel}>Cancelar</NotiaButton>
    </div>
  )
}

export function MarkdownPropertiesPanel({
  entries,
  wikiLinkLookup,
  libraryId,
  onAddProperty,
  onEditProperty,
  onDeleteProperty,
  onOpenLinkedFile,
  onCreateLinkedNote,
  contexts = [],
  lockedContextTag,
}: MarkdownPropertiesPanelProps) {
  const [isOpen, setIsOpen] = useState(readStoredOpen)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  // A new «Nota» property is empty until it links one, which reads as text.
  const [kindOverrides, setKindOverrides] = useState<Record<string, PropertyKind>>({})
  const cardId = useId()

  const existingKeys = useMemo(() => new Set(entries.map((entry) => entry.key.toLowerCase())), [entries])
  const summary = useMemo(() => summarizeProperties(entries), [entries])

  const toggleOpen = () => {
    setIsOpen((current) => {
      storeOpen(!current)
      return !current
    })
    setEditingKey(null)
    setIsAdding(false)
  }

  const addProperty = (key: string, type: typeof NEW_PROPERTY_TYPES[number]) => {
    onAddProperty({ key, value: type.initialValue() })
    setKindOverrides((current) => ({ ...current, [key]: type.kind }))
    setIsAdding(false)
    setEditingKey(type.kind === 'checkbox' ? null : key)
  }

  return (
    <section className="notia-properties" aria-label="Propiedades del archivo">
      <div className="notia-properties-summary">
        <NotiaButton
          variant="ghost"
          className="notia-properties-toggle"
          aria-expanded={isOpen}
          aria-controls={cardId}
          onClick={toggleOpen}
        >
          <ChevronRight size={12} strokeWidth={2.4} className="notia-properties-chevron" aria-hidden="true" />
          Propiedades
          <span className="notia-properties-count">{entries.length}</span>
        </NotiaButton>
        {!isOpen && (summary.context || summary.date) ? (
          <div className="notia-properties-summary-values">
            <span className="notia-properties-summary-divider" aria-hidden="true" />
            {summary.context ? <span className="notia-properties-chip notia-properties-chip--small">{summary.context}</span> : null}
            {summary.date ? <span className="notia-properties-summary-date">{summary.date}</span> : null}
          </div>
        ) : null}
      </div>

      {isOpen ? (
        <div className="notia-properties-card" id={cardId}>
          {entries.map((entry) => {
            const kind = kindOverrides[entry.key] && entry.value === '' ? kindOverrides[entry.key] as PropertyKind : inferPropertyKind(entry)
            const Icon = iconFor(entry.key, kind)
            const isEditing = editingKey === entry.key
            const canDelete = !isProtectedKey(entry.key) && !(isContextKey(entry.key) && lockedContextTag)
            return (
              <div key={entry.key} className={`notia-properties-row${isEditing ? ' is-editing' : ''}`}>
                <div className="notia-properties-key">
                  <Icon size={15} strokeWidth={1.6} aria-hidden="true" />
                  <span>{entry.key}</span>
                </div>
                <div className="notia-properties-value">
                  <PropertyValue
                    entry={entry}
                    kind={kind}
                    isEditing={isEditing}
                    onStartEdit={() => setEditingKey(entry.key)}
                    onStopEdit={() => setEditingKey((current) => (current === entry.key ? null : current))}
                    onCommit={(value) => onEditProperty(entry.key, value)}
                    wikiLinkLookup={wikiLinkLookup}
                    onOpenLinkedFile={onOpenLinkedFile}
                    libraryId={libraryId}
                    contexts={contexts}
                    lockedContextTag={lockedContextTag}
                    onCreateLinkedNote={onCreateLinkedNote}
                  />
                </div>
                {canDelete ? (
                  <NotiaButton
                    variant="ghost"
                    className="notia-properties-delete-button"
                    aria-label={`Quitar la propiedad ${entry.key}`}
                    title="Quitar la propiedad"
                    onClick={() => onDeleteProperty(entry.key)}
                  >
                    <X size={14} aria-hidden="true" />
                  </NotiaButton>
                ) : <span aria-hidden="true" />}
              </div>
            )
          })}
          {entries.length > 0 ? <span className="notia-properties-divider" aria-hidden="true" /> : null}
          {isAdding ? (
            <AddPropertyForm existingKeys={existingKeys} onAdd={addProperty} onCancel={() => setIsAdding(false)} />
          ) : (
            <NotiaButton variant="ghost" className="notia-properties-add-button" onClick={() => setIsAdding(true)}>
              <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
              Agregar propiedad
            </NotiaButton>
          )}
        </div>
      ) : null}
    </section>
  )
}
