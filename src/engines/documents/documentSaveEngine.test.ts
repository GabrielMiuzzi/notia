import { describe, expect, it } from 'vitest'
import { getDirtyOpenTextDocumentPaths } from './documentSaveEngine'
import type { OpenDocumentTab } from '../../features/documents/documentsTypes'

describe('getDirtyOpenTextDocumentPaths', () => {
  it('keeps modified Markdown tabs in the final-save set, including save errors', () => {
    const tabs: OpenDocumentTab[] = [
      {
        document: {
          path: '/vault/note.md',
          name: 'note.md',
          extension: 'md',
          viewKind: 'markdown',
          source: 'nuevo contenido',
        },
        saveStatus: 'error',
        latestSavedSource: 'contenido anterior',
      },
      {
        document: {
          path: '/vault/clean.md',
          name: 'clean.md',
          extension: 'md',
          viewKind: 'markdown',
          source: 'sin cambios',
        },
        saveStatus: 'idle',
        latestSavedSource: 'sin cambios',
      },
      {
        document: {
          path: '/vault/image.png',
          name: 'image.png',
          extension: 'png',
          viewKind: 'image',
          imageUrl: 'data:image/png;base64,AA==',
        },
        saveStatus: 'idle',
        latestSavedSource: '',
      },
    ]

    expect(getDirtyOpenTextDocumentPaths(tabs)).toEqual(['/vault/note.md'])
  })
})
