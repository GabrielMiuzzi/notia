import {
  MULTICHAT_MAX_AGENTS,
  MULTICHAT_MAX_MESSAGES,
  MULTICHAT_MIN_AGENTS,
  type MultichatAgent,
  type MultichatMessage,
  type MultichatSerializedMessage,
} from '../../types/multichat'

export type RandomSource = () => number

export interface ParticipantSelectionInput {
  agents: readonly MultichatAgent[]
  dynamicContent: string
  random?: RandomSource
}

const ALL_PARTICIPANTS_PATTERN = /\b(?:todos?|todas?|all|everyone|cada agente)\b/i
const MANUAL_INTERVENTION_PATTERN = /\b(?:esper(?:a|en|ar|en)\s+(?:la\s+)?intervenci[oó]n\s+del\s+usuario|esper(?:a|en|ar|en)\s+al\s+usuario|sin\s+turnos\s+autom[aá]ticos|no\s+(?:encaden(?:en|ar)|respondan\s+entre\s+agentes))/i

export function dynamicAllowsAutomaticTurns(dynamicContent: string): boolean {
  return !MANUAL_INTERVENTION_PATTERN.test(dynamicContent)
}

function clampRandom(value: number): number {
  return Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0
}

function randomIndex(random: RandomSource, length: number): number {
  return Math.floor(clampRandom(random()) * length)
}

/**
 * The dynamic is an instruction, never an authorization boundary. Explicit
 * agent names may narrow a round and an explicit "all" instruction keeps the
 * whole fixed set. Otherwise each round uses a random non-empty subset and a
 * random order to avoid making every exchange sound like a roll call.
 */
export function selectMultichatParticipants({ agents, dynamicContent, random = Math.random }: ParticipantSelectionInput): MultichatAgent[] {
  const selected = agents.slice(0, MULTICHAT_MAX_AGENTS)
  if (selected.length <= MULTICHAT_MIN_AGENTS) return [...selected]

  const normalizedDynamic = dynamicContent.toLocaleLowerCase()
  const named = selected.filter((agent) => normalizedDynamic.includes(agent.name.toLocaleLowerCase()))
  const pool = named.length > 0 ? named : selected
  const explicitParticipants = named.length > 0 || ALL_PARTICIPANTS_PATTERN.test(dynamicContent)
  const count = explicitParticipants ? pool.length : 1 + randomIndex(random, pool.length)
  const ordered = [...pool]

  for (let index = ordered.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(random, index + 1)
    const current = ordered[index]
    ordered[index] = ordered[swapIndex]
    ordered[swapIndex] = current
  }

  return ordered.slice(0, count)
}

export function chooseAutomaticRoundLimit(random: RandomSource = Math.random): number {
  return 1 + randomIndex(random, 4)
}

export function appendMultichatMessage(messages: readonly MultichatMessage[], message: MultichatMessage): MultichatMessage[] {
  return [...messages, message]
}

export function serializeMultichatHistory(messages: readonly MultichatMessage[]): MultichatSerializedMessage[] {
  return messages.slice(-MULTICHAT_MAX_MESSAGES).map((message) => ({
    speaker: message.speakerId,
    name: message.speakerName,
    content: message.content,
  }))
}

export function formatMultichatHistory(messages: readonly MultichatMessage[]): string {
  return serializeMultichatHistory(messages)
    .map((message) => `${message.speaker === 'user' ? 'Usuario' : message.name}: ${message.content}`)
    .join('\n\n')
}

export function validateAgentSelection(agents: readonly MultichatAgent[]): string | null {
  if (agents.length < MULTICHAT_MIN_AGENTS || agents.length > MULTICHAT_MAX_AGENTS) {
    return 'Seleccioná entre uno y seis agentes.'
  }
  const ids = agents.map((agent) => agent.fileName.toLocaleLowerCase())
  if (new Set(ids).size !== ids.length) return 'No se puede seleccionar el mismo agente dos veces.'
  if (agents.some((agent) => !agent.fileName.trim() || !agent.prompt.trim())) return 'Todos los agentes seleccionados deben tener un prompt válido.'
  return null
}

export interface SequentialTurnInput {
  agents: readonly MultichatAgent[]
  messages: readonly MultichatMessage[]
  random?: RandomSource
  signal?: AbortSignal
  invoke: (agent: MultichatAgent, history: readonly MultichatSerializedMessage[]) => Promise<string>
  onAgentStart?: (agent: MultichatAgent) => void
  onAgentComplete?: (agent: MultichatAgent, message: MultichatMessage | null) => void
  now?: () => number
  id?: () => string
}

export async function runSequentialMultichatTurns(input: SequentialTurnInput): Promise<MultichatMessage[]> {
  const participants = input.agents
  const result: MultichatMessage[] = []
  let history = [...input.messages]
  for (const agent of participants) {
    if (input.signal?.aborted) throw new DOMException('La ronda fue cancelada.', 'AbortError')
    input.onAgentStart?.(agent)
    const content = (await input.invoke(agent, serializeMultichatHistory(history))).trim()
    if (input.signal?.aborted) throw new DOMException('La ronda fue cancelada.', 'AbortError')
    if (!content) {
      input.onAgentComplete?.(agent, null)
      continue
    }
    const message: MultichatMessage = {
      id: input.id?.() ?? `${agent.fileName}:${input.now?.() ?? Date.now()}`,
      speakerId: `agent:${agent.fileName}`,
      speakerName: agent.name,
      content,
      createdAt: input.now?.() ?? Date.now(),
    }
    result.push(message)
    history = appendMultichatMessage(history, message)
    input.onAgentComplete?.(agent, message)
  }
  return result
}
