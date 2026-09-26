// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'
import { createGitbookPlugins } from './gitbookPlugins'
import { addGitbookMenu, insertGitbookInline } from './gitbookMenu'
import type { Ctx } from '@milkdown/kit/ctx'
import { GitbookResolver } from './gitbookResolver'
import { strokesFromDataUrl, strokesToSvg, svgToDataUrl } from './gitbookDrawingEditor'
import type { GitbookBlocksRequest, GitbookBlocksResponse } from '../../../../../services/markdown/gitbookBlocksRuntime'

const editors: Editor[] = []

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

function respond(request: GitbookBlocksRequest): GitbookBlocksResponse {
  return {
    expressions: request.expressions.map((expression) => ({
      expression,
      value: expression === 'page.vars.version' ? 'v2' : null,
      dependsOnReader: false,
      error: expression === '1 +' ? 'La expresión no es válida.' : null,
    })),
    conditions: request.conditions.map((expression) => ({ expression, state: 'dependsOnReader' as const })),
    references: request.references.map((reference) => ({
      reference, kind: 'library' as const, target: `C:/lib/${reference}`, exists: reference !== 'falta.md', title: 'Guía',
    })),
    includes: request.includes.map((reference) => ({
      reference, target: `C:/lib/${reference}`, title: 'Aviso', markdown: 'Texto reusado', truncated: false, error: null,
    })),
  }
}

async function openEditor(markdown: string) {
  const root = document.createElement('div')
  document.body.append(root)
  const requester = vi.fn(async (request: GitbookBlocksRequest) => respond(request))
  const resolver = new GitbookResolver(requester, markdown)
  const openLibraryPath = vi.fn()
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdown)
    })
    .use(commonmark)
    .use(gfm)
    .use(createGitbookPlugins({
      resolver,
      openLibraryPath,
      fileUrl: (path) => `asset://${path}`,
      editDrawing: async () => null,
      renderMarkdown: (host, text) => {
        host.textContent = text
        return () => {}
      },
    }))
    .create()
  editors.push(editor)
  const view = editor.action((ctx) => ctx.get(editorViewCtx))
  return { editor, root, view, resolver, requester, openLibraryPath, markdown: () => editor.action(getMarkdown()) }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 200))
}

