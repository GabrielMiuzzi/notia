import { describe, expect, it } from 'vitest'
import {
  insertMarkdownBlockByReference,
  moveMarkdownBlockByReference,
  replaceMarkdownBlockByReference,
  replaceSelectedMarkdownBlocks,
} from './blockReplacementEngine'

const selection = (documentPath: string, ...indexes: number[]) => ({
  documentPath,
  from: 1,
  to: 20,
  selectedText: 'seleccion',
  blocks: indexes.map((index) => ({
    index,
    type: 'párrafo',
    text: 'contenido',
    from: index + 1,
    to: index + 5,
  })),
})

describe('replaceSelectedMarkdownBlocks', () => {
  it('replaces only the selected block and preserves the rest and frontmatter', () => {
    const source = '---\ntitle: Nota\n---\n\n# Título\n\nPrimer bloque.\n\nSegundo bloque.\n'

    const result = replaceSelectedMarkdownBlocks(source, selection('/vault/nota.md', 2), 'Bloque actualizado.')

    expect(result).toEqual({
      ok: true,
      source: '---\ntitle: Nota\n---\n\n# Título\n\nPrimer bloque.\n\nBloque actualizado.\n',
      replacedBlockCount: 1,
    })
  })

  it('replaces multiple adjacent blocks without replacing the document', () => {
    const source = '# Título\n\nUno\n\nDos\n\nFin\n'

    const result = replaceSelectedMarkdownBlocks(source, selection('/vault/nota.md', 1, 2), 'Contenido combinado.')

    expect(result).toMatchObject({
      ok: true,
      source: '# Título\n\nContenido combinado.\n\nFin\n',
      replacedBlockCount: 2,
    })
  })

  it('keeps a fenced code block as one replaceable block', () => {
    const source = 'Antes\n\n```latex\nuno\n\ndos\n```\n\nDespues\n'

    const result = replaceSelectedMarkdownBlocks(
      source,
      selection('/vault/nota.md', 1),
      '```latex\nreemplazado\n```',
    )

    expect(result).toMatchObject({
      ok: true,
      source: 'Antes\n\n```latex\nreemplazado\n```\n\nDespues\n',
      replacedBlockCount: 1,
    })
  })
})

describe('Markdown block references', () => {
  it('moves a referenced block without touching frontmatter or other blocks', () => {
    const source = '---\ntitle: Demo\n---\n# Uno\n\nTexto uno\n\n# Dos\n\nTexto dos'
    const result = moveMarkdownBlockByReference(source, 'Texto uno', 'Texto dos', 'after')

    expect(result).toEqual({
      ok: true,
      source: '---\ntitle: Demo\n---\n# Uno\n\n# Dos\n\nTexto dos\n\nTexto uno',
      affectedBlockCount: 1,
      matchedText: 'Texto uno',
    })
  })

  it('rejects an ambiguous destination instead of guessing', () => {
    const result = moveMarkdownBlockByReference('A\n\nDestino\n\nB\n\nDestino', 'A', 'Destino', 'before')

    expect(result).toEqual({ ok: false, error: 'destination-ambiguous' })
  })

  it('replaces the unique referenced block without using the editor selection', () => {
    const source = '# Ejercicio\n\na) Resolver la recta.\n\n b) Resolver el plano.\n'

    const result = replaceMarkdownBlockByReference(source, 'el punto a)', 'a) Recta resuelta.')

    expect(result).toMatchObject({
      ok: true,
      source: '# Ejercicio\n\na) Recta resuelta.\n\n b) Resolver el plano.\n',
      affectedBlockCount: 1,
    })
  })

  it('inserts content after a referenced block and preserves the surrounding document', () => {
    const source = '## Ejercicio\n\na) Encontrar la ecuación.\n\n## Otro ejercicio\n'

    const result = insertMarkdownBlockByReference(
      source,
      'a) Encontrar la ecuación.',
      'Resolución: $x = 1 + t$.',
    )

    expect(result).toMatchObject({
      ok: true,
      source: '## Ejercicio\n\na) Encontrar la ecuación.\n\nResolución: $x = 1 + t$.\n\n## Otro ejercicio\n',
    })
  })

  it('appends content when no target is provided', () => {
    const result = insertMarkdownBlockByReference('Inicio\n', null, 'Nueva sección')

    expect(result).toMatchObject({ ok: true, source: 'Inicio\n\nNueva sección' })
  })

  it('requires an explicit occurrence when a reference is ambiguous', () => {
    const source = 'Punto a) primero\n\nPunto a) segundo\n'

    expect(replaceMarkdownBlockByReference(source, 'Punto a)', 'Reemplazado')).toEqual({
      ok: false,
      error: 'target-ambiguous',
    })
    expect(replaceMarkdownBlockByReference(source, 'Punto a)', 'Reemplazado', 2)).toMatchObject({
      ok: true,
      source: 'Punto a) primero\n\nReemplazado\n',
    })
  })

  it('resolves an inciso reference by label and exercise number', () => {
    const source = [
      '1.- Encontrar una ecuación paramétrica:',
      '',
      'a) Primera recta.',
      '',
      'b) Segunda recta.',
      '',
      'c) La recta que pasa por el origen.',
      '',
      '2.- Resolver otro ejercicio:',
      '',
      'c) Otro inciso.',
    ].join('\n')

    const result = insertMarkdownBlockByReference(
      source,
      'inciso c del ejercicio 1',
      'Resolución del inciso c.',
    )

    expect(result).toMatchObject({
      ok: true,
      source: [
        '1.- Encontrar una ecuación paramétrica:',
        '',
        'a) Primera recta.',
        '',
        'b) Segunda recta.',
        '',
        'c) La recta que pasa por el origen.',
        '',
        'Resolución del inciso c.',
        '',
        '2.- Resolver otro ejercicio:',
        '',
        'c) Otro inciso.',
      ].join('\n'),
    })
  })
})
