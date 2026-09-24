import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../types/notia'
import { MULTICHAT_MAX_AGENTS } from '../../../types/multichat'
import { clearMultichatPanelContext, setMultichatPanelContext } from '../../../services/multichat/multichatSessionStore'
import {
  cancelMultichatRound,
  closeMultichatRoom,
  loadMultichatCatalog,
  openMultichatRoom,
  sendMultichatMessage,
  subscribeMultichatEvents,
  type MultichatCatalog,
  type MultichatRoomView,
} from '../../../services/multichat/multichatRuntime'

const MULTICHAT_PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2'] as const
const MULTICHAT_ICONS = ['●', '◆', '▲', '■', '★', '✦'] as const

interface MultichatViewProps {
  library: NotiaLibrary | null
}

interface StreamingTurn {
  agentId: string
  agentName: string
  thinking: string
  response: string
}

/** Color and icon of each agent, by its position in the room. */
function agentLook(room: MultichatRoomView, agentId: string): { color: string; icon: string } {
  const index = Math.max(0, room.agents.findIndex((agent) => `agent:${agent.fileName}` === agentId))
  return { color: MULTICHAT_PALETTE[index % MULTICHAT_PALETTE.length], icon: MULTICHAT_ICONS[index % MULTICHAT_ICONS.length] }
}

/**
 * Multichat room. The backend keeps the room, runs the agents' rounds and
 * streams their answers; this view picks the setup, sends messages and
 * renders the room and the turn being streamed.
 */
