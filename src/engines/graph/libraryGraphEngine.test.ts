import { describe, expect, it } from 'vitest'
import { buildLibraryGraphModel } from './libraryGraphEngine'
import { DEFAULT_LIBRARY_CONTEXTS } from '../../services/contexts/libraryContexts'
import type { NotiaFileNode } from '../../types/notia'

function taskTree(source: string): { nodes: NotiaFileNode[]; sources: Record<string, string> } {
  const path = 'C:/vault/task-mannager/default/ticket.md'
  return {
    nodes: [{
      id: 'task-mannager',
      name: 'task-mannager',
      type: 'folder',
      children: [{
        id: 'default',
        name: 'default',
        type: 'folder',
        children: [{ id: path, name: 'ticket.md', path, type: 'file' }],
      }],
    }],
    sources: { [path]: source },
  }
}

describe('buildLibraryGraphModel task contexts', () => {
  it('uses the applied board context over a stale ticket context', () => {
    const { nodes, sources } = taskTree('---\ncontexto: "#Laboral"\n---\n\nTicket')
    const model = buildLibraryGraphModel(nodes, 'C:/vault', sources, undefined, {
      contexts: DEFAULT_LIBRARY_CONTEXTS,
      boardContextsByName: { default: '#Personal' },
    })

    expect(model.nodes[0]).toMatchObject({
      contextTag: '#Personal',
      contextColor: '#16A34A',
    })
  })

  it('inherits the board context when a ticket has no explicit context', () => {
    const { nodes, sources } = taskTree('---\ntarea: "Ticket"\n---\n\nTicket')
    const model = buildLibraryGraphModel(nodes, 'C:/vault', sources, undefined, {
      contexts: DEFAULT_LIBRARY_CONTEXTS,
      boardContextsByName: { default: '#Laboral' },
    })

    expect(model.nodes[0]).toMatchObject({
      contextTag: '#Laboral',
      contextColor: '#2563EB',
    })
  })
})
