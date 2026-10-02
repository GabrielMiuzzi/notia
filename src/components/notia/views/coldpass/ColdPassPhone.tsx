import { useLayoutEffect, useRef } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Eye, EyeOff, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { ColdPassEntryView } from '../../../../types/coldpass'
import { backendSupports } from '../../../../services/transport'
import { ColdPassBiometricButton } from '../../ColdPassBiometricButton'
import { ColdPassBluetoothCard } from '../../ColdPassBluetoothCard'
import { ColdPassHealthChip } from './ColdPassHealthChip'
import {
  HEALTH_FILTERS,
  HISTORY_PREVIEW,
  MASK,
  credentialInitial,
  displaySite,
  formatChanged,
  formatReplaced,
  historyCount,
  historyToggleLabel,
  siteHref,
  type HealthFilter,
} from './coldPassFormat'

/*
 * The phone version of ColdPass (canvas «ColdPass — Gestor de contraseñas»,
 * boards «Celular — lista» and «Celular — detalle»): the list with a floating
 * «Nueva credencial», and the detail of one credential with a bar to go back.
 * They only render; ColdPassView keeps the state and the backend decides the
 * health and the dates.
 */

const ICON = { strokeWidth: 1.75 } as const

interface ColdPassPhoneListProps {
  summary: string
  isUnlocked: boolean
  isImportingVault: boolean
  /** The vault has credentials, whatever the search and the filter. */
  hasEntries: boolean
  rows: ColdPassEntryView[]
  counts: Record<HealthFilter, number>
  query: string
  onQueryChange: (query: string) => void
  filter: HealthFilter
  onFilterChange: (filter: HealthFilter) => void
  onClearSearch: () => void
  onSelect: (id: string) => void
  onCreate: () => void
  onImport: () => void
  onToast: (message: string) => void
  /** Where the list was when the detail opened, to come back to it. */
  readScrollTop: () => number
  onScrollTopChange: (scrollTop: number) => void
}

/** «Celular — lista»: header, device, search, health filters and the credentials. */
export function ColdPassPhoneList({
  summary,
  isUnlocked,
  isImportingVault,
  hasEntries,
  rows,
  counts,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  onClearSearch,
  onSelect,
  onCreate,
  onImport,
  onToast,
  readScrollTop,
  onScrollTopChange,
}: ColdPassPhoneListProps) {
  const scroller = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = readScrollTop()
  }, [readScrollTop])

  return (
    <>
      <div
        ref={scroller}
        className="cp-phone-scroll cp-phone-scroll--list"
        onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
      >
        <header className="cp-phone-head">
          <div className="cp-phone-head__intro">
            <h1>Contraseñas</h1>
            <p>{summary}</p>
          </div>
          {isUnlocked && backendSupports('coldpass_biometric_status') ? <ColdPassBiometricButton compact onChanged={onToast} /> : null}
          {backendSupports('coldpass_pick_csv_import') ? (
            <button
              type="button"
              className="cp-icon"
              aria-label={isImportingVault ? 'Importando vault…' : 'Importar vault'}
              disabled={!isUnlocked || isImportingVault}
              onClick={onImport}
            >
              {isImportingVault ? <span className="cp-spin" aria-hidden="true" /> : <Download {...ICON} size={20} aria-hidden="true" />}
            </button>
          ) : null}
        </header>

        {backendSupports('coldpass_bluetooth_status') ? <ColdPassBluetoothCard compact onCopied={onToast} /> : null}

        <div className="cp-phone-search">
          <Search {...ICON} size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Buscar credenciales"
            placeholder="Buscar"
            value={query}
            spellCheck={false}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>

        <div className="cp-phone-filters" role="group" aria-label="Filtrar por estado">
          {HEALTH_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="cp-chip"
              aria-pressed={filter === item.id}
              onClick={() => onFilterChange(item.id)}
            >
              {item.label}
              <span className="cp-chip__count">{counts[item.id]}</span>
            </button>
          ))}
        </div>

        <nav className="cp-phone-list" aria-label="Credenciales">
          {rows.map((entry) => (
            <button key={entry.id} type="button" className="cp-row" onClick={() => onSelect(entry.id)}>
              <span className="cp-row__tile" aria-hidden="true">{credentialInitial(entry)}</span>
              <span className="cp-row__text">
                <span className="cp-row__name">{entry.name || 'Sin nombre'}</span>
                <span className="cp-row__sub">{displaySite(entry.website) || entry.username || 'Sin sitio'}</span>
              </span>
              <ColdPassHealthChip health={entry.health} />
              <ChevronRight className="cp-row__chevron" size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          ))}
          {isUnlocked && !hasEntries ? (
            <div className="cp-empty">
              <p>Todavía no hay credenciales. Guardá la primera o importá un vault en CSV.</p>
              <button type="button" className="cp-btn cp-btn--ghost" onClick={onCreate}>Nueva credencial</button>
            </div>
          ) : null}
          {isUnlocked && hasEntries && rows.length === 0 ? (
            <div className="cp-empty">
              <p>Ninguna credencial coincide con la búsqueda o el filtro.</p>
              <button type="button" className="cp-btn cp-btn--ghost" onClick={onClearSearch}>Limpiar búsqueda</button>
            </div>
          ) : null}
          {!isUnlocked ? (
            <div className="cp-empty"><p>ColdPass está bloqueado. Desbloquealo con la contraseña del Owner.</p></div>
          ) : null}
        </nav>
      </div>

      <button type="button" className="cp-phone-fab" onClick={onCreate} disabled={!isUnlocked}>
        <Plus size={20} strokeWidth={2.25} aria-hidden="true" />
        Nueva credencial
      </button>
    </>
  )
}

