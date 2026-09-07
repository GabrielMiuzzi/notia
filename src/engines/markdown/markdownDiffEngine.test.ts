import { describe, expect, it } from 'vitest'
import { applyMarkdownMutationHunks, createMarkdownMutationPreview, summarizeMarkdownPreview } from './markdownDiffEngine'

describe('markdownDiffEngine', () => {
  it('creates a stable preview without exposing the whole document', () => {
    const preview = createMarkdownMutationPreview({
      operationId: 'op-1',
      documentPath: 'docs/guide.md',
      originalSource: '# Título\n\nTexto viejo.\n\nFin.',
      nextSource: '# Título\n\nTexto nuevo.\n\nFin.',
      expectedRevision: 10,
      currentRevision: 10,
      summary: 'Mejora de claridad',
    })

    expect(preview).toMatchObject({
      operationId: 'op-1',
      documents: [{ path: 'docs/guide.md', expectedRevision: 10, currentRevision: 10 }],
      hunks: [{ id: 'op-1:hunk-1', startLine: 3, endLine: 3, oldText: 'Texto viejo.', newText: 'Texto nuevo.' }],
    })
    expect(preview?.hunks[0]?.oldText).not.toContain('Fin.')
    expect(summarizeMarkdownPreview(preview!)).toContain('líneas 3-3')
  })

  it('returns no preview for an idempotent mutation', () => {
    expect(createMarkdownMutationPreview({
      operationId: 'op-2',
      documentPath: 'docs/guide.md',
      originalSource: 'igual',
      nextSource: 'igual',
      expectedRevision: 1,
      currentRevision: 1,
      summary: 'Sin cambios',
    })).toBeNull()
  })

  it('represents insertions and deletions as bounded hunks', () => {
    const insertion = createMarkdownMutationPreview({
      operationId: 'op-3',
      documentPath: 'docs/guide.md',
      originalSource: 'uno\ntres',
      nextSource: 'uno\ndos\ntres',
      expectedRevision: 1,
      currentRevision: 1,
      summary: 'Agregar línea',
    })
    const deletion = createMarkdownMutationPreview({
      operationId: 'op-4',
      documentPath: 'docs/guide.md',
      originalSource: 'uno\ndos\ntres',
      nextSource: 'uno\ntres',
      expectedRevision: 1,
      currentRevision: 1,
      summary: 'Quitar línea',
    })

    expect(insertion?.hunks[0]).toMatchObject({ startLine: 2, oldText: '', newText: 'dos' })
    expect(deletion?.hunks[0]).toMatchObject({ startLine: 2, oldText: 'dos', newText: '' })
  })

  it('keeps separated changes in independent hunks', () => {
    const preview = createMarkdownMutationPreview({
      operationId: 'op-5',
      documentPath: 'docs/guide.md',
      originalSource: 'uno\ndos\ntres\ncuatro\ncinco',
      nextSource: 'uno\nDOS\ntres\nCUATRO\ncinco',
      expectedRevision: 1,
      currentRevision: 1,
      summary: 'Mejorar formato',
    })
    expect(preview?.hunks).toHaveLength(2)
    expect(preview?.hunks.every((hunk) => hunk.anchor?.startsWith('hunk-'))).toBe(true)
    expect(preview?.hunks.map((hunk) => hunk.startLine)).toEqual([2, 4])
  })

  it('applies only the requested hunks and marks the rest as rejected', () => {
    const original = 'uno\ndos\ntres\ncuatro\ncinco'
    const preview = createMarkdownMutationPreview({
      operationId: 'op-selected',
      documentPath: 'docs/guide.md',
      originalSource: original,
      nextSource: 'uno\nDOS\ntres\nCUATRO\ncinco',
      expectedRevision: 1,
      currentRevision: 1,
      summary: 'Mejorar formato',
    })!
    const result = applyMarkdownMutationHunks(original, preview, [preview.hunks[1]!.id])

    expect(result).toMatchObject({ ok: true, source: 'uno\ndos\ntres\nCUATRO\ncinco' })
    expect(result.ok && result.preview.hunks.map((hunk) => hunk.status)).toEqual(['rejected', 'accepted'])
  })

  it('preserves structured Markdown outside the edited body hunk', () => {
    const original = [
      '---',
      'tags: [guia, producto]',
      '---',
      '',
      '# Guia',
      '',
      'Texto a mejorar.',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      '$$x^2 + y^2 = 1$$',
      '',
      '[Referencia](https://example.com)',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n')
    const next = original.replace('Texto a mejorar.', 'Texto mejorado sin tocar la estructura.')
    const preview = createMarkdownMutationPreview({
      operationId: 'op-structured',
      documentPath: 'docs/guide.md',
      originalSource: original,
      nextSource: next,
      expectedRevision: 1,
      currentRevision: 1,
      summary: 'Mejorar texto',
    })!
    const result = applyMarkdownMutationHunks(original, preview)

    expect(result).toMatchObject({ ok: true, source: next })
    expect(result.ok && result.preview.hunks).toHaveLength(1)
    expect(result.ok && result.preview.hunks[0]).toMatchObject({ startLine: 7, oldText: 'Texto a mejorar.' })
  })
})
