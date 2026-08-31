import { describe, expect, it } from 'vitest'
import { parseLegacyXmlToolCalls, parseNativeToolCalls } from './aiRuntime'

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

  it('recovers legacy XML read calls as native tool calls', () => {
    const tools = [{
      type: 'function' as const,
      function: { name: 'read_library_documents', description: 'read', parameters: {} },
    }]

    expect(parseLegacyXmlToolCalls(
      '<read/librarydocument>\n<documentId>doc-44</documentId>\n</read/librarydocument>',
      tools,
    )).toEqual([{
      function: { name: 'read_library_documents', arguments: { documentIds: ['doc-44'] } },
    }])
  })

  it('recovers wrapped legacy calls whose name omits underscores', () => {
    const tools = [{
      type: 'function' as const,
      function: { name: 'list_finance_accounts', description: 'accounts', parameters: {} },
    }]

    expect(parseLegacyXmlToolCalls(
      '<tool_call>\n<name>listfinanceaccounts</name>\n<arguments>{}</arguments>\n</tool_call>',
      tools,
    )).toEqual([{
      function: { name: 'list_finance_accounts', arguments: {} },
    }])
  })

  it('recovers empty legacy finance list calls instead of returning their XML to the user', () => {
    const tools = [{
      type: 'function' as const,
      function: { name: 'list_finance_categories', description: 'categories', parameters: {} },
    }]

    expect(parseLegacyXmlToolCalls('<list_categories>\n</list_categories>', tools)).toEqual([{
      function: { name: 'list_finance_categories', arguments: {} },
    }])
  })
})
