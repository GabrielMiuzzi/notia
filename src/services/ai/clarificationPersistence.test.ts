import { beforeEach, describe, expect, it } from 'vitest'
import { buildClarificationResumePrompt, canResumeClarification, clearClarificationRequest, loadClarificationRequest, normalizeClarificationAnswer, saveClarificationRequest } from './clarificationPersistence'

describe('clarificationPersistence', () => {
  const values = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }

  beforeEach(() => {
    values.clear()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } })
  })

  it('persists only bounded, resumable clarification metadata', () => {
    saveClarificationRequest({ version: 1, requestId: 'request-1', libraryId: 'library-1', question: '¿Cuál?', choices: ['A'], scope: 'document', documentPath: 'docs/a.md', revision: 2, createdAt: 1, expiresAt: Date.now() + 10_000 })
    expect(loadClarificationRequest('library-1')).toMatchObject({ requestId: 'request-1', choices: ['A'], revision: 2 })
  })

  it('discards expired requests', () => {
    saveClarificationRequest({ version: 1, requestId: 'request-1', libraryId: 'library-1', question: '¿Cuál?', choices: [], scope: 'document', documentPath: null, revision: null, createdAt: 1, expiresAt: Date.now() - 1 })
    expect(loadClarificationRequest('library-1')).toBeNull()
    clearClarificationRequest('library-1')
  })

  it('invalidates a persisted clarification when its authorized context changed', () => {
    const request = {
      version: 1 as const, requestId: 'request-1', libraryId: 'library-1', question: '¿Cuál?', choices: [],
      scope: 'document', documentPath: 'docs/a.md', revision: 2, createdAt: 1, expiresAt: Date.now() + 10_000,
    }
    expect(canResumeClarification(request, { libraryId: 'library-1', scope: 'document', documentPath: 'docs/a.md', revision: 2 })).toBe(true)
    expect(canResumeClarification(request, { libraryId: 'library-1', scope: 'document', documentPath: 'docs/a.md', revision: 3 })).toBe(false)
    expect(canResumeClarification(request, { libraryId: 'library-1', scope: 'library', documentPath: 'docs/a.md', revision: 2 })).toBe(false)
  })

  it('normalizes common clarification control answers', () => {
    expect(normalizeClarificationAnswer('todos')).toBe('all')
    expect(normalizeClarificationAnswer('ninguna')).toBe('none')
    expect(normalizeClarificationAnswer('cancelá')).toBe('cancelled')
    expect(normalizeClarificationAnswer('Opción B')).toBe('Opción B')
  })
  it('builds a bounded continuation prompt and never resumes cancellation', () => {
    const request = {
      version: 1 as const, requestId: 'request-1', libraryId: 'library-1', question: 'Â¿CuÃ¡l de estos documentos?', choices: ['A', 'B'],
      scope: 'document', documentPath: 'docs/a.md', revision: 2, createdAt: 1, expiresAt: Date.now() + 10_000,
    }
    expect(buildClarificationResumePrompt(request, 'B')).toContain('Respuesta del usuario: B')
    expect(buildClarificationResumePrompt(request, 'cancelar')).toBeNull()
  })
})
