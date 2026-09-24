import { useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import { matchesSettingsSearch, SETTINGS_GROUPS, SETTINGS_SECTION_META, type SettingsSection } from './settingsSections'

interface SettingsNavProps {
  sections: readonly SettingsSection[]
  active: SettingsSection
  query: string
  footer: string
  onQueryChange: (query: string) => void
  onPick: (section: SettingsSection) => void
}

export function SettingsNav({ sections, active, query, footer, onQueryChange, onPick }: SettingsNavProps) {
  const groupsRef = useRef<HTMLDivElement | null>(null)

  // On narrow windows the sections are a horizontal strip: keep the open one visible.
  useEffect(() => {
    groupsRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const groups = SETTINGS_GROUPS
    .map((group) => ({
      label: group.label,
      sections: group.sections.filter((section) => sections.includes(section) && matchesSettingsSearch(section, query)),
    }))
    .filter((group) => group.sections.length > 0)

  return (
    <nav className="notia-settings-nav" aria-label="Secciones de configuración">
      <div className="notia-settings-nav-top">
        <div className="notia-settings-nav-title">Configuraciones</div>
        <label className="notia-settings-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar ajuste"
            aria-label="Buscar ajuste"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              // Esc clears the search first; the next Esc closes the window.
              if (event.key === 'Escape' && query) {
                event.stopPropagation()
                onQueryChange('')
              }
            }}
          />
        </label>
      </div>
      <div className="notia-settings-nav-groups" ref={groupsRef}>
        {groups.length === 0 ? <p className="notia-settings-nav-empty">Sin resultados para «{query.trim()}».</p> : null}
        {groups.map((group) => (
          <div key={group.label} className="notia-settings-nav-group">
            <div className="notia-settings-nav-group-label">{group.label}</div>
            {group.sections.map((section) => {
              const Icon = SETTINGS_SECTION_META[section].icon
              return (
                <NotiaButton
                  key={section}
                  className="notia-settings-nav-item"
                  aria-current={section === active ? 'page' : undefined}
                  onClick={() => onPick(section)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{section}</span>
                </NotiaButton>
              )
            })}
          </div>
        ))}
      </div>
      <div className="notia-settings-nav-footer">
        <span className="notia-settings-dot" data-tone="success" aria-hidden="true" />
        <span>{footer}</span>
      </div>
    </nav>
  )
}
