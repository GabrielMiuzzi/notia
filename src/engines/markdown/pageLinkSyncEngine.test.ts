import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  extractLinkPath,
  syncPageLink,
  detectPageLinkCycle,
} from './pageLinkSyncEngine.ts'

describe('extractLinkPath', () => {
  it('extracts plain wikilink reference', () => {
    assert.strictEqual(extractLinkPath('[[6-10.md]]'), '6-10.md')
  })

  it('extracts wikilink with alias', () => {
    assert.strictEqual(extractLinkPath('[[title|6-10.md]]'), '6-10.md')
  })

  it('extracts plain path without brackets', () => {
    assert.strictEqual(extractLinkPath('6-10.md'), '6-10.md')
  })

  it('returns null for N/A', () => {
    assert.strictEqual(extractLinkPath('N/A'), null)
  })

  it('returns null for empty string', () => {
    assert.strictEqual(extractLinkPath(''), null)
  })

  it('returns null for whitespace-only string', () => {
    assert.strictEqual(extractLinkPath('   '), null)
  })

  it('returns null for non-string values', () => {
    assert.strictEqual(extractLinkPath(null), null)
    assert.strictEqual(extractLinkPath(42), null)
    assert.strictEqual(extractLinkPath(undefined), null)
  })

  it('returns null for wikilink with empty reference', () => {
    assert.strictEqual(extractLinkPath('[[]]'), null)
  })
})