export function MultichatView({ library }: MultichatViewProps) {
  const [catalog, setCatalog] = useState<MultichatCatalog>({ dynamics: [], agents: [] })
  const [dynamicFile, setDynamicFile] = useState('')
  const [contextDraft, setContextDraft] = useState('')
  const [selectedAgentFiles, setSelectedAgentFiles] = useState<string[]>([])
  const [room, setRoom] = useState<MultichatRoomView | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState<StreamingTurn | null>(null)
  const roomIdRef = useRef<string | null>(null)

  const updatePanelContext = useCallback((nextRoom: MultichatRoomView | null) => {
    if (!nextRoom) {
      clearMultichatPanelContext()
      return
    }
    setMultichatPanelContext({ roomId: nextRoom.roomId, label: 'Contexto activo: sala Multichat' })
  }, [])

  const showRoom = useCallback((nextRoom: MultichatRoomView) => {
    setRoom(nextRoom)
    updatePanelContext(nextRoom)
    if (!nextRoom.round.activeAgentId) setStreaming(null)
  }, [updatePanelContext])

  useEffect(() => {
    if (!library) return
    let current = true
    void loadMultichatCatalog(library.id)
      .then((nextCatalog) => { if (current) setCatalog(nextCatalog) })
      .catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar dinámicas y agentes.') })
    return () => { current = false }
  }, [library])

  // Events of the active room: room changes and the streamed turn.
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    void subscribeMultichatEvents((event) => {
      if (event.roomId !== roomIdRef.current) return
      if (event.kind === 'room') {
        showRoom(event.room)
      } else if (event.kind === 'agentStart') {
        setStreaming({ agentId: event.agentId, agentName: event.agentName, thinking: '', response: '' })
      } else {
        setStreaming((currentTurn) => currentTurn?.agentId === event.agentId
          ? event.kind === 'thinking'
            ? { ...currentTurn, thinking: currentTurn.thinking + event.delta }
            : { ...currentTurn, response: currentTurn.response + event.delta }
          : currentTurn)
      }
    }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [showRoom])

  // A room belongs to its library and to this view.
  useEffect(() => {
    if (room && (!library || room.libraryId !== library.id)) {
      void closeMultichatRoom(room.roomId)
      roomIdRef.current = null
      clearMultichatPanelContext(room.roomId)
      setRoom(null)
    }
  }, [library, room])

  useEffect(() => () => {
    if (roomIdRef.current) void closeMultichatRoom(roomIdRef.current)
    clearMultichatPanelContext()
  }, [])

  const startRoom = async () => {
    if (!library) return
    setError(null)
    setLoading(true)
    try {
      const nextRoom = await openMultichatRoom({
        libraryId: library.id,
        dynamicFile,
        agentFiles: selectedAgentFiles,
        context: contextDraft,
      })
      roomIdRef.current = nextRoom.roomId
      showRoom(nextRoom)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la sala.')
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async () => {
    if (!room || !draft.trim() || loading) return
    const content = draft.trim()
    setDraft('')
    setLoading(true)
    try {
      showRoom(await sendMultichatMessage(room.roomId, content))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falló un agente.')
    } finally {
      setStreaming(null)
      setLoading(false)
    }
  }

  const cancel = () => {
    if (room) void cancelMultichatRound(room.roomId)
  }
  const selectedAgents = useMemo(() => new Set(selectedAgentFiles), [selectedAgentFiles])

  if (!library) return <main className="notia-main"><div className="notia-empty-state">Seleccioná una biblioteca para usar Multichat.</div></main>
  if (!room) return (
    <main className="notia-main multichat-view">
      <section className="notia-card multichat-setup" aria-labelledby="multichat-title">
        <h1 id="multichat-title">Multichat</h1>
        <p>Creá una sala efímera con una dinámica y entre uno y seis agentes.</p>
         <label className="multichat-field">Dinámica
           <select className="multichat-select" value={dynamicFile} onChange={(event) => setDynamicFile(event.target.value)}>
            <option value="">Seleccionar dinámica</option>
            {catalog.dynamics.map((dynamic) => <option key={dynamic.fileName} value={dynamic.fileName} disabled={!dynamic.valid}>{dynamic.name}{dynamic.valid ? '' : ' (vacía o inválida)'}</option>)}
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
         <fieldset className="multichat-choice-group"><legend>Agentes ({selectedAgentFiles.length}/{MULTICHAT_MAX_AGENTS})</legend>
           {catalog.agents.map((agent) => <label className="multichat-choice" key={agent.fileName}><input type="checkbox" disabled={!agent.valid} checked={selectedAgents.has(agent.fileName)} onChange={() => setSelectedAgentFiles((current) => current.includes(agent.fileName) ? current.filter((name) => name !== agent.fileName) : current.length < MULTICHAT_MAX_AGENTS ? [...current, agent.fileName] : current)} /> {agent.name}{agent.valid ? '' : ' (vacío o inválido)'}</label>)}
         </fieldset>
         {error ? <p role="alert">{error}</p> : null}
         <button className="notia-button notia-button--primary" type="button" disabled={loading} onClick={() => void startRoom()}>Crear sala</button>
      </section>
    </main>
  )

  const streamingLook = streaming ? agentLook(room, streaming.agentId) : null
  return <main className="notia-main multichat-view">
    <section className="multichat-room" aria-labelledby="multichat-room-title">
       <header><h1 id="multichat-room-title">{room.dynamic.name}</h1><span>Ollama · sin tools</span></header>
       {room.contextContent ? <details className="multichat-room-context"><summary>Contexto adicional de la sala</summary><p>{room.contextContent}</p></details> : null}
      <div className="multichat-agents" aria-label="Agentes seleccionados">{room.agents.map((agent) => { const look = agentLook(room, `agent:${agent.fileName}`); return <span key={agent.fileName} style={{ color: look.color }}>{look.icon} {agent.name}</span> })}</div>
       <div className="multichat-messages" aria-live="polite">{room.messages.map((message) => <article key={message.id} className={`multichat-message multichat-message--${message.speakerId === 'user' ? 'user' : 'agent'}`}><strong style={{ color: message.speakerId === 'user' ? undefined : agentLook(room, message.speakerId).color }}>{message.speakerName}</strong><p>{message.content}</p></article>)}{streaming && streamingLook ? <article className="multichat-message multichat-message--agent multichat-message--streaming"><strong style={{ color: streamingLook.color }}>{streamingLook.icon} {streaming.agentName}</strong>{streaming.thinking ? <details open><summary>Pensando…</summary><p>{streaming.thinking}</p></details> : null}<p>{streaming.response || 'Generando respuesta…'}</p></article> : null}{room.messages.length === 0 && !streaming ? <p>La sala está vacía. Escribí el primer mensaje.</p> : null}</div>
      <p role="status">{loading ? 'Los agentes están respondiendo en secuencia…' : room.round.status === 'waiting-user' ? 'Esperando tu próximo mensaje.' : room.round.error ?? error ?? ''}</p>
      <textarea aria-label="Mensaje para Multichat" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={loading} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} />
       <div className="multichat-composer-actions"><button className="notia-button notia-button--primary" type="button" disabled={loading || !draft.trim()} onClick={() => void sendMessage()}>Enviar</button>{loading ? <button className="notia-button notia-button--danger" type="button" onClick={cancel}>Cancelar</button> : null}</div>
    </section>
  </main>
}
