import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, PenLine, Plus, Search, Waypoints, Wrench, X } from 'lucide-react'
import {
  MAX_CHAT_AGENTS,
  type ChatAgentCatalog,
  type ChatAgentOption,
  type ChatSettings,
} from '../../../../services/chat/chatAgentsRuntime'
import type { ChatAgentLook } from './useChatAgentSettings'
import { useDismissablePopover } from './useDismissablePopover'

/** Waits this long after the last keystroke to save the permanent context. */
const PERMANENT_CONTEXT_SAVE_DELAY_MS = 800

export function ChatAgentAvatar({ look, size = 'medium' }: { look: Pick<ChatAgentLook, 'initials' | 'colorIndex'>; size?: 'small' | 'medium' }) {
  return (
    <span
      className={`notia-chat-agent-avatar notia-chat-agent-avatar--${size} notia-chat-agent-avatar--c${look.colorIndex}`}
      aria-hidden="true"
    >
      {look.initials}
    </span>
  )
}

function PermissionSwitch({
  icon,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="notia-chat-permission-row"
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      {icon}
      <span className="notia-chat-permission-text">
        <span>{label}</span>
        <span className="notia-chat-permission-hint">{hint}</span>
      </span>
      <span className="notia-chat-switch" aria-hidden="true">
        <span className="notia-chat-switch-thumb" />
      </span>
    </button>
  )
}

