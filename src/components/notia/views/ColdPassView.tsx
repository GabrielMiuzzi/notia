import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, Copy, Download, ExternalLink, Eye, EyeOff, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { ColdPassEntryView } from '../../../types/coldpass'
import { ColdPassBiometricButton } from '../ColdPassBiometricButton'
import { ColdPassBluetoothCard } from '../ColdPassBluetoothCard'
import { backendSupports } from '../../../services/transport'
import { copyColdPassSecret } from '../../../services/coldpass/coldpassStorage'
import { useNarrowContainer } from '../../../hooks/useNarrowContainer'
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
  matchesSearch,
  siteHref,
  vaultSummary,
  type HealthFilter,
} from './coldpass/coldPassFormat'
import { ColdPassHealthChip as HealthChip } from './coldpass/ColdPassHealthChip'
import { ColdPassPhoneDetail, ColdPassPhoneList } from './coldpass/ColdPassPhone'
import './coldpass/coldpass.css'

const TOAST_MS = 2600
const ICON = { size: 16, strokeWidth: 1.75 } as const
/** Width of the view below which the phone boards of the canvas apply. */
const PHONE_MAX_WIDTH = 600

interface ColdPassViewProps {
  entries: ColdPassEntryView[]
  isUnlocked: boolean
  isImportingVault?: boolean
  onCreateCredential: () => void
  onImportVault: () => void
  onEditCredential: (index: number, options?: { generate?: boolean }) => void
  onDeleteCredential: (index: number) => void
}

