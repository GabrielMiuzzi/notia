import { useId, useState, type ReactNode } from 'react'
import {
  Brain,
  Check,
  ChevronRight,
  FileSearch,
  FileText,
  Folder,
  FolderSearch,
  Library,
  Lock,
  Plus,
  Search,
  Waypoints,
  X,
} from 'lucide-react'
import { closeOnEscape, usePhoneSurfaceFocus } from './chatPhoneSurface'
import {
  MAX_CHAT_AGENTS,
  type ChatAgentCatalog,
  type ChatAgentOption,
  type ChatSettings,
} from '../../../../services/chat/chatAgentsRuntime'
import type { ChatFileContextMode } from '../../../../services/chat/chatAttachmentRuntime'
import { ChatPermissionsSection, PermanentContextField } from './ChatAgentPanel'
import { StarterIcon } from './ChatWorkspacePanels'
import { ChatPhoneAvatar } from './ChatPhone'
import { agentMemoryHint, libraryScopeHint, libraryScopeLabel } from './chatContextText'
import { chatAgentLookOf, type ChatAgentLook } from './useChatAgentSettings'
import type { ChatStarter } from './ChatWorkspaceViewTypes'

/*
 * Bottom sheets of the Chat IA phone layout: context, attach, agents and
 * dynamic. They send the person's choice; the backend validates and saves it.
 */

export type ChatPhoneSheetKind = 'context' | 'attach' | 'agents' | 'dynamic'

/** Text a dynamic's row shows when the chat has none. */
const NO_DYNAMIC = { name: 'Ninguna', description: 'Los agentes conversan sin una guía' }
const DYNAMIC_HINT = 'Guía cómo conversan los agentes del chat.'

