import { describe, expect, it } from 'vitest'
import { createXGraphDocument, createXGraphPlaceholder, isXGraphLanguage, XGRAPH_MAX_SOURCE_LENGTH } from './xgraphEngine'

describe('XGraph Markdown preview', () => {
  it('recognizes the persisted language and its JSXGraph alias without capturing other blocks', () => {
    expect(isXGraphLanguage(' XGraph ')).toBe(true)
    expect(isXGraphLanguage('JSXGraph')).toBe(true)
    expect(isXGraphLanguage('math')).toBe(false)
    expect(isXGraphLanguage('javascript')).toBe(false)
  })

  it('preserves code through the sanitized placeholder without injecting markup', () => {
    const source = 'board.create("text", [0, 0, \'<img src=x onerror="alert(1)">\']);\n// español'
    const placeholder = createXGraphPlaceholder(source)
    const encoded = placeholder.match(/data-xgraph-code="([^"]*)"/)?.[1]
    expect(decodeURIComponent(encoded ?? '')).toBe(source)
    expect(placeholder).not.toContain('<img')
  })

  it('limits source size before creating a sandbox', () => {
    expect(createXGraphPlaceholder('x'.repeat(XGRAPH_MAX_SOURCE_LENGTH))).toContain('data-xgraph-code')
    expect(createXGraphPlaceholder('x'.repeat(XGRAPH_MAX_SOURCE_LENGTH + 1))).toContain('role="alert"')
    expect(createXGraphPlaceholder('x'.repeat(XGRAPH_MAX_SOURCE_LENGTH + 1))).not.toContain('data-xgraph-code')
  })

  it('keeps hostile script closing tags inside the code argument and blocks network APIs', () => {
    const html = createXGraphDocument('</script><script>alert(1)</script>', '/* local runtime */', '', 'testnonce')
    expect(html.match(/<script /g)).toHaveLength(2)
    expect(html).toContain('\\u003c/script>')
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("document.getElementById('error-message').textContent")
    expect(html).toContain("new Function('board', 'JXG', 'BOARDID'")
  })
})
