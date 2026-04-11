import { useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, History, Pencil, Search, Trash2, X } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import type { ColdPassEntry } from '../../../types/coldpass'
import { useSubmenuEngine } from '../../../hooks/useSubmenuEngine'
import { NotiaSubmenuPanel } from '../NotiaSubmenuPanel'
import { ColdPassBluetoothCard } from '../ColdPassBluetoothCard'

const COLDPASS_COLUMNS = [
  { id: 'name', label: 'name', width: '14%' },
  { id: 'website', label: 'website', width: '18%' },
  { id: 'username', label: 'username', width: '16%' },
  { id: 'secondary_username', label: 'secondary_username', width: '16%' },
  { id: 'password', label: 'password', width: '16%' },
  { id: 'notes', label: 'notes', width: '14%' },
  { id: 'actions', label: 'acciones', width: '6%' },
] as const

interface ColdPassViewProps {
  entries: ColdPassEntry[]
  isUnlocked: boolean
  isImportingVault?: boolean
  onCreateCredential: () => void
  onImportVault: () => void
  onEditCredential: (index: number) => void
  onDeleteCredential: (index: number) => void
}

export function ColdPassView({
  entries,
  isUnlocked,
  isImportingVault = false,
  onCreateCredential,
  onImportVault,
  onEditCredential,
  onDeleteCredential,
}: ColdPassViewProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({})
  const [copiedPasswordKey, setCopiedPasswordKey] = useState<string | null>(null)
  const [historyMenuState, setHistoryMenuState] = useState<{
    entryKey: string
    top: number
    left: number
  } | null>(null)
  const [copiedHistoryKey, setCopiedHistoryKey] = useState<string | null>(null)
  const [visibleHistoryPasswords, setVisibleHistoryPasswords] = useState<Record<string, boolean>>({})
  const { triggerRef: historyTriggerRef, panelRef: historyPanelRef } = useSubmenuEngine<
    HTMLButtonElement,
    HTMLDivElement
  >({
    open: Boolean(historyMenuState),
    onClose: () => {
      setHistoryMenuState(null)
    },
  })

  const buildEntryKey = (entry: ColdPassEntry, index: number): string => entry.id || `${entry.name}-${entry.username}-${index}`
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const filteredEntries = entries
    .map((entry, index) => ({
      entry,
      originalIndex: index,
    }))
    .filter(({ entry }) => (
      !normalizedSearchQuery
      || [
        entry.name,
        entry.website,
        entry.username,
        entry.secondaryUsername,
        entry.password,
        entry.notes,
      ].some((value) => value.toLowerCase().includes(normalizedSearchQuery))
    ))

  const handleCopyPassword = async (entryKey: string, password: string) => {
    await navigator.clipboard.writeText(password)
    setCopiedPasswordKey(entryKey)
    window.setTimeout(() => {
      setCopiedPasswordKey((current) => (current === entryKey ? null : current))
    }, 1200)
  }

  const handleCopyHistoryPassword = async (historyKey: string, password: string) => {
    await navigator.clipboard.writeText(password)
    setCopiedHistoryKey(historyKey)
    window.setTimeout(() => {
      setCopiedHistoryKey((current) => (current === historyKey ? null : current))
    }, 1200)
  }

  useEffect(() => {
    if (!historyMenuState) {
      return
    }

    const handleViewportChange = () => {
      setHistoryMenuState(null)
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [historyMenuState])

  return (
    <main className="notia-main notia-coldpass-view" data-notia-prevent-menu-close>
      <section className="notia-coldpass-hero" data-notia-prevent-menu-close>
        <ColdPassBluetoothCard />
        <div className="notia-coldpass-actions" data-notia-prevent-menu-close>
          <NotiaButton variant="primary" onClick={onCreateCredential} disabled={!isUnlocked}>Nueva credencial</NotiaButton>
          <NotiaButton variant="secondary" onClick={onImportVault} disabled={!isUnlocked || isImportingVault}>
            {isImportingVault ? 'Importando...' : 'Importar vault'}
          </NotiaButton>
        </div>
        <label className="notia-coldpass-search-bar" aria-label="Buscar credenciales" data-notia-prevent-menu-close>
          <Search size={16} />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value)
            }}
            placeholder="Buscar por nombre, sitio, usuario, password o notas..."
            spellCheck={false}
          />
          {searchQuery ? (
            <NotiaButton
              type="button"
              size="icon"
              variant="ghost"
              className="notia-coldpass-search-clear"
              title="Limpiar busqueda"
              onClick={() => {
                setSearchQuery('')
              }}
            >
              <X size={16} />
            </NotiaButton>
          ) : null}
        </label>
        <div className="notia-coldpass-table-shell">
          <div className="notia-coldpass-table-scroll">
            <table className="notia-coldpass-table">
              <colgroup>
                {COLDPASS_COLUMNS.map((column) => (
                  <col key={column.id} style={{ width: column.width }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {COLDPASS_COLUMNS.map((column) => (
                    <th key={column.id} scope="col">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEntries.length > 0 ? filteredEntries.map(({ entry, originalIndex }) => (
                  <tr key={buildEntryKey(entry, originalIndex)}>
                    <td>{entry.name}</td>
                    <td>{entry.website}</td>
                    <td>{entry.username}</td>
                    <td>{entry.secondaryUsername}</td>
                    <td>
                      <div className="notia-coldpass-password-cell">
                        <span className="notia-coldpass-password-value">
                          {visiblePasswords[buildEntryKey(entry, originalIndex)]
                            ? entry.password
                            : '•'.repeat(Math.max(entry.password.length, 8))}
                        </span>
                        <div className="notia-coldpass-password-actions">
                          <NotiaButton
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="notia-coldpass-password-action"
                            title={visiblePasswords[buildEntryKey(entry, originalIndex)] ? 'Ocultar password' : 'Mostrar password'}
                            onClick={() => {
                              const entryKey = buildEntryKey(entry, originalIndex)
                              setVisiblePasswords((current) => ({
                                ...current,
                                [entryKey]: !current[entryKey],
                              }))
                            }}
                          >
                            {visiblePasswords[buildEntryKey(entry, originalIndex)] ? <EyeOff size={16} /> : <Eye size={16} />}
                          </NotiaButton>
                          <NotiaButton
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="notia-coldpass-password-action"
                            ref={historyMenuState?.entryKey === buildEntryKey(entry, originalIndex) ? historyTriggerRef : undefined}
                            title="Historial de passwords"
                            onClick={(event) => {
                              const entryKey = buildEntryKey(entry, originalIndex)
                              if (historyMenuState?.entryKey === entryKey) {
                                setHistoryMenuState(null)
                                return
                              }

                              const triggerRect = event.currentTarget.getBoundingClientRect()
                              const preferredWidth = Math.min(320, Math.max(260, window.innerWidth * 0.4))
                              const nextLeft = Math.min(
                                Math.max(12, triggerRect.right - preferredWidth),
                                window.innerWidth - preferredWidth - 12,
                              )

                              setHistoryMenuState({
                                entryKey,
                                top: triggerRect.bottom + 8,
                                left: nextLeft,
                              })
                            }}
                          >
                            <History size={16} />
                          </NotiaButton>
                          <NotiaButton
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="notia-coldpass-password-action"
                            title="Copiar password"
                            onClick={() => {
                              void handleCopyPassword(buildEntryKey(entry, originalIndex), entry.password)
                            }}
                          >
                            {copiedPasswordKey === buildEntryKey(entry, originalIndex) ? <Check size={16} /> : <Copy size={16} />}
                          </NotiaButton>
                        </div>
                      </div>
                    </td>
                    <td>{entry.notes}</td>
                    <td>
                      <div className="notia-coldpass-row-actions">
                        <NotiaButton
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="notia-coldpass-password-action"
                          title="Editar credencial"
                          onClick={() => {
                            onEditCredential(originalIndex)
                          }}
                        >
                          <Pencil size={16} />
                        </NotiaButton>
                        <NotiaButton
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="notia-coldpass-password-action"
                          title="Eliminar credencial"
                          onClick={() => {
                            onDeleteCredential(originalIndex)
                          }}
                        >
                          <Trash2 size={16} />
                        </NotiaButton>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td className="notia-coldpass-table-empty" colSpan={COLDPASS_COLUMNS.length}>
                      {isUnlocked
                        ? normalizedSearchQuery
                          ? 'No se encontraron credenciales para esa busqueda.'
                          : 'No hay credenciales todavia.'
                        : 'ColdPass esta bloqueado.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      {historyMenuState ? (
        <NotiaSubmenuPanel
          ref={historyPanelRef}
          className="notia-coldpass-password-history-panel"
          style={{ top: `${historyMenuState.top}px`, left: `${historyMenuState.left}px` }}
        >
          <div className="notia-coldpass-password-history-title">Historial</div>
          {entries.find((entry, index) => buildEntryKey(entry, index) === historyMenuState.entryKey)?.passwordHistory.length ? (
            <div className="notia-coldpass-password-history-list">
              {entries
                .find((entry, index) => buildEntryKey(entry, index) === historyMenuState.entryKey)!
                .passwordHistory.map((password, historyIndex) => {
                  const historyKey = `${historyMenuState.entryKey}-${historyIndex}`
                  return (
                    <div key={historyKey} className="notia-coldpass-password-history-item">
                      <span className="notia-coldpass-password-history-value">
                        {visibleHistoryPasswords[historyKey]
                          ? password
                          : '•'.repeat(Math.max(password.length, 8))}
                      </span>
                      <div className="notia-coldpass-password-history-actions">
                        <NotiaButton
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="notia-coldpass-password-action"
                          title={visibleHistoryPasswords[historyKey] ? 'Ocultar password historica' : 'Mostrar password historica'}
                          onClick={() => {
                            setVisibleHistoryPasswords((current) => ({
                              ...current,
                              [historyKey]: !current[historyKey],
                            }))
                          }}
                        >
                          {visibleHistoryPasswords[historyKey] ? <EyeOff size={16} /> : <Eye size={16} />}
                        </NotiaButton>
                        <NotiaButton
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="notia-coldpass-password-action"
                          title="Copiar password historica"
                          onClick={() => {
                            void handleCopyHistoryPassword(historyKey, password)
                          }}
                        >
                          {copiedHistoryKey === historyKey ? <Check size={16} /> : <Copy size={16} />}
                        </NotiaButton>
                      </div>
                    </div>
                  )
                })}
            </div>
          ) : (
            <div className="notia-coldpass-password-history-empty">
              No hay passwords anteriores.
            </div>
          )}
        </NotiaSubmenuPanel>
      ) : null}
    </main>
  )
}
