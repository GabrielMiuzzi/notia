import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Lock, Pencil, Plus, X } from 'lucide-react'
import { NotiaButton } from '../../../../common/NotiaButton'
import {
  findWikiLinkMatches,
  resolveWikiLinkTarget,
  type MarkdownWikiLinkLookup,
} from '../../../../../engines/markdown/wikiLinkEngine'
import {
  formatFrontmatterValue,
  parsePropertyInputValue,
  type FrontmatterEntry,
  type FrontmatterScalarValue,
  type FrontmatterValue,
} from '../../../../../engines/markdown/frontmatterEngine'
import type { LibraryContext } from '../../../../../services/contexts/libraryContexts'
import { NoteLinkInput } from './NoteLinkInput'
import {
  EMPTY_PAGE_LINK,
  contextLabel,
  formatPropertyDate,
  formatPropertyDateTime,
  isEmptyNoteLink,
  isPageLinkKey,
  isProtectedKey,
  stripWikiLink,
  type PropertyKind,
} from './propertyKinds'

export interface PropertyValueProps {
  entry: FrontmatterEntry
  kind: PropertyKind
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  onCommit: (value: FrontmatterValue) => void
  wikiLinkLookup: MarkdownWikiLinkLookup
  onOpenLinkedFile: (filePath: string) => void
  libraryId?: string
  contexts: readonly LibraryContext[]
  lockedContextTag?: string
  onCreateLinkedNote?: (title: string) => Promise<string | null>
}

function renderLinkedText(
  value: string,
  lookup: MarkdownWikiLinkLookup,
  onOpenLinkedFile: (filePath: string) => void,
  keyBase: string,
): ReactNode {
  const matches = findWikiLinkMatches(value)
  if (matches.length === 0) return value
  const chunks: ReactNode[] = []
  let cursor = 0
  matches.forEach((match, index) => {
    if (match.startOffset > cursor) {
      chunks.push(<Fragment key={`${keyBase}-text-${index}`}>{value.slice(cursor, match.startOffset)}</Fragment>)
    }
    const target = resolveWikiLinkTarget(lookup, match.reference)
    chunks.push(target ? (
      <NotiaButton
        key={`${keyBase}-link-${index}`}
        variant="ghost"
        className="notia-properties-link"
        onClick={() => onOpenLinkedFile(target.path)}
      >
        {match.displayLabel}
      </NotiaButton>
    ) : (
      <span key={`${keyBase}-broken-${index}`} className="notia-properties-link notia-properties-link--broken" title="La nota no existe">
        {match.displayLabel}
      </span>
    ))
    cursor = match.endOffset
  })
  if (cursor < value.length) chunks.push(<Fragment key={`${keyBase}-tail`}>{value.slice(cursor)}</Fragment>)
  return chunks
}

function scalarText(value: FrontmatterScalarValue): string {
  return value === null ? 'null' : String(value)
}

/** Text input that saves on Enter or when it loses focus and cancels on Escape. */
function InlineInput({
  initialValue,
  type = 'text',
  inputMode,
  placeholder,
  onSave,
  onCancel,
}: {
  initialValue: string
  type?: 'text' | 'date'
  inputMode?: 'decimal' | 'text'
  placeholder?: string
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initialValue)
  // Enter or Escape can be followed by a blur while the input goes away.
  const isDoneRef = useRef(false)
  const finish = (action: () => void) => {
    if (isDoneRef.current) return
    isDoneRef.current = true
    action()
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      finish(() => onSave(draft))
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      finish(onCancel)
    }
  }
  return (
    <input
      className="notia-properties-input notia-properties-input--active"
      type={type}
      inputMode={inputMode}
      value={draft}
      placeholder={placeholder}
      autoFocus
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => finish(() => onSave(draft))}
    />
  )
}

