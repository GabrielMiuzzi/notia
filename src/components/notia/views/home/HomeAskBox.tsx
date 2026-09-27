import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, ChevronDown, Sparkle } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import { loadChatAgentCatalog, type ChatAgentOption } from '../../../../services/chat/chatAgentsRuntime'
import { loadAgentPromptSelection, saveSelectedAgentPromptFileName } from '../../../../services/ai/agentPromptRuntime'

interface HomeAskBoxProps {
  library: NotiaLibrary
  /** Sends `text` to the side chat, in a new chat with the agent. */
  onSend: (text: string, agent: ChatAgentOption | null) => void
}

function isFocusShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k'
}

/**
 * «Preguntale al asistente»: the message goes to the side chat with the
 * agent of the chip, which is the side chat's own agent.
 */
export function HomeAskBox({ library, onSend }: HomeAskBoxProps) {
  const [agents, setAgents] = useState<ChatAgentOption[]>([])
  const [agentFileName, setAgentFileName] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let isCurrent = true
    void Promise.all([loadChatAgentCatalog(library.id), loadAgentPromptSelection(library)])
      .then(([catalog, selection]) => {
        if (!isCurrent) return
        const valid = catalog.agents.filter((agent) => agent.valid)
        setAgents(valid)
        setAgentFileName(valid.some((agent) => agent.fileName === selection.selected) ? selection.selected : valid[0]?.fileName ?? null)
      })
      .catch(() => {
        if (isCurrent) setAgents([])
      })
    return () => { isCurrent = false }
  }, [library])

  useEffect(() => {
    const focusOnShortcut = (event: KeyboardEvent) => {
      if (!isFocusShortcut(event)) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', focusOnShortcut)
    return () => window.removeEventListener('keydown', focusOnShortcut)
  }, [])

  const agent = agents.find((candidate) => candidate.fileName === agentFileName) ?? null

  const cycleAgent = () => {
    if (agents.length < 2) return
    const next = agents[(agents.findIndex((candidate) => candidate.fileName === agentFileName) + 1) % agents.length]
    setAgentFileName(next.fileName)
    void saveSelectedAgentPromptFileName(library.id, next.fileName).catch(() => undefined)
  }

  const send = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    onSend(text, agent)
  }

  return (
    <form className="home-ask" onSubmit={send}>
      <button
        type="button"
        className="home-agent"
        title="Cambiar agente"
        aria-label={`Agente: ${agent?.name ?? 'Notia'}. Cambiar agente`}
        disabled={agents.length < 2}
        onClick={cycleAgent}
      >
        <Sparkle size={13} strokeWidth={2} aria-hidden="true" />
        <span className="home-agent__name">{agent?.name ?? 'Notia'}</span>
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      <label htmlFor="home-ask-input" className="home-sr">Preguntale al asistente o capturá una idea</label>
      <input
        ref={inputRef}
        id="home-ask-input"
        type="text"
        placeholder="Preguntale al asistente o capturá una idea…"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <span className="home-kbd" aria-hidden="true">Ctrl K</span>
      <button type="submit" className="home-send" aria-label="Enviar al asistente">
        <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </form>
  )
}
