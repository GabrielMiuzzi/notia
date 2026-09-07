import { describe, expect, it } from 'vitest'
import { AI_CONTEXT_BUDGET, parseLegacyXmlToolCalls, parseNativeToolCalls } from './aiRuntime'

describe('AI_CONTEXT_BUDGET', () => {
  it('publishes bounded context limits for every runtime consumer', () => {
    expect(AI_CONTEXT_BUDGET).toEqual({
      maxMemoryItems: 50,
      maxContextChars: 30_000,
      maxIndexContextFiles: 50,
      maxIndexContextChars: 6_000,
    })
  })
})

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

  it('recovers Qwen tool calls emitted as a Markdown code block', () => {
    const tools = [{
      type: 'function' as const,
      function: { name: 'replace_active_markdown_document', description: 'replace', parameters: {} },
    }]

    expect(parseLegacyXmlToolCalls(
      '```tool_call\nreplace_active_markdown_document\n{"content":"# Actualizado"}\n```',
      tools,
    )).toEqual([{
      function: { name: 'replace_active_markdown_document', arguments: { content: '# Actualizado' } },
    }])
  })

  it('recovers Qwen tool calls with a JSON body inside tool_call tags', () => {
    const tools = [{
      type: 'function' as const,
      function: { name: 'read_active_markdown_document', description: 'read', parameters: {} },
    }]

    expect(parseLegacyXmlToolCalls(
      '<tool_call>\nread_active_markdown_document\n{}\n</tool_call>',
      tools,
    )).toEqual([{
      function: { name: 'read_active_markdown_document', arguments: {} },
    }])
  })

  it('recovers the standard Qwen JSON tool_call wrapper', () => {
    const tools = [{
      type: 'function' as const,
      function: { name: 'read_active_markdown_document', description: 'read', parameters: {} },
    }]

    expect(parseLegacyXmlToolCalls(
      '<tool_call>{"name":"read_active_markdown_document","arguments":{}}</tool_call>',
      tools,
    )).toEqual([{
      function: { name: 'read_active_markdown_document', arguments: {} },
    }])
  })
})
