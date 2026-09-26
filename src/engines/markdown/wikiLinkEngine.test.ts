import { describe, expect, it } from 'vitest'
import { findWikiLinkMatches } from './wikiLinkEngine'

const shown = (text: string) => findWikiLinkMatches(text).map((match) => ({
  label: match.displayLabel,
  hidden: [text.slice(match.startOffset, match.labelStartOffset), text.slice(match.labelEndOffset, match.endOffset)],
}))

describe('findWikiLinkMatches', () => {
  it('tells the text a link shows from its syntax', () => {
    expect(shown('Ver [[Ejemplo]] y más')).toEqual([{ label: 'Ejemplo', hidden: ['[[', ']]'] }])
    expect(shown('[[notas/Alfa.md|el alias]]')).toEqual([{ label: 'el alias', hidden: ['[[notas/Alfa.md|', ']]'] }])
    expect(shown('[[nota.md]]')).toEqual([{ label: 'nota', hidden: ['[[', '.md]]'] }])
    expect(shown('[[ nota | ]]')).toEqual([{ label: 'nota', hidden: ['[[ ', ' | ]]'] }])
  })

  it('stops being a link once a bracket is gone', () => {
    expect(findWikiLinkMatches('[[Ejemplo]')).toEqual([])
    expect(findWikiLinkMatches('[Ejemplo]]')).toEqual([])
  })
})
