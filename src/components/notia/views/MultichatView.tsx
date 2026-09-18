import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import type { MultichatDynamic, MultichatMessage, MultichatRoom } from '../../../types/multichat'
import { chooseAutomaticRoundLimit, dynamicAllowsAutomaticTurns, selectMultichatParticipants, serializeMultichatHistory, validateAgentSelection } from '../../../engines/multichat/multichatEngine'
import { listMultichatAgentPrompts, listMultichatDynamics, loadMultichatAgent, loadMultichatDynamic, validateMultichatLoadedSelection } from '../../../services/multichat/multichatLibraryRuntime'
import { clearMultichatPanelContext, setMultichatPanelContext } from '../../../services/multichat/multichatSessionStore'
import { runMultichatRound } from '../../../services/multichat/multichatRuntime'

interface MultichatViewProps {
  library: NotiaLibrary | null
  aiPreferences: AiPreferences
}

export function MultichatView({ library, aiPreferences }: MultichatViewProps) {
  const [dynamics, setDynamics] = useState<MultichatDynamic[]>([])
  const [prompts, setPrompts] = useState<{ fileName: string; name: string }[]>([])
  const [dynamicFile, setDynamicFile] = useState('')
  const [contextDraft, setContextDraft] = useState('')
  const [selectedPromptFiles, setSelectedPromptFiles] = useState<string[]>([])
  const [invalidPromptFiles, setInvalidPromptFiles] = useState<Set<string>>(new Set())
  const [room, setRoom] = useState<MultichatRoom | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState<{
    agentId: string
    agentName: string
    agentColor: string
    agentIcon: string
    thinking: string
    response: string
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!library) return
    let current = true
    void Promise.all([listMultichatDynamics(library), listMultichatAgentPrompts(library)])
      .then(async ([nextDynamics, nextPrompts]) => {
        if (!current) return
        setDynamics(nextDynamics)
        setPrompts(nextPrompts)
        const invalid = new Set<string>()
        await Promise.all(nextPrompts.map(async (prompt) => {
          try { await loadMultichatAgent(library, prompt.fileName, 0) } catch { invalid.add(prompt.fileName) }
        }))
        if (current) setInvalidPromptFiles(invalid)
      })
      .catch(() => current && setError('No se pudieron cargar dinámicas y agentes.'))
    return () => { current = false }
  }, [library])

  useEffect(() => {
    if (room && (!library || room.libraryId !== library.id)) {
      abortRef.current?.abort()
      clearMultichatPanelContext(room.id)
      setRoom(null)
    }
  }, [library, room])

  useEffect(() => {
    // Room messages update frequently. Keep cancellation tied to the view
    // lifecycle rather than to the room object, otherwise every new message
    // would run the previous effect cleanup and abort the active round.
    return () => {
      abortRef.current?.abort()
      clearMultichatPanelContext()
    }
  }, [])

  const updatePanelContext = useCallback((nextRoom: MultichatRoom | null) => {
    if (!nextRoom) {
      clearMultichatPanelContext()
      return
    }
    setMultichatPanelContext({
      roomId: nextRoom.id,
      label: 'Contexto activo: sala Multichat',
      dynamicName: nextRoom.dynamic.name,
      agentNames: nextRoom.agents.map((agent) => agent.name),
      contextContent: nextRoom.contextContent,
      messages: serializeMultichatHistory(nextRoom.messages),
    })
  }, [])

  const startRoom = async () => {
    if (!library) return
    setError(null)
    const dynamic = dynamics.find((item) => item.fileName === dynamicFile) ?? null
    if (!dynamic) { setError('Seleccioná una dinámica válida.'); return }
    if (selectedPromptFiles.length < 1 || selectedPromptFiles.length > 6) { setError('Seleccioná entre uno y seis agentes.'); return }
    setLoading(true)
    try {
      const loadedDynamic = await loadMultichatDynamic(library, dynamic.fileName)
      const loadedAgents = await Promise.all(selectedPromptFiles.map((fileName, index) => loadMultichatAgent(library, fileName, index)))
      const validation = validateMultichatLoadedSelection(loadedDynamic, loadedAgents) ?? validateAgentSelection(loadedAgents)
      if (validation) { setError(validation); return }
      const nextRoom: MultichatRoom = {
        id: crypto.randomUUID(),
        dynamic: loadedDynamic,
        agents: loadedAgents,
        contextContent: contextDraft.trim(),
        messages: [],
        round: { status: 'empty', automaticRounds: 0, automaticRoundLimit: chooseAutomaticRoundLimit(), activeAgentId: null, error: null },
        cancelled: false,
        libraryId: library.id,
      }
      setRoom(nextRoom)
      updatePanelContext(nextRoom)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la sala.')
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async () => {
    if (!room || !library || !draft.trim() || loading) return
    const content = draft.trim()
    setDraft('')
    const userMessage: MultichatMessage = { id: crypto.randomUUID(), speakerId: 'user', speakerName: 'Usuario', content, createdAt: Date.now() }
    let nextRoom: MultichatRoom = { ...room, messages: [...room.messages, userMessage], round: { ...room.round, status: 'agent-turn', automaticRounds: 0, error: null } }
    setRoom(nextRoom)
    updatePanelContext(nextRoom)
    setLoading(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      let automaticRounds = 0
      let emptyAgentName: string | null = null
      let pendingParticipants = selectMultichatParticipants({ agents: nextRoom.agents, dynamicContent: nextRoom.dynamic.content })
      while (pendingParticipants.length > 0 && automaticRounds < nextRoom.round.automaticRoundLimit) {
        const replies = await runMultichatRound({
          aiPreferences, dynamic: nextRoom.dynamic, agents: pendingParticipants, contextContent: nextRoom.contextContent,
          messages: nextRoom.messages, signal: controller.signal,
          onAgentStart: (agent) => {
            setStreaming({ agentId: `agent:${agent.fileName}`, agentName: agent.name, agentColor: agent.color, agentIcon: agent.icon, thinking: '', response: '' })
            nextRoom = { ...nextRoom, round: { ...nextRoom.round, status: 'agent-turn', activeAgentId: `agent:${agent.fileName}` } }
            setRoom(nextRoom)
            updatePanelContext(nextRoom)
          },
          onAgentThinking: (agent, delta) => {
            setStreaming((current) => current?.agentId === `agent:${agent.fileName}`
              ? { ...current, thinking: current.thinking + delta }
              : current)
          },
          onAgentMessageDelta: (agent, delta) => {
            setStreaming((current) => current?.agentId === `agent:${agent.fileName}`
              ? { ...current, response: current.response + delta }
              : current)
          },
          onAgentComplete: (agent, message) => {
            setStreaming(null)
            if (message) {
              nextRoom = {
                ...nextRoom,
                messages: nextRoom.messages.some((current) => current.id === message.id)
                  ? nextRoom.messages
                  : [...nextRoom.messages, message],
                round: { ...nextRoom.round, activeAgentId: null },
              }
              setRoom(nextRoom)
              updatePanelContext(nextRoom)
            } else {
              emptyAgentName = agent.name
              nextRoom = { ...nextRoom, round: { ...nextRoom.round, activeAgentId: null, error: `${agent.name} no devolvió una respuesta.` } }
              setRoom(nextRoom)
              updatePanelContext(nextRoom)
            }
          },
        })
        if (replies.length === 0) {
          nextRoom = { ...nextRoom, round: { ...nextRoom.round, status: 'agent-no-response', activeAgentId: null, error: 'Un agente no devolvió una respuesta.' } }
          break
        }
        automaticRounds += 1
        nextRoom = {
          ...nextRoom,
          round: {
            ...nextRoom.round,
            status: emptyAgentName ? 'agent-no-response' : 'waiting-user',
            automaticRounds,
            activeAgentId: null,
            error: emptyAgentName ? `${emptyAgentName} no devolvió una respuesta.` : null,
          },
        }
        setRoom(nextRoom)
        updatePanelContext(nextRoom)
        if (emptyAgentName) break
        // A dynamic can ask for automatic turns, but every chain is capped.
        if (!dynamicAllowsAutomaticTurns(nextRoom.dynamic.content) || automaticRounds >= nextRoom.round.automaticRoundLimit) break
        pendingParticipants = selectMultichatParticipants({ agents: nextRoom.agents, dynamicContent: nextRoom.dynamic.content })
      }
      setRoom(nextRoom)
      updatePanelContext(nextRoom)
    } catch (cause) {
      setStreaming(null)
      const cancelled = controller.signal.aborted
      nextRoom = { ...nextRoom, cancelled, round: { ...nextRoom.round, status: cancelled ? 'cancelled' : 'error', activeAgentId: null, error: cancelled ? null : (cause instanceof Error ? cause.message : 'Falló un agente.') } }
      setRoom(nextRoom)
      updatePanelContext(nextRoom)
    } finally {
      abortRef.current = null
      setStreaming(null)
      setLoading(false)
    }
  }

  const cancel = () => abortRef.current?.abort()
  const agentNames = useMemo(() => new Set(selectedPromptFiles), [selectedPromptFiles])

  if (!library) return <main className="notia-main"><div className="notia-empty-state">Seleccioná una biblioteca para usar Multichat.</div></main>
  if (!room) return (
    <main className="notia-main multichat-view">
      <section className="notia-card multichat-setup" aria-labelledby="multichat-title">
        <h1 id="multichat-title">Multichat</h1>
        <p>Creá una sala efímera con una dinámica y entre uno y seis agentes.</p>
         <label className="multichat-field">Dinámica
           <select className="multichat-select" value={dynamicFile} onChange={(event) => setDynamicFile(event.target.value)}>
            <option value="">Seleccionar dinámica</option>
            {dynamics.map((dynamic) => <option key={dynamic.fileName} value={dynamic.fileName} disabled={!dynamic.content.trim()}>{dynamic.name}{dynamic.content.trim() ? '' : ' (vacía o inválida)'}</option>)}
          </select>
         </label>
         <label className="multichat-field">Contexto adicional (opcional)
           <textarea
             className="multichat-context-input"
             value={contextDraft}
             onChange={(event) => setContextDraft(event.target.value)}
             placeholder="Información que todos los agentes deben recordar durante toda la sala…"
             rows={5}
           />
           <span className="multichat-field-help">Se incluirá junto con la dinámica y el prompt de cada agente en cada turno.</span>
         </label>
         <fieldset className="multichat-choice-group"><legend>Agentes ({selectedPromptFiles.length}/6)</legend>
           {prompts.map((prompt) => <label className="multichat-choice" key={prompt.fileName}><input type="checkbox" disabled={invalidPromptFiles.has(prompt.fileName)} checked={agentNames.has(prompt.fileName)} onChange={() => setSelectedPromptFiles((current) => current.includes(prompt.fileName) ? current.filter((name) => name !== prompt.fileName) : current.length < 6 ? [...current, prompt.fileName] : current)} /> {prompt.name}{invalidPromptFiles.has(prompt.fileName) ? ' (vacío o inválido)' : ''}</label>)}
         </fieldset>
         {error ? <p role="alert">{error}</p> : null}
         <button className="notia-button notia-button--primary" type="button" disabled={loading} onClick={() => void startRoom()}>Crear sala</button>
      </section>
    </main>
  )

  return <main className="notia-main multichat-view">
    <section className="multichat-room" aria-labelledby="multichat-room-title">
       <header><h1 id="multichat-room-title">{room.dynamic.name}</h1><span>Ollama · sin tools</span></header>
       {room.contextContent ? <details className="multichat-room-context"><summary>Contexto adicional de la sala</summary><p>{room.contextContent}</p></details> : null}
      <div className="multichat-agents" aria-label="Agentes seleccionados">{room.agents.map((agent) => <span key={agent.fileName} style={{ color: agent.color }}>{agent.icon} {agent.name}</span>)}</div>
       <div className="multichat-messages" aria-live="polite">{room.messages.map((message) => <article key={message.id} className={`multichat-message multichat-message--${message.speakerId === 'user' ? 'user' : 'agent'}`}><strong style={{ color: message.speakerId === 'user' ? undefined : room.agents.find((agent) => `agent:${agent.fileName}` === message.speakerId)?.color }}>{message.speakerName}</strong><p>{message.content}</p></article>)}{streaming ? <article className="multichat-message multichat-message--agent multichat-message--streaming"><strong style={{ color: streaming.agentColor }}>{streaming.agentIcon} {streaming.agentName}</strong>{streaming.thinking ? <details open><summary>Pensando…</summary><p>{streaming.thinking}</p></details> : null}<p>{streaming.response || 'Generando respuesta…'}</p></article> : null}{room.messages.length === 0 && !streaming ? <p>La sala está vacía. Escribí el primer mensaje.</p> : null}</div>
      <p role="status">{loading ? 'Los agentes están respondiendo en secuencia…' : room.round.status === 'waiting-user' ? 'Esperando tu próximo mensaje.' : room.round.error ?? ''}</p>
      <textarea aria-label="Mensaje para Multichat" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={loading} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} />
       <div className="multichat-composer-actions"><button className="notia-button notia-button--primary" type="button" disabled={loading || !draft.trim()} onClick={() => void sendMessage()}>Enviar</button>{loading ? <button className="notia-button notia-button--danger" type="button" onClick={cancel}>Cancelar</button> : null}</div>
    </section>
  </main>
}
