// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { gitbookSchemaPlugins } from './gitbookSchema'

async function openEditor(markdown: string) {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, document.createElement('div'))
      ctx.set(defaultValueCtx, markdown)
    })
    .use(commonmark)
    .use(gfm)
    .use(gitbookSchemaPlugins)
    .create()
  const doc = editor.action((ctx) => ctx.get(editorViewCtx).state.doc)
  const output = editor.action(getMarkdown())
  await editor.destroy()
  return { doc, output }
}

function outline(node: ProseMirrorNode): unknown {
  if (node.isText) return node.text
  const attrs = Object.entries(node.attrs).filter(([, value]) => value !== '' && value !== false && value !== null)
  const children: unknown[] = []
  node.forEach((child) => { children.push(outline(child)) })
  return [node.type.name, ...(attrs.length > 0 ? [Object.fromEntries(attrs)] : []), ...children]
}

describe('GitBook blocks in the editor', () => {
  it('reads hints, tabs, steppers, columns and updates and writes them back', async () => {
    const markdown = [
      '{% hint style="warning" %}',
      'Cuidado con **esto**.',
      '{% endhint %}',
      '',
      '{% tabs %}',
      '{% tab title="JavaScript" %}',
      '```js',
      'const a = 1',
      '```',
      '{% endtab %}',
      '',
      '{% tab title="Python" %}',
      '- uno',
      '- dos',
      '{% endtab %}',
      '{% endtabs %}',
      '',
      '{% stepper %}',
      '{% step %}',
      '## Primero',
      'Instalar.',
      '{% endstep %}',
      '{% step %}',
      'Configurar.',
      '{% endstep %}',
      '{% endstepper %}',
      '',
      '{% columns %}',
      '{% column width="50%" %}',
      'Antes',
      '{% endcolumn %}',
      '{% column %}',
      'Después',
      '{% endcolumn %}',
      '{% endcolumns %}',
      '',
      '{% updates format="full" %}',
      '{% update date="2026-01-02" tags="api,beta" %}',
      '# Versión 2',
      '{% endupdate %}',
      '{% endupdates %}',
    ].join('\n')
    const { doc, output } = await openEditor(markdown)
    expect(outline(doc.child(0))).toEqual(['gitbook_hint', { style: 'warning' }, ['paragraph', 'Cuidado con ', 'esto', '.']])
    expect(outline(doc.child(1))).toEqual([
      'gitbook_tabs',
      ['gitbook_tab', { title: 'JavaScript' }, ['code_block', { language: 'js' }, 'const a = 1']],
      ['gitbook_tab', { title: 'Python' }, expect.arrayContaining(['bullet_list'])],
    ])
    expect(doc.child(2).type.name).toBe('gitbook_stepper')
    expect(doc.child(2).childCount).toBe(2)
    expect(outline(doc.child(3))).toEqual([
      'gitbook_columns',
      ['gitbook_column', { width: '50%' }, ['paragraph', 'Antes']],
      ['gitbook_column', ['paragraph', 'Después']],
    ])
    expect(outline(doc.child(4))).toEqual([
      'gitbook_updates',
      { format: 'full' },
      ['gitbook_update', { date: '2026-01-02', tags: 'api,beta' }, ['heading', { level: 1, id: expect.any(String) }, 'Versión 2']],
    ])
    expect(output).toContain('{% hint style="warning" %}\nCuidado con **esto**.\n{% endhint %}')
    expect(output).toContain('{% tab title="JavaScript" %}\n```js\nconst a = 1\n```\n{% endtab %}\n\n{% tab title="Python" %}')
    expect(output).toContain('{% column width="50%" %}\nAntes\n{% endcolumn %}')
    expect(output).toContain('{% update date="2026-01-02" tags="api,beta" %}\n# Versión 2\n{% endupdate %}')
    // Writing what was read gives the same document again.
    const again = await openEditor(output)
    expect(again.output).toBe(output)
  })

  it('reads details, code frames, prompts, conditions and one-line tags', async () => {
    const markdown = [
      '<details open><summary>Más &amp; <b>info</b></summary>',
      'Cuerpo',
      '</details>',
      '',
      '{% code title="main.rs" overflow="wrap" lineNumbers="true" %}',
      '```rust',
      'fn main() {}',
      '```',
      '{% endcode %}',
      '',
      '{% prompt description="Resumir" icon="rectangle-terminal" defaultExpanded="full” %}',
      '```markdown',
      'Resumí esto.',
      '```',
      '{% endprompt %}',
      '',
      '{% if visitor.claims.unsigned.plan === "pro" %}',
      'Solo pro',
      '{% endif %}',
      '',
      '{% embed url="https://youtu.be/x" %}',
      '',
      '{% file src=".gitbook/assets/a.pdf" %}Informe{% endfile %}',
      '',
      '{% content-ref url="guias/" %} [guias](guias/) {% endcontent-ref %}',
      '',
      '{% include "../.gitbook/includes/aviso.md" %}',
    ].join('\n')
    const { doc, output } = await openEditor(markdown)
    expect(outline(doc.child(0))).toEqual(['gitbook_details', { summary: 'Más & info', open: true }, ['paragraph', 'Cuerpo']])
    expect(outline(doc.child(1))).toEqual([
      'gitbook_code', { title: 'main.rs', lineNumbers: true, wrap: true }, ['code_block', { language: 'rust' }, 'fn main() {}'],
    ])
    expect(doc.child(2).attrs).toMatchObject({ description: 'Resumir', icon: 'rectangle-terminal', visibility: 'full' })
    expect(doc.child(3).attrs.expression).toBe('visitor.claims.unsigned.plan === "pro"')
    expect(doc.child(4).attrs).toMatchObject({ url: 'https://youtu.be/x', caption: '' })
    expect(doc.child(5).attrs).toMatchObject({ src: '.gitbook/assets/a.pdf', caption: 'Informe' })
    expect(doc.child(6).attrs).toMatchObject({ url: 'guias/', label: 'guias' })
    expect(doc.child(7).attrs.reference).toBe('../.gitbook/includes/aviso.md')
    expect(output).toContain('<details open>\n<summary>Más &amp; info</summary>\n\nCuerpo\n\n</details>')
    expect(output).toContain('{% code title="main.rs" overflow="wrap" lineNumbers="true" %}')
    expect(output).toContain('{% if visitor.claims.unsigned.plan === "pro" %}\nSolo pro\n{% endif %}')
    expect(output).toContain('{% file src=".gitbook/assets/a.pdf" %}\nInforme\n{% endfile %}')
    expect(output).toContain('{% content-ref url="guias/" %}\n[guias](guias/)\n{% endcontent-ref %}')
    expect(output).toContain('{% include "../.gitbook/includes/aviso.md" %}')
    const again = await openEditor(output)
    expect(again.output).toBe(output)
  })

  it('reads cards, drawings and the inline elements', async () => {
    const cards = '<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>Inicio</strong></td><td>Primeros pasos</td><td><a href="inicio.md">inicio</a></td></tr></tbody></table>'
    const markdown = [
      cards,
      '',
      '<img src="data:image/svg+xml;base64,AA" alt="Plano" class="gitbook-drawing">',
      '',
      'Botón <a href="https://x.org" class="button secondary" data-icon="rocket">Empezar</a>, ícono <i class="fa-check">check</i>, valor <code class="expression">page.vars.version</code> e imagen <img src="logo.png" alt="Logo" data-size="line"> y nota[^1].',
      '',
      '[^1]: Una anotación.',
    ].join('\n')
    const { doc, output } = await openEditor(markdown)
    expect(doc.child(0).type.name).toBe('gitbook_cards')
    expect(JSON.parse(doc.child(0).attrs.cards as string)).toEqual([
      { title: 'Inicio', description: 'Primeros pasos', target: 'inicio.md', cover: '', icon: '' },
    ])
    expect(doc.child(1).attrs).toMatchObject({ src: 'data:image/svg+xml;base64,AA', alt: 'Plano' })
    const inline = outline(doc.child(2)) as unknown[]
    expect(inline).toContainEqual(['gitbook_button', { href: 'https://x.org', label: 'Empezar', variant: 'secondary', icon: 'rocket' }])
    expect(inline).toContainEqual(['gitbook_icon', { name: 'check', label: 'check' }])
    expect(inline).toContainEqual(['gitbook_expression', { expression: 'page.vars.version' }])
    expect(inline).toContainEqual(['gitbook_inline_image', { src: 'logo.png', alt: 'Logo' }])
    // An untouched card table is written back as it was read.
    expect(output).toContain(cards)
    expect(output).toContain('<img src="data:image/svg+xml;base64,AA" alt="Plano" class="gitbook-drawing">')
    expect(output).toContain('<a href="https://x.org" class="button secondary" data-icon="rocket">Empezar</a>')
    expect(output).toContain('<i class="fa-check">check</i>')
    expect(output).toContain('<code class="expression">page.vars.version</code>')
    expect(output).toContain('<img src="logo.png" alt="Logo" data-size="line">')
  })

  it('leaves unmatched tags, tags in code and unknown tags as text', async () => {
    const markdown = [
      'Escribí `{% hint %}` para un aviso.',
      '',
      '{% endhint %}',
      '',
      '{% openapi src="x" %}',
      '',
      '```',
      '{% hint style="info" %}',
      '```',
    ].join('\n')
    const { doc, output } = await openEditor(markdown)
    const names: string[] = []
    doc.forEach((child) => names.push(child.type.name))
    expect(names).toEqual(['paragraph', 'paragraph', 'paragraph', 'code_block'])
    expect(output).toContain('`{% hint %}`')
    expect(output).toContain('{% hint style="info" %}\n```')
  })

  it('keeps an unclosed hint as its tag and the text after it', async () => {
    const { doc } = await openEditor('{% hint style="info" %}\nSin cierre')
    const names: string[] = []
    doc.forEach((child) => names.push(child.type.name))
    expect(names).toEqual(['paragraph', 'paragraph'])
    expect(doc.child(0).textContent).toBe('{% hint style="info" %}')
  })
})