describe('GitBook node views', () => {
  it('shows one tab at a time, switches by tap and adds tabs', async () => {
    const { root, markdown } = await openEditor('{% tabs %}\n{% tab title="Uno" %}\nA\n{% endtab %}\n{% tab title="Dos" %}\nB\n{% endtab %}\n{% endtabs %}')
    await Promise.resolve()
    const parts = [...root.querySelectorAll<HTMLElement>('.notia-gb-part--tab')]
    expect(parts.map((part) => part.dataset.active)).toEqual(['true', 'false'])
    const title = root.querySelector<HTMLInputElement>('.notia-gb-tabs__title')
    expect(title?.value).toBe('Uno')
    root.querySelector<HTMLButtonElement>('button.notia-gb-tabs__tab')?.click()
    await Promise.resolve()
    expect([...root.querySelectorAll<HTMLElement>('.notia-gb-part--tab')].map((part) => part.dataset.active)).toEqual(['false', 'true'])
    root.querySelector<HTMLButtonElement>('.notia-gb-tabs__add')?.click()
    await Promise.resolve()
    expect(root.querySelectorAll('.notia-gb-part--tab')).toHaveLength(3)
    expect(markdown()).toContain('{% tab title="Pestaña 3" %}')
  })

  it('renames a tab when its title field commits', async () => {
    const { root, markdown } = await openEditor('{% tabs %}\n{% tab title="Uno" %}\nA\n{% endtab %}\n{% endtabs %}')
    const title = root.querySelector<HTMLInputElement>('.notia-gb-tabs__title') as HTMLInputElement
    title.value = 'Instalación'
    title.dispatchEvent(new Event('change'))
    expect(markdown()).toContain('{% tab title="Instalación" %}')
  })

  it('changes the style of a hint from its menu', async () => {
    const { root, markdown } = await openEditor('{% hint style="info" %}\nHola\n{% endhint %}')
    const hint = root.querySelector<HTMLElement>('.notia-gb-hint')
    expect(hint?.dataset.style).toBe('info')
    root.querySelector<HTMLButtonElement>('.notia-gb-hint__style')?.click()
    const danger = [...document.querySelectorAll<HTMLButtonElement>('.notia-gb-menu__item')].find((item) => item.textContent === 'Peligro')
    danger?.click()
    expect(markdown()).toContain('{% hint style="danger" %}')
    expect(root.querySelector<HTMLElement>('.notia-gb-hint')?.dataset.style).toBe('danger')
  })

  it('shows what Rust resolves for expressions, conditions, page links and reusable content', async () => {
    const { root, requester, openLibraryPath } = await openEditor([
      'Versión <code class="expression">page.vars.version</code> y <code class="expression">1 +</code>',
      '',
      '{% if visitor.claims.unsigned.pro %}',
      'Pro',
      '{% endif %}',
      '',
      '{% content-ref url="guia.md" %}',
      '[guia.md](guia.md)',
      '{% endcontent-ref %}',
      '',
      '{% include "aviso.md" %}',
    ].join('\n'))
    await settle()
    // One batch for everything the views asked.
    expect(requester).toHaveBeenCalledTimes(1)
    const expressions = [...root.querySelectorAll<HTMLElement>('.notia-gb-expression')]
    expect(expressions.map((expression) => [expression.textContent, expression.dataset.state])).toEqual([['v2', 'value'], ['1 +', 'invalid']])
    expect(root.querySelector('.notia-gb-condition__status')?.textContent).toBe('Depende del lector')
    expect(root.querySelector('.notia-gb-page-link strong')?.textContent).toBe('Guía')
    root.querySelector<HTMLButtonElement>('.notia-gb-page-link__open')?.click()
    expect(openLibraryPath).toHaveBeenCalledWith('C:/lib/guia.md')
    expect(root.querySelector('.notia-gb-include__preview')?.textContent).toBe('Texto reusado')
  })

  it('asks again for expressions when the note properties change', async () => {
    const { resolver, requester } = await openEditor('<code class="expression">page.vars.version</code>')
    await settle()
    resolver.noteSourceChanged('<code class="expression">page.vars.version</code>')
    await settle()
    expect(requester).toHaveBeenCalledTimes(1)
    resolver.noteSourceChanged('---\nvars:\n  version: v3\n---\n')
    await settle()
    expect(requester).toHaveBeenCalledTimes(2)
  })

  it('edits an embed through its fields', async () => {
    const { root, markdown } = await openEditor('{% embed url="https://youtu.be/abcdefg" %}')
    expect(root.querySelector('.notia-gb-embed__thumbnail')?.getAttribute('src')).toBe('https://img.youtube.com/vi/abcdefg/hqdefault.jpg')
    root.querySelector<HTMLButtonElement>('.notia-gb-embed .notia-gb-button-icon[aria-label="Editar URL embebida"]')?.click()
    const caption = root.querySelector<HTMLInputElement>('input[aria-label="Leyenda"]') as HTMLInputElement
    caption.value = 'Demo'
    caption.dispatchEvent(new Event('change'))
    expect(markdown()).toContain('{% embed url="https://youtu.be/abcdefg" %}\nDemo\n{% endembed %}')
  })

  it('adds, edits and writes cards', async () => {
    const { root, markdown } = await openEditor('<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Inicio</strong></td><td>Pasos</td><td><a href="inicio.md">inicio</a></td></tr></tbody></table>')
    expect(root.querySelector('.notia-gb-card strong')?.textContent).toBe('Inicio')
    const editButton = [...root.querySelectorAll<HTMLButtonElement>('.notia-gb-cards button')].find((button) => button.textContent === 'Editar tarjetas')
    editButton?.click()
    const title = root.querySelector<HTMLInputElement>('.notia-gb-cards__edit-card input[aria-label="Título"]') as HTMLInputElement
    title.value = 'Comienzo'
    title.dispatchEvent(new Event('change'))
    expect(markdown()).toContain('<td><strong>Comienzo</strong></td><td>Pasos</td><td><a href="inicio.md">inicio.md</a></td>')
  })

  it('keeps drawing strokes in the SVG it saves', () => {
    const strokes = [{ color: '#0D9488', width: 4, points: [[10, 20], [30.25, 40]] as Array<[number, number]> }]
    const svg = strokesToSvg(strokes)
    expect(svg).toContain('<path d="M10 20L30.3 40" stroke="#0D9488" stroke-width="4"/>')
    const again = strokesFromDataUrl(svgToDataUrl(svg))
    expect(again).toEqual([{ color: '#0D9488', width: 4, points: [[10, 20], [30.3, 40]] }])
    expect(strokesFromDataUrl('data:image/svg+xml;base64,PHN2Zy8+')).toEqual([])
  })

  it('inserts blocks on the empty line and inline elements at the cursor from the menu', async () => {
    const items = new Map<string, (ctx: Ctx) => void>()
    addGitbookMenu({ addGroup: () => ({ addItem: (key, item) => items.set(key, item.onRun) }) })
    expect([...items.keys()]).toContain('gitbook-annotation')
    const { editor, markdown } = await openEditor(['Texto', '', '/aviso'].join('\n'))
    // The `/` menu only opens on a line that holds just the command.
    const run = (key: string) => editor.action((ctx) => items.get(key)?.(ctx))
    const typeCommand = () => editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText('/x'))
    })
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(view.state.doc.content.size - 1))))
    })
    run('gitbook-hint')
    expect(markdown()).toContain('Texto\n\n{% hint style="info" %}')
    expect(markdown()).not.toContain('/aviso')
    typeCommand()
    run('gitbook-expression')
    expect(markdown()).toContain('{% hint style="info" %}\n<code class="expression"></code>\n{% endhint %}')
    typeCommand()
    run('gitbook-tabs')
    const output = markdown()
    expect(output).toContain('{% tab title="Pestaña 1" %}')
    expect(output).not.toContain('/x')
  })

  it('turns the selected text into a button and adds annotations after it', async () => {
    const { view, markdown } = await openEditor('Descargá ahora mismo')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 10, 15)))
    insertGitbookInline(view, 'button')
    expect(markdown()).toContain('Descargá <a href="" class="button primary">ahora</a> mismo')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 9)))
    insertGitbookInline(view, 'annotation')
    const output = markdown()
    expect(output).toContain('Descargá[^1]')
    expect(output).toMatch(/\[\^1\]:/)
  })
})
