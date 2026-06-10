import { useState, useCallback, useRef, useEffect } from 'react'
import { searchWikiLinkTargets } from '../../../../engines/markdown/wikiLinkEngine'
import type { MarkdownWikiLinkTarget } from '../../../../types/views/markdownWikiLink'
import { NotiaButton } from '../../../common/NotiaButton'

const MAX_SUGGESTIONS = 10

interface WikiLinkPropertyInputProps {
  value: string
  targets: MarkdownWikiLinkTarget[]
  onChange: (value: string) => void
  onConfirm?: () => void
  onCancel?: () => void
  placeholder?: string
  autoFocus?: boolean
}

export function WikiLinkPropertyInput({
  value,
  targets,
  onChange,
  onConfirm,
  onCancel,
  placeholder,
  autoFocus,
}: WikiLinkPropertyInputProps) {
  const [menuState, setMenuState] = useState<{
    query: string
    suggestions: MarkdownWikiLinkTarget[]
    selectedIndex: number
    active: boolean
    replaceFrom: number
    replaceTo: number
  } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const detectWikiLinkQuery = useCallback(
    (inputValue: string, cursorPos: number): { query: string; replaceFrom: number; replaceTo: number } | null => {
      if (cursorPos < 2) return null
      const beforeCursor = inputValue.slice(0, cursorPos)
      const openIndex = beforeCursor.lastIndexOf('[[')
      if (openIndex < 0) return null
      const afterOpen = beforeCursor.slice(openIndex + 2)
      if (afterOpen.includes(']]')) return null
      if (afterOpen.includes('[')) return null
      return { query: afterOpen, replaceFrom: openIndex, replaceTo: cursorPos }
    },
    [],
  )

  const updateMenu = useCallback(
    (inputValue: string, cursorPos: number) => {
      const context = detectWikiLinkQuery(inputValue, cursorPos)
      if (!context || !context.query) {
        setMenuState(null)
        return
      }
      const suggestions = searchWikiLinkTargets(targets, context.query, MAX_SUGGESTIONS)
      if (suggestions.length === 0) {
        setMenuState(null)
        return
      }
      setMenuState({
        query: context.query,
        suggestions,
        selectedIndex: 0,
        active: true,
        replaceFrom: context.replaceFrom,
        replaceTo: context.replaceTo,
      })
    },
    [detectWikiLinkQuery, targets],
  )

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value
    const cursorPos = event.currentTarget.selectionStart ?? nextValue.length
    onChange(nextValue)
    updateMenu(nextValue, cursorPos)
  }

  const insertSuggestion = (index: number) => {
    if (!menuState || !inputRef.current) return
    const target = menuState.suggestions[index]
    if (!target) return
    const currentValue = value
    const replaceFrom = menuState.replaceFrom ?? currentValue.lastIndexOf('[[')
    const replaceTo = menuState.replaceTo ?? currentValue.length
    // Build the full wikilink to make it clickable in the property panel
    const replacement = `[[${target.wikiLink}]]`
    const nextValue = currentValue.slice(0, replaceFrom) + replacement + currentValue.slice(replaceTo)
    onChange(nextValue)
    setMenuState(null)
    requestAnimationFrame(() => {
      const pos = replaceFrom + replacement.length
      inputRef.current?.setSelectionRange(pos, pos)
      inputRef.current?.focus()
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!menuState || !menuState.active) {
      if (event.key === 'Enter' && onConfirm) {
        event.preventDefault()
        onConfirm()
      }
      if (event.key === 'Escape' && onCancel) {
        event.preventDefault()
        onCancel()
      }
      return
    }

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        setMenuState((prev) =>
          prev
            ? {
                ...prev,
                selectedIndex: (prev.selectedIndex + 1) % prev.suggestions.length,
              }
            : null,
        )
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        setMenuState((prev) =>
          prev
            ? {
                ...prev,
                selectedIndex:
                  (prev.selectedIndex - 1 + prev.suggestions.length) % prev.suggestions.length,
              }
            : null,
        )
        break
      }
      case 'Enter': {
        event.preventDefault()
        insertSuggestion(menuState.selectedIndex)
        break
      }
      case 'Escape': {
        event.preventDefault()
        setMenuState(null)
        break
      }
      default:
        break
    }
  }

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus()
    }
  }, [autoFocus])

  return (
    <div className="notia-wikilink-property-input-wrap">
      <input
        ref={inputRef}
        className="notia-properties-input"
        value={value}
        placeholder={placeholder}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onClick={(event) => updateMenu(value, event.currentTarget.selectionStart ?? value.length)}
      />
      {menuState && menuState.suggestions.length > 0 ? (
        <div className="notia-wikilink-property-menu" role="listbox" aria-label="Wiki link suggestions">
          {menuState.suggestions.map((target, index) => {
            const isActive = index === menuState.selectedIndex
            return (
              <NotiaButton
                key={target.path}
                role="option"
                aria-selected={isActive}
                variant={isActive ? 'primary' : 'secondary'}
                className={`notia-wikilink-property-menu-item ${isActive ? 'notia-wikilink-property-menu-item--active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  insertSuggestion(index)
                }}
              >
                <span className="notia-wikilink-menu-title">{target.title}</span>
                {target.relativePath.toLowerCase() !== target.title.toLowerCase() ||
                target.wikiLink.toLowerCase() !== target.title.toLowerCase() ? (
                  <span className="notia-wikilink-menu-path">{target.relativePath}</span>
                ) : null}
              </NotiaButton>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