export function PropertyValue({
  entry,
  kind,
  isEditing,
  onStartEdit,
  onStopEdit,
  onCommit,
  wikiLinkLookup,
  onOpenLinkedFile,
  libraryId,
  contexts,
  lockedContextTag,
  onCreateLinkedNote,
}: PropertyValueProps) {
  const { key, value } = entry
  const save = (next: FrontmatterValue) => {
    onStopEdit()
    if (JSON.stringify(next) !== JSON.stringify(value)) onCommit(next)
  }

  if (kind === 'context') {
    const label = contextLabel(value) || 'Sin contexto'
    if (lockedContextTag) {
      return (
        <span className="notia-properties-chip" title="Lo define el tablero de tareas">
          {label}
          <Lock size={11} aria-label="Lo define el tablero" />
        </span>
      )
    }
    if (contexts.length === 0) {
      return isEditing
        ? <InlineInput initialValue={typeof value === 'string' ? value : ''} onSave={(text) => save(text.trim())} onCancel={onStopEdit} />
        : <NotiaButton variant="ghost" className="notia-properties-chip notia-properties-chip--button" onClick={onStartEdit}>{label}</NotiaButton>
    }
    return (
      <div
        className="notia-properties-context"
        onBlur={(event) => {
          if (isEditing && !event.currentTarget.contains(event.relatedTarget as Node | null)) onStopEdit()
        }}
      >
        <NotiaButton
          variant="ghost"
          className="notia-properties-chip notia-properties-chip--button"
          aria-haspopup="listbox"
          aria-expanded={isEditing}
          aria-label={`Contexto: ${label}. Cambiar`}
          onClick={isEditing ? onStopEdit : onStartEdit}
        >
          {label}
        </NotiaButton>
        {isEditing ? (
          <div className="notia-properties-popover" role="listbox" aria-label="Contextos">
            {contexts.map((context) => (
              <NotiaButton
                key={context.tag}
                variant="ghost"
                role="option"
                aria-selected={context.tag === value}
                className="notia-properties-popover-option"
                onClick={() => save(context.tag)}
              >
                {contextLabel(context.tag)}
              </NotiaButton>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  if (kind === 'noteLink') {
    const emptyValue = isPageLinkKey(key) ? EMPTY_PAGE_LINK : ''
    const isEmpty = isEmptyNoteLink(value)
    if (isEditing) {
      return (
        <NoteLinkInput
          initialReference={isEmpty || typeof value !== 'string' ? '' : stripWikiLink(value)}
          libraryId={libraryId}
          onSelect={save}
          onClear={isEmpty ? undefined : () => save(emptyValue)}
          onCancel={onStopEdit}
          onCreateNote={onCreateLinkedNote}
        />
      )
    }
    if (isEmpty) {
      return (
        <NotiaButton variant="ghost" className="notia-properties-placeholder" onClick={onStartEdit}>
          Vincular nota…
        </NotiaButton>
      )
    }
    return (
      <span className="notia-properties-inline">
        <span className="notia-properties-text">{renderLinkedText(String(value), wikiLinkLookup, onOpenLinkedFile, key)}</span>
        <NotiaButton variant="ghost" className="notia-properties-icon-button" aria-label={`Cambiar ${key}`} title="Cambiar la nota" onClick={onStartEdit}>
          <Pencil size={13} aria-hidden="true" />
        </NotiaButton>
      </span>
    )
  }

  if (kind === 'checkbox') {
    return (
      <label className="notia-properties-checkbox">
        <input type="checkbox" aria-label={key} checked={value === true} onChange={(event) => onCommit(event.currentTarget.checked)} />
      </label>
    )
  }

  if (kind === 'tags') {
    const items = Array.isArray(value) ? value : []
    return (
      <div className="notia-properties-tags">
        {items.map((item, index) => (
          <span key={`${key}-${index}`} className="notia-properties-chip">
            <span>{typeof item === 'string' ? renderLinkedText(item, wikiLinkLookup, onOpenLinkedFile, `${key}-${index}`) : scalarText(item)}</span>
            <NotiaButton
              variant="ghost"
              className="notia-properties-chip-remove"
              aria-label={`Quitar ${scalarText(item)}`}
              onClick={() => onCommit(items.filter((_, itemIndex) => itemIndex !== index))}
            >
              <X size={11} aria-hidden="true" />
            </NotiaButton>
          </span>
        ))}
        {isEditing ? (
          <InlineInput
            initialValue=""
            placeholder="Nueva etiqueta"
            onSave={(text) => {
              const added = text.split(',').map((part) => part.trim()).filter(Boolean)
              save(added.length > 0 ? [...items, ...added] : items)
            }}
            onCancel={onStopEdit}
          />
        ) : (
          <NotiaButton variant="ghost" className="notia-properties-chip-add" aria-label={`Agregar a ${key}`} title="Agregar" onClick={onStartEdit}>
            <Plus size={12} aria-hidden="true" />
          </NotiaButton>
        )}
      </div>
    )
  }

  if (kind === 'timestamp') {
    const readable = formatPropertyDateTime(value)
    const display = (
      <span className="notia-properties-timestamp">
        <span>{readable ?? formatFrontmatterValue(value)}</span>
        {readable ? <span className="notia-properties-raw">{scalarText(value as FrontmatterScalarValue)}</span> : null}
      </span>
    )
    if (isProtectedKey(key)) return display
    return isEditing
      ? <InlineInput initialValue={scalarText(value as FrontmatterScalarValue)} inputMode="decimal" onSave={(text) => save(parsePropertyInputValue(text))} onCancel={onStopEdit} />
      : <NotiaButton variant="ghost" className="notia-properties-value-button" onClick={onStartEdit}>{display}</NotiaButton>
  }

  if (kind === 'date') {
    return isEditing
      ? <InlineInput type="date" initialValue={typeof value === 'string' ? value : ''} onSave={(text) => save(text || '')} onCancel={onStopEdit} />
      : (
        <NotiaButton variant="ghost" className="notia-properties-value-button" onClick={onStartEdit}>
          {formatPropertyDate(value) ?? formatFrontmatterValue(value)}
        </NotiaButton>
      )
  }

  if (isEditing) {
    const initialValue = value === '' ? '' : formatFrontmatterValue(value)
    return (
      <InlineInput
        initialValue={initialValue}
        inputMode={kind === 'number' ? 'decimal' : 'text'}
        onSave={(text) => save(parsePropertyInputValue(text))}
        onCancel={onStopEdit}
      />
    )
  }
  return (
    <span className="notia-properties-inline">
      {value === '' || value === null ? (
        <NotiaButton variant="ghost" className="notia-properties-placeholder" onClick={onStartEdit}>Vacío</NotiaButton>
      ) : (
        <>
          <span className="notia-properties-text">
            {typeof value === 'string' ? renderLinkedText(value, wikiLinkLookup, onOpenLinkedFile, key) : formatFrontmatterValue(value)}
          </span>
          <NotiaButton variant="ghost" className="notia-properties-icon-button" aria-label={`Editar ${key}`} title="Editar" onClick={onStartEdit}>
            <Pencil size={13} aria-hidden="true" />
          </NotiaButton>
        </>
      )}
    </span>
  )
}
