import { describe, expect, it } from 'vitest'
import { applySearchMatchesToTree } from './applySearchMatchesToTree'
import type { NotiaFileNode } from '../../types/notia'

describe('applySearchMatchesToTree', () => {
  it('preserves the tree when search decoration changes nothing', () => {
    const file: NotiaFileNode = { id: 'file', name: 'note.md', path: '/note.md', type: 'file' }
    const tree = [file]

    expect(applySearchMatchesToTree(tree, new Set(['/other.md']), true)).toBe(tree)
  })

  it('clones only ancestors that need to expand for a match', () => {
    const unrelated: NotiaFileNode = { id: 'other', name: 'other.md', path: '/other.md', type: 'file' }
    const folder: NotiaFileNode = {
      id: 'folder',
      name: 'docs',
      path: '/docs',
      type: 'folder',
      expanded: false,
      children: [{ id: 'match', name: 'match.md', path: '/docs/match.md', type: 'file' }],
    }
    const tree = [folder, unrelated]
    const next = applySearchMatchesToTree(tree, new Set(['/docs/match.md']), true)

    expect(next).not.toBe(tree)
    expect(next[0]).not.toBe(folder)
    expect(next[0]?.children?.[0]).toBe(folder.children?.[0])
    expect(next[1]).toBe(unrelated)
    expect(next[0]?.expanded).toBe(true)
  })
})
