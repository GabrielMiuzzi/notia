import { describe, expect, it, vi } from 'vitest'
import { chooseAutomaticRoundLimit, dynamicAllowsAutomaticTurns, formatMultichatHistory, runSequentialMultichatTurns, selectMultichatParticipants, serializeMultichatHistory } from './multichatEngine'
import type { MultichatAgent, MultichatMessage } from '../../types/multichat'

const agents: MultichatAgent[] = [
  { fileName: 'one.md', name: 'one', prompt: 'p1', icon: 'A', color: '#111' },
  { fileName: 'two.md', name: 'two', prompt: 'p2', icon: 'B', color: '#222' },
  { fileName: 'three.md', name: 'three', prompt: 'p3', icon: 'C', color: '#333' },
]

function message(index: number): MultichatMessage {
  return { id: `${index}`, speakerId: index % 2 ? 'user' : 'agent:one.md', speakerName: index % 2 ? 'Usuario' : 'one', content: `m${index}`, createdAt: index }
}

describe('multichatEngine', () => {
  it('never selects agents outside the fixed room set and honors explicit names', () => {
    expect(selectMultichatParticipants({ agents: [agents[0], agents[1]], dynamicContent: 'Solo two' }).map((agent) => agent.name)).toEqual(['two'])
    expect(selectMultichatParticipants({ agents: [agents[0], agents[1]], dynamicContent: 'Elegí cualquiera al azar', random: () => 0.99 })).toHaveLength(2)
  })

  it('chooses a random non-empty subset and randomizes its order by default', () => {
    const randomValues = [0.99, 0, 0]
    const participants = selectMultichatParticipants({
      agents,
      dynamicContent: 'Conversen de forma natural.',
      random: () => randomValues.shift() ?? 0,
    })

    expect(participants.map((agent) => agent.name)).toEqual(['two', 'three', 'one'])
  })

  it('keeps every selected agent for an explicit all instruction but still randomizes order', () => {
    const randomValues = [0, 0]
    const participants = selectMultichatParticipants({
      agents,
      dynamicContent: 'Todos respondan en esta ronda.',
      random: () => randomValues.shift() ?? 0,
    })

    expect(participants.map((agent) => agent.name)).toEqual(['two', 'three', 'one'])
  })

  it('uses an injectable automatic-turn random source', () => {
    expect(chooseAutomaticRoundLimit(() => 0)).toBe(1)
    expect(chooseAutomaticRoundLimit(() => 0.99)).toBe(4)
  })

  it('allows automatic chains by default unless the dynamic waits for the user', () => {
    expect(dynamicAllowsAutomaticTurns('Respondan entre agentes automáticamente')).toBe(true)
    expect(dynamicAllowsAutomaticTurns('Esperen la intervención del usuario')).toBe(false)
    expect(dynamicAllowsAutomaticTurns('Analicen el tema y continúen la conversación')).toBe(true)
  })

  it('limits serialized context to forty messages and labels speakers', () => {
    const history = Array.from({ length: 45 }, (_, index) => message(index))
    expect(serializeMultichatHistory(history)).toHaveLength(40)
    expect(formatMultichatHistory(history)).toContain('one: m42')
    expect(formatMultichatHistory(history)).toContain('Usuario: m43')
  })

  it('executes sequentially with history updated after every answer', async () => {
    const histories: number[] = []
    const started: string[] = []
    const completed: string[] = []
    const replies = await runSequentialMultichatTurns({
      agents,
      messages: [],
      invoke: async (_agent, history) => { histories.push(history.length); return 'respuesta' },
      onAgentStart: (agent) => started.push(agent.name),
      onAgentComplete: (agent) => completed.push(agent.name),
      now: () => 1,
      id: (() => { let i = 0; return () => `id-${i++}` })(),
    })
    expect(histories).toEqual([0, 1, 2])
    expect(started).toEqual(['one', 'two', 'three'])
    expect(completed).toEqual(['one', 'two', 'three'])
    expect(replies.map((reply) => reply.speakerId)).toEqual(['agent:one.md', 'agent:two.md', 'agent:three.md'])
  })

  it('reports an empty agent response without adding a blank message', async () => {
    const completed: Array<string | null> = []
    const replies = await runSequentialMultichatTurns({
      agents: [agents[0]],
      messages: [],
      invoke: async () => '',
      onAgentComplete: (agent, message) => completed.push(`${agent.name}:${message}`),
    })

    expect(replies).toEqual([])
    expect(completed).toEqual(['one:null'])
  })

  it('stops before invoking an agent when the round is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const invoke = vi.fn()

    await expect(runSequentialMultichatTurns({
      agents,
      messages: [],
      signal: controller.signal,
      invoke,
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not append a response that becomes obsolete after cancellation', async () => {
    const controller = new AbortController()
    const invoke = vi.fn(async () => {
      controller.abort()
      return 'respuesta obsoleta'
    })

    await expect(runSequentialMultichatTurns({
      agents: [agents[0]],
      messages: [],
      signal: controller.signal,
      invoke,
    })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