function ColdPassViewComponent({
  entries,
  isUnlocked,
  isImportingVault = false,
  onCreateCredential,
  onImportVault,
  onEditCredential,
  onDeleteCredential,
}: ColdPassViewProps) {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const phone = useNarrowContainer(root, PHONE_MAX_WIDTH)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<HealthFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // On a narrow view the list and the detail take turns.
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isRevealed, setIsRevealed] = useState(false)
  const [revealedHistory, setRevealedHistory] = useState<Record<string, boolean>>({})
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  // The phone list unmounts while the detail is open: where it was scrolled.
  const phoneListScrollTop = useRef(0)
  const readPhoneListScrollTop = useCallback(() => phoneListScrollTop.current, [])
  const savePhoneListScrollTop = useCallback((scrollTop: number) => {
    phoneListScrollTop.current = scrollTop
  }, [])
  // «Cambiada hace…» is relative to when the view opened.
  const [now] = useState(() => Date.now())

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const showToast = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), TOAST_MS)
  }, [])

  const copySecret = useCallback(async (text: string, copied: string) => {
    try {
      const result = await copyColdPassSecret(text)
      showToast(result ? `${copied} Se borra del portapapeles en ${result.clearsAfterSeconds} s.` : copied)
    } catch {
      showToast('No se pudo copiar al portapapeles.')
    }
  }, [showToast])

  const copyText = useCallback(async (text: string, copied: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(copied)
    } catch {
      showToast('No se pudo copiar al portapapeles.')
    }
  }, [showToast])

  const indexed = useMemo(() => entries.map((entry, index) => ({ entry, index })), [entries])
  const visible = useMemo(
    () => indexed.filter(({ entry }) => (filter === 'all' || entry.health === filter) && matchesSearch(entry, query)),
    [filter, indexed, query],
  )
  const selected = indexed.find(({ entry }) => entry.id === selectedId) ?? visible[0] ?? indexed[0] ?? null
  const counts = useMemo(() => ({
    all: entries.length,
    weak: entries.filter((entry) => entry.health === 'weak').length,
    old: entries.filter((entry) => entry.health === 'old').length,
  }), [entries])

  const select = (id: string) => {
    setSelectedId(id)
    setIsRevealed(false)
    setIsHistoryOpen(false)
    setIsDetailOpen(true)
  }

  const clearSearch = () => {
    setQuery('')
    setFilter('all')
  }

  const toggleHistoryReveal = (key: string) => {
    setRevealedHistory((current) => ({ ...current, [key]: !current[key] }))
  }

  const entry = selected?.entry ?? null
  const history = entry?.passwordHistory ?? []
  const shownHistory = isHistoryOpen ? history : history.slice(0, HISTORY_PREVIEW)
  const href = entry ? siteHref(entry.website) : null
  const site = entry ? displaySite(entry.website) : ''
  // The phone detail shows only the credential that was opened; once it is
  // gone (deleted), the list comes back.
  const opened = isDetailOpen ? indexed.find(({ entry: item }) => item.id === selectedId) ?? null : null

  if (phone) {
    return (
      <main ref={setRoot} className="notia-main cp-view cp-view--phone" data-notia-prevent-menu-close>
        {opened ? (
          <ColdPassPhoneDetail
            entry={opened.entry}
            now={now}
            isRevealed={isRevealed}
            onToggleReveal={() => setIsRevealed((current) => !current)}
            revealedHistory={revealedHistory}
            onToggleHistoryReveal={toggleHistoryReveal}
            isHistoryOpen={isHistoryOpen}
            onToggleHistory={() => setIsHistoryOpen((current) => !current)}
            onCopySecret={(text, copied) => void copySecret(text, copied)}
            onCopyText={(text, copied) => void copyText(text, copied)}
            onBack={() => {
              setIsDetailOpen(false)
              setIsRevealed(false)
            }}
            onEdit={(options) => onEditCredential(opened.index, options)}
            onDelete={() => onDeleteCredential(opened.index)}
          />
        ) : (
          <ColdPassPhoneList
            summary={isUnlocked ? vaultSummary(entries, { short: true }) : 'ColdPass está bloqueado'}
            isUnlocked={isUnlocked}
            isImportingVault={isImportingVault}
            hasEntries={entries.length > 0}
            rows={visible.map(({ entry: item }) => item)}
            counts={counts}
            query={query}
            onQueryChange={setQuery}
            filter={filter}
            onFilterChange={setFilter}
            onClearSearch={clearSearch}
            onSelect={select}
            onCreate={onCreateCredential}
            onImport={onImportVault}
            onToast={showToast}
            readScrollTop={readPhoneListScrollTop}
            onScrollTopChange={savePhoneListScrollTop}
          />
        )}
        {toast ? (
          <div className="cp-toast" role="status" data-screen={opened ? 'detail' : 'list'}>
            <Check size={18} strokeWidth={2} aria-hidden="true" />
            {toast}
          </div>
        ) : null}
      </main>
    )
  }

  return (
    <main ref={setRoot} className="notia-main cp-view" data-notia-prevent-menu-close>
      <div className="cp-wrap">
        <header className="cp-header">
          <div className="cp-header__intro">
            <h1>Contraseñas</h1>
            <p>{isUnlocked ? vaultSummary(entries) : 'ColdPass está bloqueado'}</p>
          </div>
          <div className="cp-search">
            <Search {...ICON} size={18} aria-hidden="true" />
            <input
              type="search"
              aria-label="Buscar credenciales"
              placeholder="Buscar por nombre, sitio, usuario o notas"
              value={query}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="cp-header__actions">
            {isUnlocked && backendSupports('coldpass_biometric_status') ? <ColdPassBiometricButton onChanged={showToast} /> : null}
            {backendSupports('coldpass_pick_csv_import') ? (
              <button type="button" className="cp-btn cp-btn--ghost" onClick={onImportVault} disabled={!isUnlocked || isImportingVault}>
                <Download {...ICON} size={18} aria-hidden="true" />
                {isImportingVault ? 'Importando…' : 'Importar vault'}
              </button>
            ) : null}
            <button type="button" className="cp-btn cp-btn--primary" onClick={onCreateCredential} disabled={!isUnlocked}>
              <Plus size={18} strokeWidth={2} aria-hidden="true" />
              Nueva credencial
            </button>
          </div>
        </header>

        {backendSupports('coldpass_bluetooth_status') ? <ColdPassBluetoothCard onCopied={showToast} /> : null}

        <div className="cp-split" data-detail-open={isDetailOpen && Boolean(entry)}>
          <nav className="cp-list" aria-label="Credenciales">
            <div className="cp-filters">
              {HEALTH_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="cp-chip"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                  <span className="cp-chip__count">{counts[item.id]}</span>
                </button>
              ))}
            </div>
            <div className="cp-rows">
              {visible.map(({ entry: item }) => (
                <button
                  key={item.id}
                  type="button"
                  className="cp-row"
                  aria-pressed={item.id === entry?.id}
                  onClick={() => select(item.id)}
                >
                  <span className="cp-row__tile" aria-hidden="true">{credentialInitial(item)}</span>
                  <span className="cp-row__text">
                    <span className="cp-row__name">{item.name || 'Sin nombre'}</span>
                    <span className="cp-row__sub">{displaySite(item.website) || item.username || 'Sin sitio'}</span>
                  </span>
                  <HealthChip health={item.health} />
                </button>
              ))}
              {isUnlocked && entries.length === 0 ? (
                <div className="cp-empty">
                  <p>Todavía no hay credenciales. Guardá la primera o importá un vault en CSV.</p>
                  <button type="button" className="cp-btn cp-btn--ghost cp-btn--small" onClick={onCreateCredential}>Nueva credencial</button>
                </div>
              ) : null}
              {isUnlocked && entries.length > 0 && visible.length === 0 ? (
                <div className="cp-empty">
                  <p>Ninguna credencial coincide con la búsqueda o el filtro.</p>
                  <button type="button" className="cp-btn cp-btn--ghost cp-btn--small" onClick={clearSearch}>Limpiar búsqueda</button>
                </div>
              ) : null}
              {!isUnlocked ? (
                <div className="cp-empty"><p>ColdPass está bloqueado. Desbloquealo con la contraseña del Owner.</p></div>
              ) : null}
            </div>
          </nav>

          <section className="cp-detail" aria-label="Detalle de la credencial">
            {entry && selected ? (
              <>
                <button type="button" className="cp-back" onClick={() => setIsDetailOpen(false)}>
                  <ArrowLeft {...ICON} aria-hidden="true" />
                  Credenciales
                </button>
                <div className="cp-detail__head">
                  <span className="cp-detail__tile" aria-hidden="true">{credentialInitial(entry)}</span>
                  <div className="cp-detail__title">
                    <h2>{entry.name || 'Sin nombre'}</h2>
                    {href ? (
                      <a className="cp-site" href={href} target="_blank" rel="noopener noreferrer">
                        {site}
                        <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                      </a>
                    ) : site ? <span className="cp-site">{site}</span> : null}
                  </div>
                  <button type="button" className="cp-btn cp-btn--ghost" onClick={() => onEditCredential(selected.index)}>
                    <Pencil {...ICON} aria-hidden="true" />
                    Editar
                  </button>
                  <button type="button" className="cp-icon cp-icon--danger" aria-label="Eliminar credencial" onClick={() => onDeleteCredential(selected.index)}>
                    <Trash2 {...ICON} size={18} aria-hidden="true" />
                  </button>
                </div>

                <div className="cp-detail__grid">
                  <div className="cp-detail__col">
                    <section className="cp-card cp-card--password" aria-label="Contraseña">
                      <div className="cp-card__row">
                        <h3 className="cp-card__label">Contraseña</h3>
                        <HealthChip health={entry.health} />
                        <span className="cp-muted">{formatChanged(entry.passwordChangedAt, now)}</span>
                      </div>
                      <div className="cp-password">
                        <span className="cp-password__value cp-mono">{isRevealed ? entry.password || 'Sin contraseña' : MASK}</span>
                        <button
                          type="button"
                          className="cp-icon"
                          aria-label={isRevealed ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                          onClick={() => setIsRevealed((current) => !current)}
                        >
                          {isRevealed ? <EyeOff {...ICON} size={18} aria-hidden="true" /> : <Eye {...ICON} size={18} aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          className="cp-btn cp-btn--primary"
                          disabled={!entry.password}
                          onClick={() => void copySecret(entry.password, 'Contraseña copiada.')}
                        >
                          <Copy size={16} strokeWidth={2} aria-hidden="true" />
                          Copiar
                        </button>
                      </div>
                      {entry.health === 'weak' ? (
                        <div className="cp-alert" data-tone="weak">
                          <p>Es corta y fácil de adivinar. Reemplazala por una generada.</p>
                          <button type="button" className="cp-btn cp-btn--ghost cp-btn--small" onClick={() => onEditCredential(selected.index, { generate: true })}>Generar nueva</button>
                        </div>
                      ) : null}
                      {entry.health === 'old' ? (
                        <div className="cp-alert" data-tone="old">
                          <p>Tiene más de un año sin cambios. Conviene rotarla.</p>
                          <button type="button" className="cp-btn cp-btn--ghost cp-btn--small" onClick={() => onEditCredential(selected.index, { generate: true })}>Generar nueva</button>
                        </div>
                      ) : null}
                    </section>

                    <section className="cp-card cp-card--access" aria-label="Acceso">
                      <div className="cp-field">
                        <span className="cp-field__label">Usuario</span>
                        <span className={entry.username ? 'cp-field__value' : 'cp-field__value cp-muted'}>{entry.username || 'Sin usuario'}</span>
                        {entry.username ? (
                          <button type="button" className="cp-icon" aria-label="Copiar usuario" onClick={() => void copyText(entry.username, 'Usuario copiado.')}>
                            <Copy {...ICON} aria-hidden="true" />
                          </button>
                        ) : <span />}
                      </div>
                      <div className="cp-field">
                        <span className="cp-field__label">Usuario secundario</span>
                        <span className={entry.secondaryUsername ? 'cp-field__value' : 'cp-field__value cp-muted'}>{entry.secondaryUsername || 'Sin usuario secundario'}</span>
                        {entry.secondaryUsername ? (
                          <button type="button" className="cp-icon" aria-label="Copiar usuario secundario" onClick={() => void copyText(entry.secondaryUsername, 'Usuario secundario copiado.')}>
                            <Copy {...ICON} aria-hidden="true" />
                          </button>
                        ) : <span />}
                      </div>
                      <div className="cp-field">
                        <span className="cp-field__label">Sitio web</span>
                        <span className={site ? 'cp-field__value' : 'cp-field__value cp-muted'}>{site || 'Sin sitio web'}</span>
                        {site ? (
                          <button type="button" className="cp-icon" aria-label="Copiar sitio web" onClick={() => void copyText(entry.website.trim(), 'Sitio web copiado.')}>
                            <Copy {...ICON} aria-hidden="true" />
                          </button>
                        ) : <span />}
                      </div>
                    </section>
                  </div>

                  <div className="cp-detail__col">
                    <section className="cp-card" aria-label="Historial de contraseñas">
                      <div className="cp-card__heading">
                        <h3>Historial</h3>
                        <span className="cp-muted">{historyCount(history.length)}</span>
                      </div>
                      {history.length > 0 ? (
                        <div className="cp-history" data-open={isHistoryOpen && history.length > 5}>
                          {shownHistory.map((record, historyIndex) => {
                            const key = `${entry.id}-${historyIndex}`
                            const revealed = Boolean(revealedHistory[key])
                            return (
                              <div key={key} className="cp-history__item">
                                <div className="cp-history__text">
                                  <span className="cp-history__value cp-mono">{revealed ? record.password : MASK}</span>
                                  <span className="cp-history__date">{formatReplaced(record.replacedAt)}</span>
                                </div>
                                <button
                                  type="button"
                                  className="cp-icon"
                                  aria-label={revealed ? 'Ocultar contraseña anterior' : 'Mostrar contraseña anterior'}
                                  onClick={() => toggleHistoryReveal(key)}
                                >
                                  {revealed ? <EyeOff {...ICON} aria-hidden="true" /> : <Eye {...ICON} aria-hidden="true" />}
                                </button>
                                <button
                                  type="button"
                                  className="cp-icon"
                                  aria-label="Copiar contraseña anterior"
                                  onClick={() => void copySecret(record.password, 'Contraseña anterior copiada.')}
                                >
                                  <Copy {...ICON} aria-hidden="true" />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="cp-note cp-muted">Sin contraseñas anteriores. Cuando cambies esta, la anterior queda guardada acá.</p>
                      )}
                      {history.length > HISTORY_PREVIEW ? (
                        <button
                          type="button"
                          className="cp-btn cp-btn--ghost cp-btn--block"
                          aria-expanded={isHistoryOpen}
                          onClick={() => setIsHistoryOpen((current) => !current)}
                        >
                          {historyToggleLabel(isHistoryOpen, history.length)}
                          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="cp-chevron" data-open={isHistoryOpen} />
                        </button>
                      ) : null}
                    </section>

                    <section className="cp-card cp-card--notes" aria-label="Notas">
                      <h3 className="cp-card__title">Notas</h3>
                      <p className={entry.notes ? 'cp-note cp-notes' : 'cp-note cp-muted'}>{entry.notes || 'Sin notas.'}</p>
                    </section>
                  </div>
                </div>
              </>
            ) : (
              <div className="cp-detail__empty">
                <p className="cp-muted">{isUnlocked ? 'Elegí o creá una credencial para ver su detalle.' : 'El detalle aparece al desbloquear ColdPass.'}</p>
              </div>
            )}
          </section>
        </div>
      </div>

      {toast ? (
        <div className="cp-toast" role="status">
          <Check size={18} strokeWidth={2} aria-hidden="true" />
          {toast}
        </div>
      ) : null}
    </main>
  )
}

export const ColdPassView = memo(ColdPassViewComponent)
ColdPassView.displayName = 'ColdPassView'
