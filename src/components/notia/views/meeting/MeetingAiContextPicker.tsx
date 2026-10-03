import { useState, type CSSProperties } from 'react'
import { Check, ChevronDown, Folder, Lock, Sparkles, X } from 'lucide-react'
import { NotiaModalShell } from '../../NotiaModalShell'
import type { MeetingContextOption } from '../../../../services/meeting/meetingTypes'
import type { MeetingAiContextState } from './useMeetingAiContext'

/*
 * «Contexto para la IA» of the recording setup (canvas «Notia · Meeting»,
 * boards Main and Mobile · Contexto): a folder of the library, or the whole
 * library limited to some contexts. A library has as many contexts as it
 * wants; the desktop shows the first ones and the rest on demand.
 */

const VISIBLE_CONTEXTS = 8
const SUBTITLE = 'Respuestas en vivo y Notas IA solo consultan lo que elijas.'

const chipStyle = (context: MeetingContextOption) => (
  context.color ? { '--meeting-context-color': context.color } as CSSProperties : undefined
)

interface ContextChipsProps {
  state: MeetingAiContextState
  /** All of them at once, as the phone sheet shows them. */
  showAll?: boolean
}

function ContextChips({ state, showAll = false }: ContextChipsProps) {
  const [expanded, setExpanded] = useState(false)
  const contexts = state.options?.contexts ?? []
  const disabled = !state.choice.wholeLibrary
  const visible = showAll || expanded ? contexts : contexts.slice(0, VISIBLE_CONTEXTS)
  const hidden = contexts.length - visible.length
  return (
    <div className="notia-meeting-ai-contexts" data-disabled={disabled ? 'true' : undefined}>
      <div className="notia-meeting-ai-contexts-head">
        <span>Contextos permitidos</span>
        <strong className="notia-meeting-mono">{`${state.choice.contexts.length} de ${contexts.length}`}</strong>
        <button type="button" className="notia-meeting-ai-link" disabled={disabled} onClick={() => state.setAllContexts(true)}>Todos</button>
        {showAll ? null : (
          <button type="button" className="notia-meeting-ai-link notia-meeting-ai-link--muted" disabled={disabled} onClick={() => state.setAllContexts(false)}>
            Ninguno
          </button>
        )}
      </div>
      <div role="group" aria-label="Contextos permitidos" className="notia-meeting-ai-chips">
        {visible.map((context) => {
          const selected = state.choice.contexts.includes(context.tag)
          return (
            <button
              key={context.tag}
              type="button"
              className="notia-meeting-ai-chip"
              aria-pressed={selected}
              disabled={disabled}
              style={chipStyle(context)}
              onClick={() => state.toggleContext(context.tag)}
            >
              <span className="notia-meeting-ai-chip-box" aria-hidden="true">{selected ? <Check size={11} strokeWidth={3.5} /> : null}</span>
              {context.label}
              {context.locked ? <Lock size={12} aria-label="Sensible" /> : null}
            </button>
          )
        })}
        {hidden > 0 ? (
          <button type="button" className="notia-meeting-ai-chip notia-meeting-ai-chip--more" aria-expanded={false} onClick={() => setExpanded(true)}>
            +{hidden} más
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** The section of the desktop setup. */
export function MeetingAiContextSection({ state }: { state: MeetingAiContextState }) {
  const { options, choice, libraryName } = state
  const folders = options?.folders ?? []
  const folder = folders.find((candidate) => candidate.path === choice.folder)
  const folderDisabled = choice.wholeLibrary || folders.length === 0
  return (
    <section className="notia-meeting-ai-context" aria-labelledby="meeting-ai-context-title">
      <div className="notia-meeting-ai-context-title">
        <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
        <h3 id="meeting-ai-context-title">Contexto para la IA</h3>
        <span>{SUBTITLE}</span>
      </div>
      {!libraryName ? (
        <p className="notia-meeting-empty-text">Abrí una biblioteca para que la IA consulte tus notas.</p>
      ) : state.error ? (
        <p className="notia-meeting-error-text" role="alert">{state.error}</p>
      ) : !options ? (
        <p className="notia-meeting-empty-text" role="status">Leyendo carpetas y contextos…</p>
      ) : (
        <>
          <div className="notia-meeting-ai-context-row">
            <label className="notia-meeting-ai-folder" data-disabled={folderDisabled ? 'true' : undefined}>
              <Folder size={15} strokeWidth={1.8} aria-hidden="true" />
              <span className="notia-meeting-ai-folder-name">
                {choice.wholeLibrary || !folder ? `Toda la librería ${libraryName}` : `${libraryName} / ${folder.path}`}
              </span>
              {!choice.wholeLibrary && folder ? <span className="notia-meeting-ai-folder-meta">{`${folder.noteCount} notas`}</span> : null}
              <ChevronDown size={12} aria-hidden="true" />
              <select
                aria-label="Carpeta de contexto"
                value={choice.folder ?? ''}
                disabled={folderDisabled}
                onChange={(event) => state.setFolder(event.target.value)}
              >
                {folders.map((candidate) => (
                  <option key={candidate.path} value={candidate.path}>
                    {`${libraryName} / ${candidate.path} (${candidate.noteCount} notas)`}
                  </option>
                ))}
              </select>
            </label>
            <div className="notia-meeting-ai-whole">
              <span id="meeting-ai-whole-library">Toda la librería</span>
              <button
                type="button"
                role="switch"
                className="notia-meeting-switch"
                aria-checked={choice.wholeLibrary}
                aria-labelledby="meeting-ai-whole-library"
                disabled={folders.length === 0}
                onClick={() => state.setWholeLibrary(!choice.wholeLibrary)}
              >
                <span aria-hidden="true" />
              </button>
            </div>
          </div>
          <ContextChips state={state} />
        </>
      )}
    </section>
  )
}

interface MeetingAiContextSheetProps {
  state: MeetingAiContextState
  onClose: () => void
}

/** The bottom sheet of the phone setup («Contexto IA»). */
export function MeetingAiContextSheet({ state, onClose }: MeetingAiContextSheetProps) {
  const { options, choice, libraryName } = state
  const folders = options?.folders ?? []
  return (
    <NotiaModalShell open onClose={onClose} size="md" panelClassName="notia-meeting-phone-sheet notia-meeting-ai-sheet">
      <span className="notia-meeting-phone-handle notia-meeting-ai-sheet-handle" aria-hidden="true" />
      <div className="notia-meeting-ai-sheet-head">
        <h2 id="meeting-ai-sheet-title">Contexto para la IA</h2>
        <button type="button" className="notia-meeting-icon-button" aria-label="Cerrar" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="notia-meeting-ai-sheet-subtitle">{SUBTITLE}</p>
      <div className="notia-meeting-ai-sheet-body">
        {state.error ? (
          <p className="notia-meeting-error-text" role="alert">{state.error}</p>
        ) : !options ? (
          <p className="notia-meeting-empty-text" role="status">Leyendo carpetas y contextos…</p>
        ) : (
          <>
            <div className="notia-meeting-ai-sheet-whole">
              <div>
                <strong id="meeting-ai-sheet-whole">Toda la librería</strong>
                <small>{`Usa todas las carpetas de ${libraryName ?? 'la biblioteca'}`}</small>
              </div>
              <button
                type="button"
                role="switch"
                className="notia-meeting-phone-switch"
                aria-checked={choice.wholeLibrary}
                aria-labelledby="meeting-ai-sheet-whole"
                disabled={folders.length === 0}
                onClick={() => state.setWholeLibrary(!choice.wholeLibrary)}
              >
                <span aria-hidden="true" />
              </button>
            </div>
            {folders.length ? (
              <div className="notia-meeting-ai-sheet-folders" data-disabled={choice.wholeLibrary ? 'true' : undefined}>
                <span id="meeting-ai-sheet-folders">O elegí una carpeta</span>
                <div role="radiogroup" aria-labelledby="meeting-ai-sheet-folders">
                  {folders.map((folder) => {
                    const selected = !choice.wholeLibrary && choice.folder === folder.path
                    return (
                      <button
                        key={folder.path}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={choice.wholeLibrary}
                        onClick={() => state.setFolder(folder.path)}
                      >
                        <Folder size={16} strokeWidth={1.8} aria-hidden="true" />
                        <span>{folder.path}</span>
                        <i aria-hidden="true" />
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
            <ContextChips state={state} showAll />
          </>
        )}
      </div>
      <div className="notia-meeting-ai-sheet-foot">
        <button type="button" className="notia-meeting-phone-primary" onClick={onClose}>Listo</button>
      </div>
    </NotiaModalShell>
  )
}
