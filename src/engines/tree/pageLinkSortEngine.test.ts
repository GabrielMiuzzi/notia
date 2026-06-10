import { describe, it } from 'node:test'
import assert from 'node:assert'
import { sortFilesystemTreeNodesWithPageLinks } from './pageLinkSortEngine.ts'
import type { FilesystemTreeNode } from '../../services/files/filesystemEngine'

function makeFileNode(name: string, overrides: Partial<FilesystemTreeNode> = {}): FilesystemTreeNode {
  return {
    id: name,
    name,
    path: `/docs/${name}`,
    type: 'file',
    createdAt: 1000,
    modifiedAt: 1000,
    ...overrides,
  }
}

describe('pageLinkSortEngine', () => {
  it('sorts loose files by createdAt', () => {
    const nodes = [
      makeFileNode('C', { createdAt: 3000 }),
      makeFileNode('A', { createdAt: 1000 }),
      makeFileNode('B', { createdAt: 2000 }),
    ]
    const sorted = sortFilesystemTreeNodesWithPageLinks(nodes)
    assert.deepStrictEqual(sorted.map((n) => n.name), ['A', 'B', 'C'])
  })

  it('keeps folders before files', () => {
    const nodes = [
      makeFileNode('file', { type: 'file' }),
      { id: 'folder', name: 'folder', type: 'folder', createdAt: 5000 } as FilesystemTreeNode,
    ]
    const sorted = sortFilesystemTreeNodesWithPageLinks(nodes)
    assert.deepStrictEqual(sorted.map((n) => n.name), ['folder', 'file'])
  })

  it('orders linked chain A->B consecutively', () => {
    const nodes = [
      makeFileNode('B', { createdAt: 2000, previousPage: '/docs/A' }),
      makeFileNode('A', { createdAt: 1000, nextPage: '/docs/B' }),
    ]
    const sorted = sortFilesystemTreeNodesWithPageLinks(nodes)
    assert.deepStrictEqual(sorted.map((n) => n.name), ['A', 'B'])
  })

  it('orders longer chain A->B->C consecutively', () => {
    const nodes = [
      makeFileNode('C', { createdAt: 3000, previousPage: '/docs/B' }),
      makeFileNode('A', { createdAt: 1000, nextPage: '/docs/B' }),
      makeFileNode('B', { createdAt: 2000, nextPage: '/docs/C', previousPage: '/docs/A' }),
    ]
    const sorted = sortFilesystemTreeNodesWithPageLinks(nodes)
    assert.deepStrictEqual(sorted.map((n) => n.name), ['A', 'B', 'C'])
  })

  it('block with older head sorts before loose newer file', () => {
    const nodes = [
      makeFileNode('loose', { createdAt: 2000 }),
      makeFileNode('A', { createdAt: 1000, nextPage: '/docs/B' }),
      makeFileNode('B', { createdAt: 3000, previousPage: '/docs/A' }),
    ]
    const sorted = sortFilesystemTreeNodesWithPageLinks(nodes)
    assert.deepStrictEqual(sorted.map((n) => n.name), ['A', 'B', 'loose'])
  })

  it('ignores broken nextPage and sorts as loose', () => {
    const nodes = [
      makeFileNode('A', { createdAt: 1000, nextPage: '/docs/nonexistent' }),
    ]
    const sorted = sortFilesystemTreeNodesWithPageLinks(nodes)
    assert.deepStrictEqual(sorted.map((n) => n.name), ['A'])
  })

  it('resolves wikilinks without .md extension like [[6-10]]', () => {
    const nodes = [
      makeFileNode('11-15.md', { path: '/docs/11-15.md', createdAt: 3000, previousPage: '[[6-10]]', nextPage: '[[16-20]]' }),
      makeFileNode('1-5.md', { path: '/docs/1-5.md', createdAt: 1000, nextPage: '[[6-10]]', previousPage: 'N/A' }),
      makeFileNode('16-20.md', { path: '/docs/16-20.md', createdAt: 4000, previousPage: '[[11-15.md]]', nextPage: '[[21-25]]' }),
      makeFileNode('21-25.md', { path: '/docs/21-25.md', createdAt: 5000, previousPage: '[[16-20.md]]', nextPage: '[[26-30]]' }),
      makeFileNode('26-30.md', { path: '/docs/26-30.md', createdAt: 6000, previousPage: '[[21-25.md]]' }),
      makeFileNode('6-10.md', { path: '/docs/6-10.md', createdAt: 2000, nextPage: '[[11-15]]', previousPage: '[[1-5.md]]' }),
    ]
    const sorted = sortFilesystemTreeNodesWithPageLinks(nodes)
    assert.deepStrictEqual(sorted.map((n) => n.name), ['1-5.md', '6-10.md', '11-15.md', '16-20.md', '21-25.md', '26-30.md'])
  })
})