interface ColdPassPhoneDetailProps {
  entry: ColdPassEntryView
  /** «Cambiada hace…» is relative to it. */
  now: number
  isRevealed: boolean
  onToggleReveal: () => void
  /** Revealed previous passwords, by `${entry.id}-${index}`. */
  revealedHistory: Record<string, boolean>
  onToggleHistoryReveal: (key: string) => void
  isHistoryOpen: boolean
  onToggleHistory: () => void
  /** Copies through the backend clipboard, which clears it after a while. */
  onCopySecret: (text: string, copied: string) => void
  onCopyText: (text: string, copied: string) => void
  onBack: () => void
  onEdit: (options?: { generate?: boolean }) => void
  onDelete: () => void
}

/** «Celular — detalle»: one credential, its password, access data, history and notes. */
export function ColdPassPhoneDetail({
  entry,
  now,
  isRevealed,
  onToggleReveal,
  revealedHistory,
  onToggleHistoryReveal,
  isHistoryOpen,
  onToggleHistory,
  onCopySecret,
  onCopyText,
  onBack,
  onEdit,
  onDelete,
}: ColdPassPhoneDetailProps) {
  const history = entry.passwordHistory
  const shownHistory = isHistoryOpen ? history : history.slice(0, HISTORY_PREVIEW)
  const href = siteHref(entry.website)
  const site = displaySite(entry.website)
  const fields = [
    { label: 'Usuario', value: entry.username, empty: 'Sin usuario', copy: entry.username, copied: 'Usuario copiado.' },
    {
      label: 'Usuario secundario',
      value: entry.secondaryUsername,
      empty: 'Sin usuario secundario',
      copy: entry.secondaryUsername,
      copied: 'Usuario secundario copiado.',
    },
    { label: 'Sitio web', value: site, empty: 'Sin sitio web', copy: entry.website.trim(), copied: 'Sitio web copiado.' },
  ]

  return (
    <>
      <header className="cp-phone-bar">
        <button type="button" className="cp-phone-bar__back" onClick={onBack}>
          <ChevronLeft size={22} strokeWidth={2} aria-hidden="true" />
          Contraseñas
        </button>
        <button type="button" className="cp-phone-bar__edit" onClick={() => onEdit()}>
          <Pencil {...ICON} size={18} aria-hidden="true" />
          Editar
        </button>
      </header>

      <section className="cp-phone-scroll cp-phone-scroll--detail" aria-label="Detalle de la credencial">
        <div className="cp-phone-ident">
          <span className="cp-phone-ident__tile" aria-hidden="true">{credentialInitial(entry)}</span>
          <div className="cp-phone-ident__title">
            <h2>{entry.name || 'Sin nombre'}</h2>
            {href ? (
              <a className="cp-phone-site" href={href} target="_blank" rel="noopener noreferrer">
                <span>{site}</span>
                <ExternalLink {...ICON} size={14} aria-hidden="true" />
              </a>
            ) : site ? <span className="cp-phone-site"><span>{site}</span></span> : null}
          </div>
        </div>

        <section className="cp-phone-card cp-phone-card--password" aria-label="Contraseña">
          <div className="cp-phone-card__row">
            <h3 className="cp-card__label">Contraseña</h3>
            <ColdPassHealthChip health={entry.health} />
          </div>
          <div className="cp-phone-password">
            <span className="cp-phone-password__value cp-mono">{isRevealed ? entry.password || 'Sin contraseña' : MASK}</span>
            <button
              type="button"
              className="cp-icon"
              aria-label={isRevealed ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              onClick={onToggleReveal}
            >
              {isRevealed ? <EyeOff {...ICON} size={20} aria-hidden="true" /> : <Eye {...ICON} size={20} aria-hidden="true" />}
            </button>
          </div>
          <span className="cp-phone-changed">{formatChanged(entry.passwordChangedAt, now)}</span>
          <button
            type="button"
            className="cp-phone-copy"
            disabled={!entry.password}
            onClick={() => onCopySecret(entry.password, 'Contraseña copiada.')}
          >
            <Copy size={18} strokeWidth={2} aria-hidden="true" />
            Copiar contraseña
          </button>
          {entry.health === 'weak' ? (
            <div className="cp-alert" data-tone="weak">
              <p>Es corta y fácil de adivinar. Reemplazala por una generada.</p>
              <button type="button" className="cp-btn cp-btn--ghost" onClick={() => onEdit({ generate: true })}>Generar nueva</button>
            </div>
          ) : null}
          {entry.health === 'old' ? (
            <div className="cp-alert" data-tone="old">
              <p>Tiene más de un año sin cambios. Conviene rotarla.</p>
              <button type="button" className="cp-btn cp-btn--ghost" onClick={() => onEdit({ generate: true })}>Generar nueva</button>
            </div>
          ) : null}
        </section>

        <section className="cp-phone-card cp-phone-card--access" aria-label="Acceso">
          {fields.map((field) => (
            <div key={field.label} className="cp-phone-field">
              <div className="cp-phone-field__text">
                <span className="cp-phone-field__label">{field.label}</span>
                <span className={field.value ? 'cp-phone-field__value' : 'cp-phone-field__value cp-muted'}>{field.value || field.empty}</span>
              </div>
              {field.value ? (
                <button
                  type="button"
                  className="cp-icon"
                  aria-label={`Copiar ${field.label.toLowerCase()}`}
                  onClick={() => onCopyText(field.copy, field.copied)}
                >
                  <Copy {...ICON} size={18} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
        </section>

        <section className="cp-phone-card cp-phone-card--history" aria-label="Historial de contraseñas">
          <div className="cp-card__heading">
            <h3>Historial</h3>
            <span className="cp-muted">{historyCount(history.length)}</span>
          </div>
          {shownHistory.map((record, historyIndex) => {
            const key = `${entry.id}-${historyIndex}`
            const revealed = Boolean(revealedHistory[key])
            return (
              <div key={key} className="cp-phone-history">
                <div className="cp-history__text">
                  <span className="cp-phone-history__value cp-mono">{revealed ? record.password : MASK}</span>
                  <span className="cp-history__date">{formatReplaced(record.replacedAt)}</span>
                </div>
                <button
                  type="button"
                  className="cp-icon"
                  aria-label={revealed ? 'Ocultar contraseña anterior' : 'Mostrar contraseña anterior'}
                  onClick={() => onToggleHistoryReveal(key)}
                >
                  {revealed ? <EyeOff {...ICON} size={18} aria-hidden="true" /> : <Eye {...ICON} size={18} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="cp-icon"
                  aria-label="Copiar contraseña anterior"
                  onClick={() => onCopySecret(record.password, 'Contraseña anterior copiada.')}
                >
                  <Copy {...ICON} size={18} aria-hidden="true" />
                </button>
              </div>
            )
          })}
          {history.length > HISTORY_PREVIEW ? (
            <button type="button" className="cp-btn cp-btn--ghost" aria-expanded={isHistoryOpen} onClick={onToggleHistory}>
              {historyToggleLabel(isHistoryOpen, history.length)}
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="cp-chevron" data-open={isHistoryOpen} />
            </button>
          ) : null}
          {history.length === 0 ? (
            <p className="cp-phone-note cp-muted">Sin contraseñas anteriores. Cuando cambies esta, la anterior queda guardada acá.</p>
          ) : null}
        </section>

        <section className="cp-phone-card cp-phone-card--notes" aria-label="Notas">
          <h3 className="cp-card__title">Notas</h3>
          <p className={entry.notes ? 'cp-phone-notes cp-notes' : 'cp-phone-notes cp-muted'}>{entry.notes || 'Sin notas.'}</p>
        </section>

        <button type="button" className="cp-phone-delete" onClick={onDelete}>
          <Trash2 {...ICON} size={18} aria-hidden="true" />
          Eliminar credencial
        </button>
      </section>
    </>
  )
}
