import type { ReactNode } from 'react'
import {
  AlignLeft,
  Brain,
  Check,
  ChevronDown,
  FileText,
  Folder,
  ListChecks,
  Lock,
  PanelLeftOpen,
  PanelRight,
  Sparkles,
  Waypoints,
  X,
} from 'lucide-react'
import type { ChatFileContextMode } from '../../../../services/chat/chatAttachmentRuntime'
import type { ChatStarter } from './ChatWorkspaceViewTypes'
import { agentMemoryHint, libraryScopeHint, libraryScopeLabel } from './chatContextText'

const STARTER_ICONS = [AlignLeft, Waypoints, ListChecks]

/** Icon of a conversation starter, by its position. */
export function StarterIcon({ index, size, strokeWidth }: { index: number; size: number; strokeWidth?: number }) {
  const Icon = STARTER_ICONS[index % STARTER_ICONS.length]
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" />
}

export function ChatTopBar({
  title,
  isHistoryPanelOpen,
  onOpenHistory,
  modelLabel,
  isResolvingModel,
  isAiAvailable,
  onOpenAiSettings,
  isAgentMemoryOff,
  isContextPanelOpen,
  onToggleContextPanel,
}: {
  title: string
  isHistoryPanelOpen: boolean
  onOpenHistory: () => void
  modelLabel: string | null
  isResolvingModel: boolean
  isAiAvailable: boolean
  onOpenAiSettings: () => void
  isAgentMemoryOff: boolean
  isContextPanelOpen: boolean
  onToggleContextPanel: () => void
}) {
  const resolvedModelLabel = modelLabel ?? (isResolvingModel ? 'Resolviendo modelo…' : 'Modelo por defecto')

  return (
    <header className="notia-chat-topbar">
      {!isHistoryPanelOpen ? (
        <button
          type="button"
          className="notia-chat-icon-button"
          aria-label="Mostrar historial de chats"
          title="Mostrar historial de chats"
          onClick={onOpenHistory}
        >
          <PanelLeftOpen size={16} />
        </button>
      ) : null}
      <h1 className="notia-chat-topbar-title">{title}</h1>
      <div className="notia-chat-topbar-spacer" />
      {isAgentMemoryOff ? (
        <span className="notia-chat-memory-off" title="Este chat no usa ni guarda memoria del agente">
          Sin memoria
        </span>
      ) : null}
      <button
        type="button"
        className="notia-chat-model-pill"
        title="Cambiar modelo en Configuración → IA"
        aria-label={`Modelo: ${resolvedModelLabel}. Abrir configuración de IA`}
        onClick={onOpenAiSettings}
      >
        <span
          className={`notia-chat-model-dot${isAiAvailable ? ' notia-chat-model-dot--ready' : ''}`}
          aria-hidden="true"
        />
        <span className="notia-chat-model-name">{resolvedModelLabel}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`notia-chat-icon-button${isContextPanelOpen ? ' notia-chat-icon-button--active' : ''}`}
        aria-label={isContextPanelOpen ? 'Ocultar panel de contexto' : 'Mostrar panel de contexto'}
        aria-pressed={isContextPanelOpen}
        title="Panel de contexto"
        onClick={onToggleContextPanel}
      >
        <PanelRight size={16} />
      </button>
    </header>
  )
}

export function ChatWelcomeHero({ libraryName }: { libraryName: string | null }) {
  return (
    <div className="notia-chat-welcome-hero">
      <span className="notia-chat-welcome-mark" aria-hidden="true">
        <Sparkles size={22} />
      </span>
      <h2>¿En qué trabajamos hoy?</h2>
      <p>
        {libraryName
          ? `Preguntá sobre la librería ${libraryName} y tus tareas.`
          : 'Elegí una librería activa para empezar a conversar.'}
      </p>
    </div>
  )
}

export function ChatStarterCards({
  starters,
  onSelectStarter,
}: {
  starters: ChatStarter[]
  onSelectStarter: (prompt: string) => void
}) {
  if (starters.length === 0) {
    return null
  }

  return (
    <div className="notia-chat-starters" aria-label="Sugerencias de inicio">
      {starters.map((starter, index) => (
        <button
          key={starter.prompt}
          type="button"
          className="notia-chat-starter"
          onClick={() => onSelectStarter(starter.prompt)}
        >
          <StarterIcon index={index} size={18} />
          <strong>{starter.title}</strong>
          <span>{starter.description}</span>
        </button>
      ))}
    </div>
  )
}

