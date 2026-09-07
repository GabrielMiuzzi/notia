import { beforeEach, describe, expect, it } from 'vitest'
import { clearAiOperationHistoryForTests, listAiOperationHistory, markAiOperationHistoryUndone, recordAiOperationHistory } from './aiOperationHistory'

describe('aiOperationHistory', () => {
  const values = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }

  beforeEach(() => {
    values.clear()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } })
    clearAiOperationHistoryForTests()
  })

  it('stores metadata without document contents', () => {
    recordAiOperationHistory({ operationId: 'op-1', documentPath: 'docs/a.md', summary: 'Mejorar', status: 'applied', appliedAt: 1, undoneAt: null })
    expect(listAiOperationHistory()).toHaveLength(1)
    expect(JSON.stringify(listAiOperationHistory())).not.toContain('contenido')
  })

  it('updates status when an operation is undone', () => {
    recordAiOperationHistory({ operationId: 'op-1', documentPath: 'docs/a.md', summary: 'Mejorar', status: 'applied', appliedAt: 1, undoneAt: null })
    markAiOperationHistoryUndone('op-1', 2)
    expect(listAiOperationHistory()[0]).toMatchObject({ status: 'undone', undoneAt: 2 })
  })
})
