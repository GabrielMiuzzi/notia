import { describe, expect, it } from 'vitest'
import { parseNativeToolCalls } from './aiRuntime'

describe('parseNativeToolCalls', () => {
  it('accepts native object arguments', () => {
    expect(parseNativeToolCalls([{
      function: { name: 'search_task_context', arguments: { query: 'urgentes' } },
    }])).toEqual([{
      function: { name: 'search_task_context', arguments: { query: 'urgentes' } },
    }])
  })

  it('accepts JSON-string arguments emitted by compatible Ollama models', () => {
    expect(parseNativeToolCalls([{
      function: { name: 'read_library_documents', arguments: '{"documentIds":["doc-1"]}' },
    }])[0]?.function.arguments).toEqual({ documentIds: ['doc-1'] })
  })

  it('rejects malformed or unnamed tool calls', () => {
    expect(parseNativeToolCalls([
      { function: { name: '', arguments: {} } },
      { function: { name: 'read_file', arguments: '{bad json}' } },
    ])).toEqual([])
  })
})