/** The chat's permanent context; saved after a pause in typing or on leaving the field. */
export function PermanentContextField({
  value,
  disabled,
  onSave,
}: {
  value: string
  disabled: boolean
  onSave: (value: string) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const savedRef = useRef(value)
  // The latest callback, so re-renders while typing do not restart the wait.
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])
  // Another chat, or the saved value, replaces what is being edited.
  useEffect(() => {
    savedRef.current = value
    setDraft(value)
  }, [value])
  useEffect(() => {
    if (draft === savedRef.current) return undefined
    const timer = window.setTimeout(() => {
      savedRef.current = draft
      onSaveRef.current(draft)
    }, PERMANENT_CONTEXT_SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [draft])
  const flush = () => {
    if (draft === savedRef.current) return
    savedRef.current = draft
    onSaveRef.current(draft)
  }
  return (
    <section className="notia-chat-context-section">
      <label className="notia-chat-section-label" htmlFor={id}>Contexto permanente</label>
      <textarea
        id={id}
        className="notia-chat-permanent-context"
        rows={3}
        value={draft}
        disabled={disabled}
        placeholder="Contexto permanente del chat: instrucciones que la IA tiene en cuenta en cada mensaje."
        onChange={(event) => setDraft(event.target.value)}
        onBlur={flush}
      />
    </section>
  )
}

function DynamicPicker({
  dynamics,
  selected,
  disabled,
  onSelect,
}: {
  dynamics: ChatAgentOption[]
  selected: string | null
  disabled: boolean
  onSelect: (fileName: string | null) => void
}) {
  const { open: isOpen, setOpen, containerRef, onKeyDown } = useDismissablePopover()
  const listId = useId()
  const current = dynamics.find((dynamic) => dynamic.fileName === selected)
  const choose = (fileName: string | null) => {
    onSelect(fileName)
    setOpen(false)
  }
  return (
    <section className="notia-chat-context-section notia-chat-popover-anchor" ref={containerRef} onKeyDown={onKeyDown}>
      <span className="notia-chat-section-label">Dinámica</span>
      <button
        type="button"
        className="notia-chat-dynamic-button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        onClick={() => setOpen(!isOpen)}
        disabled={disabled}
      >
        <Waypoints size={15} aria-hidden="true" />
        <span className="notia-chat-dynamic-name">{current?.name ?? (selected ? selected.replace(/\.md$/i, '') : 'Ninguna')}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <span className="notia-chat-context-hint">Guía cómo conversan los agentes del chat.</span>
      {isOpen ? (
        <div id={listId} className="notia-chat-popover" role="listbox" aria-label="Dinámicas">
          <button
            type="button"
            role="option"
            aria-selected={selected === null}
            className="notia-chat-popover-option"
            onClick={() => choose(null)}
          >
            <span className="notia-chat-popover-option-text">
              <span>Ninguna</span>
              <span>Los agentes conversan sin una guía</span>
            </span>
            {selected === null ? <Check size={14} aria-hidden="true" /> : null}
          </button>
          {dynamics.map((dynamic) => (
            <button
              key={dynamic.fileName}
              type="button"
              role="option"
              aria-selected={selected === dynamic.fileName}
              className="notia-chat-popover-option"
              disabled={!dynamic.valid}
              onClick={() => choose(dynamic.fileName)}
            >
              <span className="notia-chat-popover-option-text">
                <span>{dynamic.name}</span>
                <span>{dynamic.valid ? dynamic.description || dynamic.fileName : 'Vacía o ilegible'}</span>
              </span>
              {selected === dynamic.fileName ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
          <p className="notia-chat-popover-note">Las dinámicas son los archivos de .agent/dynamics.</p>
        </div>
      ) : null}
    </section>
  )
}

function AgentPicker({
  agents,
  selected,
  looks,
  disabled,
  onChange,
}: {
  agents: ChatAgentOption[]
  selected: string[]
  looks: Record<string, ChatAgentLook>
  disabled: boolean
  onChange: (agents: string[]) => void
}) {
  const { open: isOpen, setOpen, containerRef, onKeyDown } = useDismissablePopover()
  const [query, setQuery] = useState('')
  const dialogId = useId()
  const isFull = selected.length >= MAX_CHAT_AGENTS
  const normalizedQuery = query.trim().toLowerCase()
  const visibleAgents = normalizedQuery
    ? agents.filter((agent) => `${agent.name} ${agent.description}`.toLowerCase().includes(normalizedQuery))
    : agents
  const byFile = new Map(agents.map((agent) => [agent.fileName, agent]))
  const toggle = (fileName: string) => {
    onChange(selected.includes(fileName) ? selected.filter((file) => file !== fileName) : [...selected, fileName])
  }
  const lookOf = (fileName: string, fallbackIndex: number): ChatAgentLook => looks[fileName] ?? {
    name: fileName.replace(/\.md$/i, ''),
    initials: fileName.slice(0, 2).toUpperCase(),
    colorIndex: fallbackIndex % 6,
  }

  return (
    <section className="notia-chat-context-section notia-chat-popover-anchor" ref={containerRef} onKeyDown={onKeyDown}>
      <div className="notia-chat-section-heading">
        <span className="notia-chat-section-label">Agentes</span>
        <span className="notia-chat-section-count">{selected.length}</span>
      </div>
      <button
        type="button"
        className="notia-chat-add-agent"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? dialogId : undefined}
        onClick={() => setOpen(!isOpen)}
        disabled={disabled}
      >
        <Plus size={14} aria-hidden="true" />
        Agregar agente
      </button>
      {isOpen ? (
        <div id={dialogId} className="notia-chat-popover notia-chat-popover--agents" role="dialog" aria-label="Agregar agente">
          <label className="notia-chat-popover-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              aria-label="Buscar agentes"
              placeholder="Buscar agentes…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
          </label>
          {visibleAgents.length === 0 ? (
            <p className="notia-chat-popover-note">
              {agents.length === 0 ? 'No hay agentes en .agent/promps.' : 'Ningún agente coincide con la búsqueda.'}
            </p>
          ) : visibleAgents.map((agent, index) => {
            const added = selected.includes(agent.fileName)
            return (
              <button
                key={agent.fileName}
                type="button"
                className="notia-chat-agent-option"
                aria-pressed={added}
                disabled={!agent.valid || (!added && isFull)}
                onClick={() => toggle(agent.fileName)}
              >
                <ChatAgentAvatar look={lookOf(agent.fileName, index)} />
                <span className="notia-chat-popover-option-text">
                  <span>{agent.name}</span>
                  <span>{agent.valid ? agent.description || agent.fileName : 'Vacío o ilegible'}</span>
                </span>
                <span className={`notia-chat-agent-option-state${added ? ' notia-chat-agent-option-state--added' : ''}`}>
                  {added ? <><Check size={12} aria-hidden="true" />Agregado</> : 'Agregar'}
                </span>
              </button>
            )
          })}
          {isFull ? <p className="notia-chat-popover-note">Un chat puede tener hasta {MAX_CHAT_AGENTS} agentes.</p> : null}
        </div>
      ) : null}
      {selected.length === 0 ? (
        <span className="notia-chat-agents-empty">Sin agentes: responde solo Notia.</span>
      ) : (
        <ul className="notia-chat-agent-list">
          {selected.map((fileName, index) => {
            const look = lookOf(fileName, index)
            const agent = byFile.get(fileName)
            return (
              <li key={fileName} className="notia-chat-agent-row">
                <ChatAgentAvatar look={look} />
                <span className="notia-chat-popover-option-text">
                  <span>{look.name}</span>
                  <span>{agent ? agent.description : 'El archivo del agente ya no existe.'}</span>
                </span>
                <button
                  type="button"
                  className="notia-chat-icon-button notia-chat-icon-button--small"
                  aria-label={`Quitar ${look.name}`}
                  onClick={() => toggle(fileName)}
                  disabled={disabled}
                >
                  <X size={13} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** The chat's tools and write permissions; writing needs the tools. */
export function ChatPermissionsSection({
  settings,
  isDisabled,
  onChange,
}: {
  settings: ChatSettings
  isDisabled: boolean
  onChange: (settings: ChatSettings) => void
}) {
  return (
    <section className="notia-chat-context-section">
      <span className="notia-chat-section-label">Permisos</span>
      <div className="notia-chat-permissions">
        <PermissionSwitch
          icon={<Wrench size={15} aria-hidden="true" />}
          label="Uso de herramientas"
          hint={settings.toolsEnabled ? 'Puede buscar y ejecutar acciones' : 'Responde sin herramientas'}
          checked={settings.toolsEnabled}
          disabled={isDisabled}
          onChange={(toolsEnabled) => onChange({ ...settings, toolsEnabled })}
        />
        <div className="notia-chat-permissions-divider" />
        <PermissionSwitch
          icon={<PenLine size={15} aria-hidden="true" />}
          label="Permisos de lectura/escritura"
          hint={settings.writeEnabled ? 'Puede crear y editar notas' : 'Solo lectura'}
          checked={settings.writeEnabled}
          disabled={isDisabled || !settings.toolsEnabled}
          onChange={(writeEnabled) => onChange({ ...settings, writeEnabled })}
        />
      </div>
    </section>
  )
}

/**
 * Sections of the context panel for the chat's permissions, permanent
 * context, dynamic and agents. They send the person's choice; the backend
 * validates and saves it and runs the agents.
 */
export function ChatAgentPanelSections({
  catalog,
  settings,
  looks,
  isDisabled,
  onChange,
}: {
  catalog: ChatAgentCatalog
  settings: ChatSettings
  looks: Record<string, ChatAgentLook>
  isDisabled: boolean
  onChange: (settings: ChatSettings) => void
}) {
  const savePermanentContext = (permanentContext: string) => onChange({ ...settings, permanentContext })
  return (
    <>
      <ChatPermissionsSection settings={settings} isDisabled={isDisabled} onChange={onChange} />
      <PermanentContextField value={settings.permanentContext} disabled={isDisabled} onSave={savePermanentContext} />
      <DynamicPicker
        dynamics={catalog.dynamics}
        selected={settings.dynamic}
        disabled={isDisabled}
        onSelect={(dynamic) => onChange({ ...settings, dynamic })}
      />
      <AgentPicker
        agents={catalog.agents}
        selected={settings.agents}
        looks={looks}
        disabled={isDisabled}
        onChange={(agents) => onChange({ ...settings, agents })}
      />
    </>
  )
}
