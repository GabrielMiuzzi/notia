import { describe, expect, it } from 'vitest'
import { setFolderExpandedByPath } from './setFolderExpandedByPath'
import { toggleFolderNodeExpanded } from './toggleFolderNodeExpanded'
import { setAllFoldersExpanded } from './setAllFoldersExpanded'
import type { NotiaFileNode } from '../../types/notia'

function buildTree(): NotiaFileNode[] {
  const untouchedFile: NotiaFileNode = { id: 'file-b', name: 'b.md', path: '/root/b.md', type: 'file' }
  return [
    {
      id: 'folder-a',
      name: 'a',
      path: '/root/a',
      type: 'folder',
      expanded: false,
      children: [{ id: 'folder-a-child', name: 'child', path: '/root/a/child', type: 'folder', expanded: false }],
    },
    untouchedFile,
  ]
}

describe('tree structural sharing', () => {
  it('clones only the path to a toggled folder', () => {
    const tree = buildTree()
    const next = toggleFolderNodeExpanded(tree, 'folder-a-child')

    expect(next).not.toBe(tree)
    expect(next[0]).not.toBe(tree[0])
    expect(next[0]?.children?.[0]).not.toBe(tree[0]?.children?.[0])
    expect(next[1]).toBe(tree[1])
    expect(next[0]?.children).not.toBe(tree[0]?.children)
    expect(next[0]?.children?.[0]?.expanded).toBe(true)
  })

  it('returns the same root when the requested state is already applied', () => {
    const tree = buildTree()
    const next = setFolderExpandedByPath(tree, '/root/a', false)

    expect(next).toBe(tree)
    expect(next[0]).toBe(tree[0])
    expect(next[1]).toBe(tree[1])
  })

  it('preserves unrelated descendants when setting a nested folder', () => {
    const tree = buildTree()
    const next = setFolderExpandedByPath(tree, '/root/a/child', true)

    expect(next[1]).toBe(tree[1])
    expect(next[0]?.children?.[0]?.expanded).toBe(true)
    expect(next[0]?.children?.[0]).not.toBe(tree[0]?.children?.[0])
  })

  it('returns the original tree when all folders already have the requested state', () => {
    const tree = buildTree()
    expect(setAllFoldersExpanded(tree, false)).toBe(tree)
  })

  it('preserves file branches while expanding folders globally', () => {
    const tree = buildTree()
    const next = setAllFoldersExpanded(tree, true)

    expect(next).not.toBe(tree)
    expect(next[1]).toBe(tree[1])
    expect(next[0]?.children?.[0]).not.toBe(tree[0]?.children?.[0])
    expect(next[0]?.children?.[0]?.expanded).toBe(true)
  })
})
