import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatMarkdownMessage } from './ChatMarkdownMessage'

describe('ChatMarkdownMessage', () => {
  it('renders every heading that follows a ticket field list', () => {
    const source = [
      'Leandro está involucrado en las siguientes **3 tareas**:',
      '---',
      '### 1. **Alta de prontopago**',
      '- **Estado:** Pendiente',
      '- **Detalle:** Primer ticket',
      '---',
      '### 2. **Historial sincros**',
      '- **Estado:** En progreso',
      '- **Detalle:** Segundo ticket',
      '---',
      '### 3. **Métrica de disponibilidad**',
      '- **Estado:** En progreso',
      '- **Detalle:** Tercer ticket',
    ].join('\n')

    const markup = renderToStaticMarkup(createElement(ChatMarkdownMessage, { source }))

    expect(markup.match(/<h3>/g)).toHaveLength(3)
    expect(markup).toContain('Alta de prontopago')
    expect(markup).toContain('Historial sincros')
    expect(markup).toContain('Métrica de disponibilidad')
    expect(markup.match(/<hr/g)).toHaveLength(3)
  })

  it('keeps indented nested bullets inside their parent list item', () => {
    const source = [
      '- **Detalle:**',
      '  - Pendiente: cargar Grafana',
      '  - En curso: analizar rechazos',
      '### 2. Otro ticket',
    ].join('\n')

    const markup = renderToStaticMarkup(createElement(ChatMarkdownMessage, { source }))

    expect(markup).toContain('Pendiente: cargar Grafana')
    expect(markup).toContain('En curso: analizar rechazos')
    expect(markup).toContain('<h3>2. Otro ticket</h3>')
  })

  it('renders display and inline LaTeX with KaTeX', () => {
    const source = [
      'El resultado es $x^2$.',
      '',
      '$$',
      '\\left[\\begin{array}{cc}1 & 2 \\\\ 3 & 4\\end{array}\\right]',
      '$$',
      '',
      '```latex',
      '\\frac{a}{b}',
      '```',
    ].join('\n')

    const markup = renderToStaticMarkup(createElement(ChatMarkdownMessage, { source }))

    expect(markup).toContain('class="notia-chat-markdown-math-shell"')
    expect(markup).toContain('class="notia-chat-markdown-math-shell notia-chat-markdown-math-shell--display"')
    expect(markup).toContain('class="katex"')
    expect(markup).toContain('data-latex="x^2"')
    expect(markup).toContain('aria-label="Mostrar fórmula LaTeX"')
    expect(markup).toContain('data-latex="\\left[\\begin{array}{cc}1 &amp; 2 \\\\ 3 &amp; 4\\end{array}\\right]"')
    expect(markup).toContain('data-latex="\\frac{a}{b}"')
  })
})
