import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Folder, Plus, X } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import { SettingsBadge, SettingsCard, SettingsFooter, SettingsNotice, SettingsRow, SettingsSwitch, type SettingsTone } from './SettingsControls'
import { useAppSelector } from '../../../store/hooks'
import { selectLibraries } from '../../../features/library/librarySelectors'
import {
  openPublicSpace,
  readPublicSpaceCandidates,
  readPublicSpaces,
  savePublicSpaces,
  type PublicSpaceCandidate,
  type PublicSpaceDraft,
  type PublicSpaceItem,
  type PublicSpacesView,
} from '../../../services/publicSpaces/publicSpacesRuntime'

const POLL_MS = 4000
const MIN_PORT = 1024
const MAX_PORT = 65535

interface Status {
  tone: SettingsTone
  message: string
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function draftsOf(view: PublicSpacesView): PublicSpaceDraft[] {
  return view.spaces.map(({ id, name, libraryId, port, enabled, items }) => ({
    id,
    name,
    libraryId,
    port,
    enabled,
    items: items.map(({ path, kind }) => ({ path, kind })),
  }))
}

interface PickerProps {
  candidates: PublicSpaceCandidate[] | null
  error: string | null
  onPick: (candidate: PublicSpaceCandidate) => void
  onClose: () => void
}

/** Folders and notes with the `#Publico` context the space can add. */
function CandidatePicker({ candidates, error, onPick, onClose }: PickerProps) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = (candidates ?? []).filter((candidate) => !needle || candidate.path.toLowerCase().includes(needle))
  return (
    <div className="notia-public-space-picker">
      <div className="notia-public-space-picker-head">
        <input
          className="notia-settings-field"
          type="search"
          value={query}
          placeholder="Buscar carpetas y notas #Publico"
          aria-label="Buscar carpetas y notas con contexto #Publico"
          onChange={(event) => setQuery(event.target.value)}
        />
        <NotiaButton size="icon" variant="ghost" aria-label="Cerrar la lista" title="Cerrar" onClick={onClose}>
          <X size={16} />
        </NotiaButton>
      </div>
      {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
      {candidates === null && !error ? <div className="notia-settings-empty">Leyendo la biblioteca…</div> : null}
      {candidates !== null && shown.length === 0 ? (
        <div className="notia-settings-empty">
          {candidates.length === 0
            ? 'No hay carpetas ni notas con el contexto #Publico. Asignalo desde el explorador (clic derecho en una carpeta → Contexto de la carpeta) o en las propiedades de una nota.'
            : 'No hay más coincidencias.'}
        </div>
      ) : null}
      <ul className="notia-public-space-options" aria-label="Carpetas y notas con contexto #Publico">
        {shown.map((candidate) => (
          <li key={candidate.path}>
            <button type="button" className="notia-public-space-option" onClick={() => onPick(candidate)}>
              {candidate.kind === 'folder' ? <Folder size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
              <span className="notia-public-space-option-text">
                <span>{candidate.name}</span>
                <span className="notia-settings-path">{candidate.path}</span>
              </span>
              <span className="notia-public-space-option-kind">{candidate.kind === 'folder' ? 'Carpeta' : 'Nota'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface PublicSpacesSectionProps {
  /** Library a new space publishes. */
  libraryId: string | null
}

/**
 * «Espacios públicos» of Settings → Publicar: read-only sites, one per
 * port, with folders and notes of context `#Publico`. Rust checks the
 * ports and contexts when saving, and starts or stops each server.
 */
export function PublicSpacesSection({ libraryId }: PublicSpacesSectionProps) {
  const libraries = useAppSelector(selectLibraries)
  const [view, setView] = useState<PublicSpacesView | null>(null)
  const [drafts, setDrafts] = useState<PublicSpaceDraft[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>({ tone: 'idle', message: '' })
  const [picker, setPicker] = useState<{ spaceId: string; candidates: PublicSpaceCandidate[] | null; error: string | null } | null>(null)

  const refresh = useCallback(async (replaceDrafts: boolean) => {
    try {
      const next = await readPublicSpaces()
      setView(next)
      if (replaceDrafts) setDrafts(draftsOf(next))
    } catch (error) {
      setStatus({ tone: 'error', message: messageOf(error, 'No se pudieron leer los espacios públicos.') })
    }
  }, [])

  useEffect(() => {
    void refresh(true)
  }, [refresh])

  // The state of each server, without touching what is being edited.
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(false) }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const statusById = useMemo(() => new Map((view?.spaces ?? []).map((space) => [space.id, space])), [view])
  const libraryName = (id: string) => libraries.find((library) => library.id === id)?.name ?? 'Otra biblioteca'

  const change = (id: string, patch: Partial<PublicSpaceDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)))
    setDirty(true)
  }

  const addSpace = () => {
    if (!libraryId) return
    const used = new Set(drafts.map((draft) => draft.port))
    let port = view?.suggestedPort ?? 52490
    while (used.has(port) && port < MAX_PORT) port += 1
    setDrafts((current) => [...current, {
      id: `espacio-${Date.now().toString(36)}`,
      name: `Espacio público ${current.length + 1}`,
      libraryId,
      port,
      enabled: true,
      items: [],
    }])
    setDirty(true)
  }

  /** Asks Rust what the space can still add, given what it has now. */
  const loadCandidates = (spaceId: string, libraryId: string, items: PublicSpaceItem[]) => {
    readPublicSpaceCandidates(libraryId, items)
      .then((candidates) => setPicker((current) => (current?.spaceId === spaceId ? { ...current, candidates, error: null } : current)))
      .catch((error: unknown) => setPicker((current) => (current?.spaceId === spaceId ? { ...current, candidates: [], error: messageOf(error, 'No se pudo leer la biblioteca.') } : current)))
  }

  const openPicker = (draft: PublicSpaceDraft) => {
    setPicker({ spaceId: draft.id, candidates: null, error: null })
    loadCandidates(draft.id, draft.libraryId, draft.items)
  }

  const changeItems = (draft: PublicSpaceDraft, items: PublicSpaceItem[]) => {
    change(draft.id, { items })
    if (picker?.spaceId === draft.id) loadCandidates(draft.id, draft.libraryId, items)
  }

  const save = async () => {
    setSaving(true)
    setStatus({ tone: 'loading', message: 'Guardando y publicando…' })
    try {
      const next = await savePublicSpaces(drafts)
      setView(next)
      setDrafts(draftsOf(next))
      setDirty(false)
      const running = next.spaces.filter((space) => space.listening).length
      setStatus({ tone: 'success', message: running === 1 ? 'Guardado. 1 espacio publicado.' : `Guardado. ${running} espacios publicados.` })
    } catch (error) {
      setStatus({ tone: 'error', message: messageOf(error, 'No se pudieron guardar los espacios públicos.') })
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    if (view) setDrafts(draftsOf(view))
    setDirty(false)
    setPicker(null)
    setStatus({ tone: 'idle', message: '' })
  }

  if (view && !view.available) {
    return (
      <SettingsCard title="Espacios públicos">
        <div className="notia-settings-empty">Los espacios públicos se publican desde Notia en Windows.</div>
      </SettingsCard>
    )
  }

  return (
    <>
      <SettingsCard>
        <div className="notia-settings-block">
          <div className="notia-settings-row-label">
            <span className="notia-settings-block-title">Espacios públicos</span>
            <SettingsBadge>Solo lectura</SettingsBadge>
          </div>
          <div className="notia-settings-row-description">
            Sitios con el diseño de GitBook para leer carpetas y notas con el contexto <code>#Publico</code>. Cada espacio usa su propio puerto y es un servidor aparte. Al publicar una carpeta, el índice se arma solo con sus subcarpetas y el orden de lectura.
          </div>
          <div className="notia-public-space-actions">
            <NotiaButton onClick={addSpace} disabled={!libraryId}>
              <Plus size={16} aria-hidden="true" /> Agregar espacio público
            </NotiaButton>
          </div>
        </div>
      </SettingsCard>
      {drafts.length === 0 && view ? <div className="notia-settings-empty">Todavía no hay espacios públicos.</div> : null}
      {drafts.map((draft) => {
        const served = statusById.get(draft.id)
        const publicByPath = new Map((served?.items ?? []).map((item) => [item.path.toLowerCase(), item.public]))
        const footerTone: SettingsTone = served?.error ? 'error' : served?.listening ? 'success' : 'idle'
        const footer = served?.error
          ?? (served?.listening
            ? `Publicado · ${served.pageCount === 1 ? '1 página' : `${served.pageCount} páginas`}`
            : draft.enabled ? 'Sin publicar: guardá para iniciarlo' : 'Detenido')
        return (
          <SettingsCard key={draft.id}>
            <div className="notia-settings-block notia-public-space-head">
              <input
                className="notia-settings-field notia-public-space-name"
                value={draft.name}
                maxLength={80}
                aria-label="Nombre del espacio"
                onChange={(event) => change(draft.id, { name: event.target.value })}
              />
              <SettingsSwitch label={`Publicar ${draft.name}`} checked={draft.enabled} onChange={(enabled) => change(draft.id, { enabled })} />
            </div>
            <SettingsRow label="Puerto" htmlFor={`notia-public-space-port-${draft.id}`} description={`Biblioteca: ${libraryName(draft.libraryId)}`} inline>
              <input
                id={`notia-public-space-port-${draft.id}`}
                className="notia-settings-field notia-settings-field--number"
                type="number"
                min={MIN_PORT}
                max={MAX_PORT}
                value={draft.port}
                onChange={(event) => {
                  const port = Number(event.target.value)
                  if (Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT) change(draft.id, { port })
                }}
              />
            </SettingsRow>
            {served?.url ? (
              <SettingsRow label="URL" description="Desde otro equipo de la red, permití Notia en el Firewall de Windows para redes privadas.">
                <span className="notia-settings-path">{served.url}</span>
              </SettingsRow>
            ) : null}
            <div className="notia-settings-block">
              <div className="notia-settings-row-label"><span>Contenido</span></div>
              {draft.items.length === 0 ? (
                <div className="notia-settings-row-description">Agregá carpetas o notas con el contexto #Publico.</div>
              ) : (
                <ul className="notia-public-space-items" aria-label={`Contenido de ${draft.name}`}>
                  {draft.items.map((item) => (
                    <li key={item.path} className="notia-public-space-item">
                      {item.kind === 'folder' ? <Folder size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
                      <span className="notia-public-space-item-text">
                        <span>{item.path.split('/').pop()?.replace(/\.md$/i, '')}</span>
                        <span className="notia-settings-path">{item.path}</span>
                      </span>
                      {publicByPath.get(item.path.toLowerCase()) === false ? <SettingsBadge>Sin #Publico</SettingsBadge> : null}
                      <NotiaButton
                        size="icon"
                        variant="ghost"
                        aria-label={`Quitar ${item.path}`}
                        title="Quitar"
                        onClick={() => changeItems(draft, draft.items.filter((other) => other.path !== item.path))}
                      >
                        <X size={16} />
                      </NotiaButton>
                    </li>
                  ))}
                </ul>
              )}
              {picker?.spaceId === draft.id ? (
                <CandidatePicker
                  candidates={picker.candidates}
                  error={picker.error}
                  onClose={() => setPicker(null)}
                  onPick={(candidate) => changeItems(draft, [...draft.items, { path: candidate.path, kind: candidate.kind }])}
                />
              ) : (
                <div className="notia-public-space-actions">
                  <NotiaButton onClick={() => openPicker(draft)}>
                    <Plus size={16} aria-hidden="true" /> Agregar carpeta o nota
                  </NotiaButton>
                </div>
              )}
            </div>
            <SettingsFooter tone={footerTone} message={footer}>
              <NotiaButton onClick={() => void openPublicSpace(draft.id).catch((error: unknown) => setStatus({ tone: 'error', message: messageOf(error, 'No se pudo abrir el navegador.') }))} disabled={!served?.listening || dirty}>
                Abrir en el navegador
              </NotiaButton>
              <NotiaButton
                variant="danger"
                onClick={() => {
                  setDrafts((current) => current.filter((other) => other.id !== draft.id))
                  setDirty(true)
                }}
              >
                Eliminar espacio
              </NotiaButton>
            </SettingsFooter>
          </SettingsCard>
        )
      })}
      <SettingsCard>
        <SettingsFooter tone={status.tone} message={status.message || (dirty ? 'Hay cambios sin guardar.' : 'Sin cambios.')}>
          <NotiaButton onClick={discard} disabled={!dirty || saving}>Descartar</NotiaButton>
          <NotiaButton variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? 'Publicando…' : 'Guardar y publicar'}
          </NotiaButton>
        </SettingsFooter>
      </SettingsCard>
    </>
  )
}
