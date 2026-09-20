import { describe, expect, it } from 'vitest'
import type { NotiaFileNode } from '../../types/notia'
import { reconcileTreeNodes } from './reconcileTreeNodes'

function buildTree(): NotiaFileNode[] {
  return [
    {
      id: 'folder-a',
      name: 'a',
      path: '/library/a',
      type: 'folder',
      expanded: true,
      hasChildren: true,
      children: [{ id: 'file-a', name: 'a.md', path: '/library/a/a.md', type: 'file', modifiedAt: 1 }],
    },
    { id: 'file-b', name: 'b.md', path: '/library/b.md', type: 'file', modifiedAt: 1 },
  ]
}

describe('reconcileTreeNodes', () => {
  it('returns the original snapshot when only object identities changed', () => {
    const previous = buildTree()
    const next = buildTree()

    expect(reconcileTreeNodes(previous, next)).toBe(previous)
  })

  it('reuses unaffected branches and ancestors only when a descendant changes', () => {
    const previous = buildTree()
    const next = buildTree()
    next[0] = {
      ...next[0],
      children: [{ ...next[0].children![0], modifiedAt: 2 }],
    }

    const reconciled = reconcileTreeNodes(previous, next)

    expect(reconciled).not.toBe(previous)
    expect(reconciled[0]).not.toBe(previous[0])
    expect(reconciled[0]?.children?.[0]).not.toBe(previous[0]?.children?.[0])
    expect(reconciled[1]).toBe(previous[1])
  })

  it('does not reuse a node when observable metadata changes', () => {
    const previous = buildTree()
    const next = buildTree()
    next[1] = { ...next[1], hasChildren: true }

    expect(reconcileTreeNodes(previous, next)[1]).not.toBe(previous[1])
  })
})
