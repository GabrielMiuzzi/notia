import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMultichatRound } from './multichatRuntime'
import type { MultichatAgent } from '../../types/multichat'

const { streamAiChatReply } = vi.hoisted(() => ({
  streamAiChatReply: vi.fn(),
}))

vi.mock('../ai/aiRuntime', () => ({ streamAiChatReply }))

const agents: MultichatAgent[] = [
  { fileName: 'one.md', name: 'one', prompt: 'Prompt one', icon: 'A', color: '#111' },
  { fileName: 'two.md', name: 'two', prompt: 'Prompt two', icon: 'B', color: '#222' },
]

describe('multichatRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamAiChatReply.mockImplementation(async (_preferences, input, options) => {
      const response = input.prompt.includes('Prompt one') ? 'Respuesta uno' : 'Respuesta dos'
      options.onThinkingDelta?.('pensando ')
      options.onMessageDelta?.(response)
      return response
    })
  })

  it('runs selected agents sequentially through flat Ollama streaming without tools', async () => {
    const thinking: string[] = []
    const deltas: string[] = []
    const replies = await runMultichatRound({
      aiPreferences: {} as never,
      dynamic: { fileName: 'debate.md', name: 'debate', content: 'Todos respondan.' },
      agents,
      contextContent: 'La moción trata sobre energía renovable.',
      messages: [],
      random: () => 0,
      onAgentThinking: (_agent, delta) => thinking.push(delta),
      onAgentMessageDelta: (_agent, delta) => deltas.push(delta),
    })

    expect(replies.map((reply) => reply.speakerName)).toEqual(['one', 'two'])
    expect(streamAiChatReply).toHaveBeenCalledTimes(2)
    expect(streamAiChatReply.mock.calls[0][1].prompt).toContain('La moción trata sobre energía renovable.')
    expect(streamAiChatReply.mock.calls[1][1].prompt).toContain('one: Respuesta uno')
    expect(thinking).toEqual(['pensando ', 'pensando '])
    expect(deltas).toEqual(['Respuesta uno', 'Respuesta dos'])
    expect(streamAiChatReply.mock.calls.every(([, input]) => input.files.length === 0)).toBe(true)
    expect(streamAiChatReply.mock.calls.every(([, input]) => !('tools' in input))).toBe(true)
    expect(streamAiChatReply.mock.calls.every(([, , options]) => options.onMessageDelta && options.onThinkingDelta)).toBe(true)
  })
})
