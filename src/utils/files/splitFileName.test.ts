import { describe, expect, it } from 'vitest'
import { joinFileName, splitFileName } from './splitFileName'

describe('splitFileName', () => {
  it('separates the final extension while preserving its spelling', () => {
    expect(splitFileName('Runas-Cantadas.md')).toEqual({
      baseName: 'Runas-Cantadas',
      extension: '.md',
    })
    expect(splitFileName('archive.backup.MMD')).toEqual({
      baseName: 'archive.backup',
      extension: '.MMD',
    })
  })

  it('does not treat dotfiles or trailing dots as extensions', () => {
    expect(splitFileName('.agent')).toEqual({ baseName: '.agent', extension: '' })
    expect(splitFileName('draft.')).toEqual({ baseName: 'draft.', extension: '' })
  })

  it('rebuilds a filename without changing its extension', () => {
    expect(joinFileName('Runas', '.md')).toBe('Runas.md')
  })
})