describe('syncPageLink', () => {
  it('sets nextPage on current and previousPage on target (with .md extension)', async () => {
    const files = new Map<string, string>([
      ['/docs/1-5.md', '---\n---\n\nBody A'],
      ['/docs/6-10.md', '---\n---\n\nBody B'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null
    const writeSource = async (path: string, source: string): Promise<void> => {
      files.set(path, source)
    }

    const currentSource = files.get('/docs/1-5.md')!
    const result = await syncPageLink(
      '/docs/1-5.md',
      currentSource,
      'nextPage',
      'N/A',
      '[[6-10.md]]',
      readSource,
      writeSource,
    )

    assert.strictEqual(result.mutated, true)
    assert.ok(result.currentSource.includes('nextPage: "[[6-10.md]]"'))

    const targetSource = files.get('/docs/6-10.md')!
    assert.ok(targetSource.includes('previousPage: "[[1-5.md]]"'))
  })

  it('auto-appends .md when reference lacks extension', async () => {
    const files = new Map<string, string>([
      ['/docs/1-5.md', '---\n---\n\nBody A'],
      ['/docs/6-10.md', '---\n---\n\nBody B'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null
    const writeSource = async (path: string, source: string): Promise<void> => {
      files.set(path, source)
    }

    const currentSource = files.get('/docs/1-5.md')!
    const result = await syncPageLink(
      '/docs/1-5.md',
      currentSource,
      'nextPage',
      'N/A',
      '[[6-10]]', // No .md extension
      readSource,
      writeSource,
    )

    assert.strictEqual(result.mutated, true)
    assert.ok(result.currentSource.includes('nextPage: "[[6-10]]"'))

    const targetSource = files.get('/docs/6-10.md')!
    assert.ok(targetSource.includes('previousPage: "[[1-5.md]]"'))
  })

  it('clears old target when changing nextPage', async () => {
    const files = new Map<string, string>([
      ['/docs/A.md', '---\nnextPage: [[B.md]]\n---\n\nBody A'],
      ['/docs/B.md', '---\npreviousPage: [[A.md]]\n---\n\nBody B'],
      ['/docs/C.md', '---\n---\n\nBody C'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null
    const writeSource = async (path: string, source: string): Promise<void> => {
      files.set(path, source)
    }

    const currentSource = files.get('/docs/A.md')!
    const result = await syncPageLink(
      '/docs/A.md',
      currentSource,
      'nextPage',
      '[[B.md]]',
      '[[C.md]]',
      readSource,
      writeSource,
    )

    assert.strictEqual(result.mutated, true)

    // B should have its previousPage cleared
    const bSource = files.get('/docs/B.md')!
    assert.ok(bSource.includes('previousPage: N/A') || bSource.includes('previousPage: "N/A"'))

    // C should have previousPage set to A
    const cSource = files.get('/docs/C.md')!
    assert.ok(cSource.includes('previousPage: [[A.md]]') || cSource.includes('previousPage: "[[A.md]]"'))
  })

  it('sets previousPage on current and nextPage on target (symmetric)', async () => {
    const files = new Map<string, string>([
      ['/docs/B.md', '---\n---\n\nBody B'],
      ['/docs/A.md', '---\n---\n\nBody A'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null
    const writeSource = async (path: string, source: string): Promise<void> => {
      files.set(path, source)
    }

    const currentSource = files.get('/docs/B.md')!
    const result = await syncPageLink(
      '/docs/B.md',
      currentSource,
      'previousPage',
      'N/A',
      '[[A.md]]',
      readSource,
      writeSource,
    )

    assert.strictEqual(result.mutated, true)
    assert.ok(result.currentSource.includes('previousPage: [[A.md]]') || result.currentSource.includes('previousPage: "[[A.md]]"'))

    const targetSource = files.get('/docs/A.md')!
    assert.ok(targetSource.includes('nextPage: "[[B.md]]"'))
  })

  it('does nothing when value is unchanged', async () => {
    const files = new Map<string, string>([
      ['/docs/A.md', '---\nnextPage: [[B.md]]\n---\n\nBody A'],
      ['/docs/B.md', '---\npreviousPage: [[A.md]]\n---\n\nBody B'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null
    const writeSource = async (_path: string, _source: string): Promise<void> => {
      throw new Error('Should not be called')
    }

    const currentSource = files.get('/docs/A.md')!
    const result = await syncPageLink(
      '/docs/A.md',
      currentSource,
      'nextPage',
      '[[B.md]]',
      '[[B.md]]',
      readSource,
      writeSource,
    )

    assert.strictEqual(result.mutated, false)
  })

  it('clears link when setting to N/A', async () => {
    const files = new Map<string, string>([
      ['/docs/A.md', '---\nnextPage: [[B.md]]\n---\n\nBody A'],
      ['/docs/B.md', '---\npreviousPage: [[A.md]]\n---\n\nBody B'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null
    const writeSource = async (path: string, source: string): Promise<void> => {
      files.set(path, source)
    }

    const currentSource = files.get('/docs/A.md')!
    const result = await syncPageLink(
      '/docs/A.md',
      currentSource,
      'nextPage',
      '[[B.md]]',
      'N/A',
      readSource,
      writeSource,
    )

    assert.strictEqual(result.mutated, true)
    assert.ok(result.currentSource.includes('nextPage: N/A'))

    // B should have its previousPage cleared
    const bSource = files.get('/docs/B.md')!
    assert.ok(bSource.includes('previousPage: N/A'))
  })

  it('does not break when target file does not exist', async () => {
    const files = new Map<string, string>([
      ['/docs/A.md', '---\n---\n\nBody A'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null
    const writeSource = async (_path: string, _source: string): Promise<void> => {
      throw new Error('Should not be called for missing file')
    }

    const currentSource = files.get('/docs/A.md')!
    const result = await syncPageLink(
      '/docs/A.md',
      currentSource,
      'nextPage',
      'N/A',
      '[[nonexistent.md]]',
      readSource,
      writeSource,
    )

    assert.strictEqual(result.mutated, true)
    assert.ok(result.currentSource.includes('nextPage: "[[nonexistent.md]]"'))
  })

  it('uses basename wikilink for cross-link so it is clickable in same directory', async () => {
    const files = new Map<string, string>([
      ['/docs/sub/A.md', '---\n---\n\nBody A'],
      ['/docs/sub/B.md', '---\n---\n\nBody B'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null
    const writeSource = async (path: string, source: string): Promise<void> => {
      files.set(path, source)
    }

    const currentSource = files.get('/docs/sub/A.md')!
    const result = await syncPageLink(
      '/docs/sub/A.md',
      currentSource,
      'nextPage',
      'N/A',
      '[[B.md]]',
      readSource,
      writeSource,
    )

    assert.strictEqual(result.mutated, true)

    const targetSource = files.get('/docs/sub/B.md')!
    // Should use the basename for the wikilink so it remains clickable
    assert.ok(targetSource.includes('previousPage: "[[A.md]]"'))
  })
})

describe('detectPageLinkCycle', () => {
  it('detects forward cycle A->B->C and C trying to link to A', async () => {
    const files = new Map<string, string>([
      ['/docs/A.md', '---\nnextPage: [[B.md]]\n---\n'],
      ['/docs/B.md', '---\nnextPage: [[C.md]]\npreviousPage: [[A.md]]\n---\n'],
      ['/docs/C.md', '---\npreviousPage: [[B.md]]\n---\n'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null

    const hasCycle = await detectPageLinkCycle('/docs/C.md', 'A.md', '/docs/C.md', readSource)
    assert.strictEqual(hasCycle, true)
  })

  it('allows linking when no cycle exists', async () => {
    const files = new Map<string, string>([
      ['/docs/A.md', '---\nnextPage: [[B.md]]\n---\n'],
      ['/docs/B.md', '---\npreviousPage: [[A.md]]\n---\n'],
      ['/docs/C.md', '---\n---\n'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null

    const hasCycle = await detectPageLinkCycle('/docs/C.md', 'D.md', '/docs/C.md', readSource)
    assert.strictEqual(hasCycle, false)
  })

  it('detects backward cycle (previousPage) B->A and A trying previousPage to B', async () => {
    const files = new Map<string, string>([
      ['/docs/A.md', '---\npreviousPage: [[B.md]]\n---\n'],
      ['/docs/B.md', '---\nnextPage: [[A.md]]\n---\n'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null

    const hasCycle = await detectPageLinkCycle('/docs/B.md', 'A.md', '/docs/B.md', readSource)
    assert.strictEqual(hasCycle, true)
  })

  it('rejects self-link as a cycle', async () => {
    const files = new Map<string, string>([
      ['/docs/A.md', '---\n---\n'],
    ])

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null

    const hasCycle = await detectPageLinkCycle('/docs/A.md', 'A.md', '/docs/A.md', readSource)
    assert.strictEqual(hasCycle, true)
  })

  it('respects maxDepth limit', async () => {
    // Build a very long chain: A1 -> A2 -> A3 -> ... -> A60
    const files = new Map<string, string>()
    for (let i = 1; i <= 60; i += 1) {
      const nextLink = i < 60 ? `[[A${i + 1}.md]]` : 'N/A'
      files.set(`/docs/A${i}.md`, `---\nnextPage: ${nextLink}\n---\n`)
    }

    const readSource = async (path: string): Promise<string | null> => files.get(path) ?? null

    // Trying to link A60 back to A1 should NOT be detected as cycle because
    // the walk depth is limited to 50 (default maxDepth).
    const hasCycle = await detectPageLinkCycle('/docs/A60.md', 'A1.md', '/docs/A60.md', readSource)
    assert.strictEqual(hasCycle, false)
  })
})