export function ChatContextPanel({
  libraryName,
  contextFiles,
  contextFolders,
  contextMode,
  libraryRagEnabled,
  starters,
  isDisabled,
  onChooseFiles,
  onChooseFolders,
  onRemoveFile,
  onRemoveFolder,
  onSelectStarter,
  agentMemoryEnabled,
  isAgentMemoryChoiceLocked,
  onAgentMemoryChange,
  onOpenMemory,
  onClose,
  children,
}: {
  libraryName: string | null
  contextFiles: Array<{ path: string; name: string }>
  contextFolders: Array<{ path: string; name: string }>
  contextMode: ChatFileContextMode
  libraryRagEnabled: boolean
  starters: ChatStarter[]
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
  onClose: () => void
  /** Sections after the memory: permissions, permanent context, dynamic and agents. */
  children?: ReactNode
}) {
  return (
    <>
      <button
        type="button"
        className="notia-chat-context-backdrop"
        aria-label="Cerrar panel de contexto"
        onClick={onClose}
      />
      <aside className="notia-chat-context-panel" aria-label="Contexto de la conversación">
        <div className="notia-chat-context-panel-header">
          <span>Contexto</span>
          <button
            type="button"
            className="notia-chat-icon-button"
            aria-label="Cerrar panel de contexto"
            title="Cerrar panel de contexto"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        <section className="notia-chat-context-section">
          <span className="notia-chat-section-label">Alcance</span>
          <div className="notia-chat-scope-chips">
            <span className={`notia-chat-scope-chip${libraryRagEnabled ? ' notia-chat-scope-chip--active' : ''}`}>
              {libraryRagEnabled ? <Check size={12} aria-hidden="true" /> : null}
              {libraryScopeLabel(libraryRagEnabled, libraryName)}
            </span>
          </div>
          {contextFolders.length > 0 || contextFiles.length > 0 ? (
            <>
              <ul className="notia-chat-context-files">
                {contextFolders.map((folder) => (
                  <li key={folder.path}>
                    <Folder size={13} aria-hidden="true" />
                    <span title={folder.path}>{folder.name}</span>
                    <button
                      type="button"
                      className="notia-chat-icon-button notia-chat-icon-button--small"
                      aria-label={`Quitar la carpeta ${folder.name} del contexto`}
                      onClick={() => onRemoveFolder(folder.path)}
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
                {contextFiles.map((file) => (
                  <li key={file.path}>
                    <FileText size={13} aria-hidden="true" />
                    <span title={file.path}>{file.name}</span>
                    <button
                      type="button"
                      className="notia-chat-icon-button notia-chat-icon-button--small"
                      aria-label={`Quitar ${file.name} del contexto`}
                      onClick={() => onRemoveFile(file.path)}
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
              <span className="notia-chat-context-hint">
                {libraryScopeHint(libraryRagEnabled, true, contextMode)}
              </span>
            </>
          ) : (
            <span className="notia-chat-context-hint">
              {libraryScopeHint(libraryRagEnabled, false, contextMode)}
            </span>
          )}
          <button
            type="button"
            className="notia-chat-context-action"
            onClick={onChooseFiles}
            disabled={isDisabled}
          >
            <FileText size={15} aria-hidden="true" />
            Elegir archivos de la librería
          </button>
          <button
            type="button"
            className="notia-chat-context-action"
            onClick={onChooseFolders}
            disabled={isDisabled}
          >
            <Folder size={15} aria-hidden="true" />
            Elegir carpetas de la librería
          </button>
        </section>

        {starters.length > 0 ? (
          <section className="notia-chat-context-section">
            <span className="notia-chat-section-label">Acciones rápidas</span>
            {starters.map((starter, index) => (
              <button
                key={starter.prompt}
                type="button"
                className="notia-chat-context-action"
                onClick={() => onSelectStarter(starter.prompt)}
                disabled={isDisabled}
              >
                <StarterIcon index={index} size={15} />
                {starter.title}
              </button>
            ))}
          </section>
        ) : null}

        <section className="notia-chat-context-section">
          <span className="notia-chat-section-label">Memoria</span>
          <button
            type="button"
            role="switch"
            aria-checked={agentMemoryEnabled}
            aria-describedby="notia-chat-memory-hint"
            className="notia-chat-switch-row"
            onClick={() => onAgentMemoryChange(!agentMemoryEnabled)}
            disabled={isDisabled || isAgentMemoryChoiceLocked}
          >
            <Brain size={15} aria-hidden="true" />
            <span className="notia-chat-switch-label">Memoria persistente del agente</span>
            {isAgentMemoryChoiceLocked ? <Lock size={13} className="notia-chat-switch-lock" aria-hidden="true" /> : null}
            <span className="notia-chat-switch" aria-hidden="true">
              <span className="notia-chat-switch-thumb" />
            </span>
          </button>
          <span id="notia-chat-memory-hint" className="notia-chat-context-hint">
            {agentMemoryHint(isAgentMemoryChoiceLocked, agentMemoryEnabled)}
          </span>
          <button
            type="button"
            className="notia-chat-context-link"
            onClick={onOpenMemory}
            disabled={isDisabled}
          >
            Administrar memoria
          </button>
        </section>
        {children}
      </aside>
    </>
  )
}