function ChatPhoneSheet({
  kind,
  title,
  onClose,
  footer,
  children,
}: {
  kind: ChatPhoneSheetKind
  title: string
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  const titleId = useId()
  const dialogRef = usePhoneSurfaceFocus<HTMLDivElement>()
  return (
    <div className="notia-chat-phone-layer" onKeyDown={closeOnEscape(onClose)}>
      <div className="notia-chat-phone-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        className={`notia-chat-phone-sheet notia-chat-phone-sheet--${kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <span className="notia-chat-phone-sheet-handle" aria-hidden="true" />
        <div className="notia-chat-phone-sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="notia-chat-phone-icon notia-chat-phone-icon--muted" aria-label="Cerrar" onClick={onClose}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="notia-chat-phone-sheet-body">{children}</div>
        {footer ? <div className="notia-chat-phone-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

function PhoneRow({
  icon,
  label,
  detail,
  disabled = false,
  onClick,
}: {
  icon: ReactNode
  label: string
  detail?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className="notia-chat-phone-row" onClick={onClick} disabled={disabled}>
      {icon}
      <span className="notia-chat-phone-row-text">
        <span>{label}</span>
        {detail ? <span className="notia-chat-phone-row-detail">{detail}</span> : null}
      </span>
      <ChevronRight className="notia-chat-phone-row-chevron" size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}

function SettingsError({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null
  return (
    <p className="notia-chat-context-error" role="alert">
      {message}
      <button type="button" className="notia-chat-phone-icon notia-chat-phone-icon--muted" aria-label="Cerrar aviso" onClick={onDismiss}>
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </p>
  )
}

function PhoneSwitchMark() {
  return (
    <span className="notia-chat-switch" aria-hidden="true">
      <span className="notia-chat-switch-thumb" />
    </span>
  )
}

function dynamicOf(dynamics: ChatAgentOption[], selected: string | null): { name: string; description: string } {
  if (!selected) return NO_DYNAMIC
  const dynamic = dynamics.find((candidate) => candidate.fileName === selected)
  return dynamic
    ? { name: dynamic.name, description: dynamic.description }
    : { name: selected.replace(/\.md$/i, ''), description: 'El archivo de la dinámica ya no existe.' }
}

export interface ChatPhoneContextSheetProps {
  libraryName: string | null
  libraryRagEnabled: boolean
  contextFiles: Array<{ path: string; name: string }>
  contextFolders: Array<{ path: string; name: string }>
  contextMode: ChatFileContextMode
  starters: ChatStarter[]
  /** No library or no AI: the library and starter actions wait. */
  isDisabled: boolean
  onChooseFiles: () => void
  onChooseFolders: () => void
  onRemoveFile: (path: string) => void
  onRemoveFolder: (path: string) => void
  onSelectStarter: (prompt: string) => void
  agentMemoryEnabled: boolean
  isAgentMemoryChoiceLocked: boolean
  onAgentMemoryChange: (enabled: boolean) => void
  onOpenMemory: () => void
  catalog: ChatAgentCatalog
  settings: ChatSettings
  looks: Record<string, ChatAgentLook>
  /** A reply is running or there is no library: the chat settings wait. */
  areSettingsDisabled: boolean
  onSettingsChange: (settings: ChatSettings) => void
  settingsError: string | null
  onDismissSettingsError: () => void
  onOpenDynamic: () => void
  onOpenAgents: () => void
  onClose: () => void
}

/** «Contexto»: scope, quick actions, memory, permissions, permanent context, dynamic and agents. */
export function ChatPhoneContextSheet(props: ChatPhoneContextSheetProps) {
  const {
    libraryName, libraryRagEnabled, contextFiles, contextFolders, contextMode, starters, isDisabled,
    onChooseFiles, onChooseFolders, onRemoveFile, onRemoveFolder, onSelectStarter,
    agentMemoryEnabled, isAgentMemoryChoiceLocked, onAgentMemoryChange, onOpenMemory,
    catalog, settings, looks, areSettingsDisabled, onSettingsChange, settingsError, onDismissSettingsError,
    onOpenDynamic, onOpenAgents, onClose,
  } = props
  const memoryHintId = useId()
  const hasChosenContext = contextFiles.length > 0 || contextFolders.length > 0
  const dynamic = dynamicOf(catalog.dynamics, settings.dynamic)
  const byFile = new Map(catalog.agents.map((agent) => [agent.fileName, agent]))
  const removeAgent = (fileName: string) => onSettingsChange({ ...settings, agents: settings.agents.filter((file) => file !== fileName) })

  return (
    <ChatPhoneSheet kind="context" title="Contexto" onClose={onClose}>
      <SettingsError message={settingsError} onDismiss={onDismissSettingsError} />
      <section className="notia-chat-phone-section">
        <span className="notia-chat-section-label">Alcance</span>
        <span className={`notia-chat-phone-scope${libraryRagEnabled ? ' is-active' : ''}`}>
          {libraryRagEnabled ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : null}
          {libraryScopeLabel(libraryRagEnabled, libraryName)}
        </span>
        {hasChosenContext ? (
          <ul className="notia-chat-phone-context-items">
            {contextFolders.map((folder) => (
              <li key={folder.path}>
                <Folder size={17} strokeWidth={1.75} aria-hidden="true" />
                <span title={folder.path}>{folder.name}</span>
                <button
                  type="button"
                  className="notia-chat-phone-icon notia-chat-phone-icon--muted"
                  aria-label={`Quitar la carpeta ${folder.name} del contexto`}
                  onClick={() => onRemoveFolder(folder.path)}
                >
                  <X size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            ))}
            {contextFiles.map((file) => (
              <li key={file.path}>
                <FileText size={17} strokeWidth={1.75} aria-hidden="true" />
                <span title={file.path}>{file.name}</span>
                <button
                  type="button"
                  className="notia-chat-phone-icon notia-chat-phone-icon--muted"
                  aria-label={`Quitar ${file.name} del contexto`}
                  onClick={() => onRemoveFile(file.path)}
                >
                  <X size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="notia-chat-phone-hint">{libraryScopeHint(libraryRagEnabled, hasChosenContext, contextMode)}</p>
        <PhoneRow icon={<FileText size={19} strokeWidth={1.75} aria-hidden="true" />} label="Elegir archivos de la librería" disabled={isDisabled} onClick={onChooseFiles} />
        <PhoneRow icon={<Folder size={19} strokeWidth={1.75} aria-hidden="true" />} label="Elegir carpetas de la librería" disabled={isDisabled} onClick={onChooseFolders} />
      </section>

      {starters.length > 0 ? (
        <section className="notia-chat-phone-section">
          <span className="notia-chat-section-label">Acciones rápidas</span>
          {starters.map((starter, index) => (
            <PhoneRow
              key={starter.prompt}
              icon={<StarterIcon index={index} size={19} strokeWidth={1.75} />}
              label={starter.title}
              disabled={isDisabled}
              onClick={() => onSelectStarter(starter.prompt)}
            />
          ))}
        </section>
      ) : null}

      <section className="notia-chat-phone-section">
        <span className="notia-chat-section-label">Memoria</span>
        <div className="notia-chat-phone-card">
          <button
            type="button"
            role="switch"
            aria-checked={agentMemoryEnabled}
            aria-describedby={memoryHintId}
            className="notia-chat-phone-switch-row"
            onClick={() => onAgentMemoryChange(!agentMemoryEnabled)}
            disabled={isDisabled || isAgentMemoryChoiceLocked}
          >
            <Brain size={19} strokeWidth={1.75} aria-hidden="true" />
            <span className="notia-chat-phone-switch-label">Memoria persistente del agente</span>
            {isAgentMemoryChoiceLocked ? <Lock className="notia-chat-phone-lock" size={15} strokeWidth={1.75} aria-hidden="true" /> : null}
            <PhoneSwitchMark />
          </button>
        </div>
        <p id={memoryHintId} className="notia-chat-phone-hint">{agentMemoryHint(isAgentMemoryChoiceLocked, agentMemoryEnabled)}</p>
        <button type="button" className="notia-chat-phone-link" onClick={onOpenMemory} disabled={isDisabled}>
          Administrar memoria
        </button>
      </section>

      <ChatPermissionsSection settings={settings} isDisabled={areSettingsDisabled} onChange={onSettingsChange} />
      <PermanentContextField
        value={settings.permanentContext}
        disabled={areSettingsDisabled}
        onSave={(permanentContext) => onSettingsChange({ ...settings, permanentContext })}
      />

      <section className="notia-chat-phone-section">
        <span className="notia-chat-section-label">Dinámica</span>
        <PhoneRow
          icon={<Waypoints size={19} strokeWidth={1.75} aria-hidden="true" />}
          label={dynamic.name}
          detail={dynamic.description}
          disabled={areSettingsDisabled}
          onClick={onOpenDynamic}
        />
        <p className="notia-chat-phone-hint">{DYNAMIC_HINT}</p>
      </section>

      <section className="notia-chat-phone-section">
        <div className="notia-chat-phone-section-heading">
          <span className="notia-chat-section-label">Agentes</span>
          <span className="notia-chat-phone-section-count">{settings.agents.length}</span>
        </div>
        <button type="button" className="notia-chat-phone-add-agent" onClick={onOpenAgents} disabled={areSettingsDisabled}>
          <Plus size={17} strokeWidth={2} aria-hidden="true" />
          Agregar agente
        </button>
        {settings.agents.length === 0 ? (
          <p className="notia-chat-phone-hint">Sin agentes: responde solo Notia.</p>
        ) : settings.agents.map((fileName, index) => {
          const look = chatAgentLookOf(fileName, index, looks)
          const agent = byFile.get(fileName)
          return (
            <div key={fileName} className="notia-chat-phone-agent">
              <ChatPhoneAvatar look={look} size="row" />
              <span className="notia-chat-phone-row-text">
                <span className="notia-chat-phone-agent-name">{look.name}</span>
                <span className="notia-chat-phone-row-detail">{agent ? agent.description : 'El archivo del agente ya no existe.'}</span>
              </span>
              <button
                type="button"
                className="notia-chat-phone-icon notia-chat-phone-icon--muted"
                aria-label={`Quitar ${look.name}`}
                onClick={() => removeAgent(fileName)}
                disabled={areSettingsDisabled}
              >
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </section>
    </ChatPhoneSheet>
  )
}

/** «Adjuntar»: a file of the device, files or folders of the library, and the library search. */
export function ChatPhoneAttachSheet({
  libraryName,
  libraryRagEnabled,
  isRagDisabled,
  onSelectFile,
  onOpenLibraryFiles,
  onOpenLibraryFolders,
  onLibraryRagChange,
  onClose,
}: {
  libraryName: string | null
  libraryRagEnabled: boolean
  isRagDisabled: boolean
  onSelectFile: () => void
  onOpenLibraryFiles: () => void
  onOpenLibraryFolders: () => void
  onLibraryRagChange: (enabled: boolean) => void
  onClose: () => void
}) {
  return (
    <ChatPhoneSheet kind="attach" title="Adjuntar" onClose={onClose}>
      <PhoneRow icon={<FileText size={19} strokeWidth={1.75} aria-hidden="true" />} label="Seleccionar archivo" detail="Desde el dispositivo" onClick={onSelectFile} />
      <PhoneRow icon={<FileSearch size={19} strokeWidth={1.75} aria-hidden="true" />} label="Buscar archivos de la librería" onClick={onOpenLibraryFiles} />
      <PhoneRow icon={<FolderSearch size={19} strokeWidth={1.75} aria-hidden="true" />} label="Buscar carpetas de la librería" onClick={onOpenLibraryFolders} />
      <div className="notia-chat-phone-card notia-chat-phone-card--spaced">
        <button
          type="button"
          role="switch"
          aria-checked={libraryRagEnabled}
          className="notia-chat-phone-switch-row"
          onClick={() => onLibraryRagChange(!libraryRagEnabled)}
          disabled={isRagDisabled}
        >
          <Library size={19} strokeWidth={1.75} aria-hidden="true" />
          <span className="notia-chat-phone-row-text">
            <span>Toda la librería</span>
            <span className="notia-chat-phone-row-detail">
              {libraryRagEnabled
                ? `La IA busca en toda ${libraryName ?? 'la librería'}`
                : 'La IA usa solo los archivos y carpetas elegidos'}
            </span>
          </span>
          <PhoneSwitchMark />
        </button>
      </div>
    </ChatPhoneSheet>
  )
}

/** «Agregar agente»: the agents of `.agent/promps`, added or removed with a tap. */
export function ChatPhoneAgentsSheet({
  agents,
  selected,
  looks,
  isDisabled,
  onChange,
  settingsError,
  onDismissSettingsError,
  onClose,
}: {
  agents: ChatAgentOption[]
  selected: string[]
  looks: Record<string, ChatAgentLook>
  isDisabled: boolean
  onChange: (agents: string[]) => void
  settingsError: string | null
  onDismissSettingsError: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const isFull = selected.length >= MAX_CHAT_AGENTS
  const normalizedQuery = query.trim().toLowerCase()
  const visibleAgents = normalizedQuery
    ? agents.filter((agent) => `${agent.name} ${agent.description}`.toLowerCase().includes(normalizedQuery))
    : agents
  const toggle = (fileName: string) => {
    onChange(selected.includes(fileName) ? selected.filter((file) => file !== fileName) : [...selected, fileName])
  }
  const doneLabel = selected.length === 0
    ? 'Listo'
    : `Listo · ${selected.length} ${selected.length === 1 ? 'agente' : 'agentes'}`

  return (
    <ChatPhoneSheet
      kind="agents"
      title="Agregar agente"
      onClose={onClose}
      footer={<button type="button" className="notia-chat-phone-done" onClick={onClose}>{doneLabel}</button>}
    >
      <SettingsError message={settingsError} onDismiss={onDismissSettingsError} />
      <label className="notia-chat-phone-search notia-chat-phone-search--agents">
        <Search size={17} strokeWidth={1.75} aria-hidden="true" />
        <input
          type="search"
          aria-label="Buscar agentes"
          placeholder="Buscar agentes"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {visibleAgents.length === 0 ? (
        <p className="notia-chat-phone-hint">
          {agents.length === 0 ? 'No hay agentes en .agent/promps.' : 'Ningún agente coincide con la búsqueda.'}
        </p>
      ) : visibleAgents.map((agent) => {
        const added = selected.includes(agent.fileName)
        const position = selected.indexOf(agent.fileName)
        const look = chatAgentLookOf(agent.fileName, position >= 0 ? position : agents.indexOf(agent), looks)
        return (
          <button
            key={agent.fileName}
            type="button"
            className="notia-chat-phone-agent-option"
            aria-pressed={added}
            disabled={isDisabled || !agent.valid || (!added && isFull)}
            onClick={() => toggle(agent.fileName)}
          >
            <ChatPhoneAvatar look={look} size="option" />
            <span className="notia-chat-phone-row-text">
              <span className="notia-chat-phone-agent-name">{agent.name}</span>
              <span className="notia-chat-phone-row-detail">{agent.valid ? agent.description || agent.fileName : 'Vacío o ilegible'}</span>
            </span>
            <span className={`notia-chat-phone-agent-state${added ? ' is-added' : ''}`}>
              {added ? <><Check size={13} strokeWidth={2.4} aria-hidden="true" />Agregado</> : 'Agregar'}
            </span>
          </button>
        )
      })}
      {isFull ? <p className="notia-chat-phone-hint">Un chat puede tener hasta {MAX_CHAT_AGENTS} agentes.</p> : null}
    </ChatPhoneSheet>
  )
}

/** «Dinámica»: the guide the chat's agents follow, or none. */
export function ChatPhoneDynamicSheet({
  dynamics,
  selected,
  isDisabled,
  onSelect,
  settingsError,
  onDismissSettingsError,
  onClose,
}: {
  dynamics: ChatAgentOption[]
  selected: string | null
  isDisabled: boolean
  onSelect: (fileName: string | null) => void
  settingsError: string | null
  onDismissSettingsError: () => void
  onClose: () => void
}) {
  const groupName = useId()
  const options = [
    { fileName: null, name: NO_DYNAMIC.name, description: NO_DYNAMIC.description, valid: true },
    ...dynamics.map((dynamic) => ({
      fileName: dynamic.fileName,
      name: dynamic.name,
      description: dynamic.valid ? dynamic.description || dynamic.fileName : 'Vacía o ilegible',
      valid: dynamic.valid,
    })),
  ]
  return (
    <ChatPhoneSheet kind="dynamic" title="Dinámica" onClose={onClose}>
      <SettingsError message={settingsError} onDismiss={onDismissSettingsError} />
      <p className="notia-chat-phone-hint notia-chat-phone-hint--lead">{DYNAMIC_HINT}</p>
      <div className="notia-chat-phone-radios" role="radiogroup" aria-label="Dinámicas">
        {options.map((option) => {
          const checked = option.fileName === selected
          return (
            <label
              key={option.fileName ?? ''}
              className={`notia-chat-phone-radio${checked ? ' is-checked' : ''}${!option.valid || isDisabled ? ' is-disabled' : ''}`}
            >
              <input
                type="radio"
                name={groupName}
                checked={checked}
                disabled={!option.valid || isDisabled}
                onChange={() => onSelect(option.fileName)}
              />
              <span className="notia-chat-phone-radio-mark" aria-hidden="true" />
              <span className="notia-chat-phone-row-text">
                <span className="notia-chat-phone-radio-name">{option.name}</span>
                <span className="notia-chat-phone-row-detail">{option.description}</span>
              </span>
            </label>
          )
        })}
      </div>
      <p className="notia-chat-phone-note">Las dinámicas son los archivos de .agent/dynamics.</p>
    </ChatPhoneSheet>
  )
}
