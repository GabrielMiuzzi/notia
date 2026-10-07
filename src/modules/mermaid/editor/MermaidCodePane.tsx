import { Fragment, useMemo, useRef, useState, type UIEvent } from 'react'
import { AlignLeft, Copy } from 'lucide-react'
import type { DiagramSelection, MermaidModel } from './mermaidEditorTypes'

/*
 * The diagram's code: a plain textarea over a colored copy of the text,
 * with line numbers, the lines of the selection tinted, and the status of
 * the syntax. The coloring is only visual.
 */

const KEYWORDS = new Set([
  'flowchart', 'graph', 'sequenceDiagram', 'stateDiagram-v2', 'stateDiagram', 'classDiagram', 'classDiagram-v2', 'erDiagram',
  'subgraph', 'end', 'direction', 'classDef', 'class', 'style', 'linkStyle', 'click', 'participant', 'actor', 'as', 'autonumber',
  'loop', 'alt', 'else', 'opt', 'par', 'and', 'critical', 'break', 'rect', 'Note', 'note', 'activate', 'deactivate', 'state',
])
const LINE_HEIGHT = 22
const DIRECTION_WORDS = new Set(['TD', 'TB', 'LR', 'BT', 'RL'])
const TOKEN = /("[^"]*")|(%%.*$)|(<<-?->>|<\|--|<\|\.\.|--\|>|\.\.\|>|\*--|--\*|o--|--o|\.\.>|<\.\.|[|}][|o](?:--|\.\.)[|o][|{]|<?[-=.~]{2,}[>)xo]?[>]?|<<\w+>>)|([A-Za-z_][\w-]*(?=\s*:)|[A-Za-z_][\w-]*)|([@{}:|;,()[\]])/g

function tokenize(line: string): Array<{ text: string; className?: string }> {
  const out: Array<{ text: string; className?: string }> = []
  let last = 0
  let first = true
  for (const match of line.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (index > last) out.push({ text: line.slice(last, index) })
    const [text, string, comment, op, word, punct] = match
    let className: string | undefined
    if (string) className = 'mmd-tok-string'
    else if (comment) className = 'mmd-tok-comment'
    else if (op) className = 'mmd-tok-op'
    else if (word) {
      const isProp = /^\s*:/.test(line.slice(index + text.length)) && line.includes('@{')
      const keyword = (first && KEYWORDS.has(word)) || word === 'as'
      className = isProp ? 'mmd-tok-prop' : keyword ? 'mmd-tok-keyword' : DIRECTION_WORDS.has(word) ? 'mmd-tok-direction' : undefined
      first = false
    } else if (punct) className = 'mmd-tok-punct'
    out.push({ text, className })
    last = index + text.length
  }
  if (last < line.length) out.push({ text: line.slice(last) })
  return out
}

/** Lines (0-based) the selection is written on, to tint them. */
export function selectionLines(model: MermaidModel | null, selection: DiagramSelection | null): Set<number> {
  const lines = new Set<number>()
  if (!model || !selection) return lines
  const add = (values: Array<number | undefined>) => values.forEach((value) => value !== undefined && lines.add(value))
  switch (model.kind) {
    case 'flowchart': {
      if (selection.kind === 'node') add(model.nodes.find((node) => node.id === selection.key)?.lines ?? [])
      if (selection.kind === 'edge') add([model.edges[Number(selection.key)]?.line])
      break
    }
    case 'sequence': {
      if (selection.kind === 'participant') {
        add([model.participants.find((participant) => participant.alias === selection.key)?.line])
        add(model.messages.filter((message) => message.from === selection.key || message.to === selection.key).map((message) => message.line))
      }
      if (selection.kind === 'message') add([model.messages[Number(selection.key)]?.line])
      break
    }
    case 'state': {
      if (selection.kind === 'state') {
        add(model.states.find((state) => state.id === selection.key)?.lines ?? [])
        add(model.transitions.filter((transition) => transition.from === selection.key || transition.to === selection.key).map((transition) => transition.line))
      }
      if (selection.kind === 'transition') add([model.transitions[Number(selection.key)]?.line])
      break
    }
    case 'class': {
      if (selection.kind === 'class') {
        add(model.classes.find((node) => node.name === selection.key)?.lines ?? [])
        add(model.relations.filter((relation) => relation.a === selection.key || relation.b === selection.key).map((relation) => relation.line))
      }
      if (selection.kind === 'relation') add([model.relations[Number(selection.key)]?.line])
      break
    }
    case 'er': {
      if (selection.kind === 'entity') {
        add(model.entities.find((entity) => entity.name === selection.key)?.lines ?? [])
        add(model.relations.filter((relation) => relation.a === selection.key || relation.b === selection.key).map((relation) => relation.line))
      }
      if (selection.kind === 'relation') add([model.relations[Number(selection.key)]?.line])
      break
    }
    default:
      break
  }
  return lines
}

function counts(model: MermaidModel | null): string {
  switch (model?.kind) {
    case 'flowchart': return `${model.nodes.length} nodos · ${model.edges.length} conexiones`
    case 'sequence': return `${model.participants.length} participantes · ${model.messages.length} mensajes`
    case 'state': return `${model.states.length} estados · ${model.transitions.length} transiciones`
    case 'class': return `${model.classes.length} clases · ${model.relations.length} relaciones`
    case 'er': return `${model.entities.length} entidades · ${model.relations.length} relaciones`
    default: return ''
  }
}

interface MermaidCodePaneProps {
  code: string
  onChange: (code: string) => void
  model: MermaidModel | null
  selection: DiagramSelection | null
  renderError: string | null
  /** Flowchart extras: direction and format. */
  direction?: string
  onDirection?: (direction: string) => void
  onFormat?: () => void
}

export function MermaidCodePane({ code, onChange, model, selection, renderError, direction, onDirection, onFormat }: MermaidCodePaneProps) {
  const lines = useMemo(() => code.split('\n'), [code])
  const tinted = useMemo(() => selectionLines(model, selection), [model, selection])
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // The text area never scrolls: the pane does, and follows the caret.
  const updateCursor = (target: HTMLTextAreaElement) => {
    const before = target.value.slice(0, target.selectionStart)
    const line = before.split('\n').length
    setCursor({ line, column: before.length - before.lastIndexOf('\n') })
    const pane = scrollRef.current
    if (!pane) return
    const top = 8 + (line - 1) * LINE_HEIGHT
    if (top < pane.scrollTop) pane.scrollTop = top
    else if (top + LINE_HEIGHT > pane.scrollTop + pane.clientHeight) pane.scrollTop = top + LINE_HEIGHT - pane.clientHeight
  }

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="mmd-pane">
      <div className="mmd-code-tools">
        {onDirection && direction ? (
          <>
            <span className="mmd-eyebrow">Dirección</span>
            <div className="mmd-dir-buttons" role="group" aria-label="Dirección">
              {['TD', 'LR', 'BT', 'RL'].map((value) => (
                <button key={value} type="button" aria-pressed={direction === value || (value === 'TD' && direction === 'TB')} onClick={() => onDirection(value)}>{value}</button>
              ))}
            </div>
          </>
        ) : <span className="mmd-eyebrow">Código</span>}
        <span style={{ flex: 1 }} />
        {onFormat ? (
          <button type="button" className="mmd-icon-button" style={{ width: 28, height: 28 }} aria-label="Formatear código" title="Formatear" onClick={onFormat}>
            <AlignLeft size={14} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" className="mmd-icon-button" style={{ width: 28, height: 28 }} aria-label={copied ? 'Código copiado' : 'Copiar código'} title={copied ? 'Copiado' : 'Copiar'} onClick={copy}>
          <Copy size={14} aria-hidden="true" />
        </button>
      </div>
      <div ref={scrollRef} className="mmd-code mmd-scroll">
        <div className="mmd-code-inner">
          <div className="mmd-code-gutter" aria-hidden="true">
            {lines.map((_, index) => <div key={index} data-on={tinted.has(index) ? 'true' : undefined}>{index + 1}</div>)}
          </div>
          <div className="mmd-code-area">
            <div className="mmd-code-lines" aria-hidden="true">
              {lines.map((line, index) => (
                <div key={index} data-on={tinted.has(index) ? 'true' : undefined}>
                  {tokenize(line).map((token, tokenIndex) => (
                    <Fragment key={tokenIndex}>{token.className ? <span className={token.className}>{token.text}</span> : token.text}</Fragment>
                  ))}
                  {line ? null : '​'}
                </div>
              ))}
            </div>
            <textarea
              className="mmd-code-text"
              value={code}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Código del diagrama"
              wrap="off"
              onChange={(event) => {
                onChange(event.target.value)
                updateCursor(event.target)
              }}
              onSelect={(event) => updateCursor(event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key !== 'Tab') return
                event.preventDefault()
                const target = event.currentTarget
                const { selectionStart, selectionEnd, value } = target
                const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`
                onChange(next)
                requestAnimationFrame(() => target.setSelectionRange(selectionStart + 2, selectionStart + 2))
              }}
              onScroll={(event: UIEvent<HTMLTextAreaElement>) => event.currentTarget.scrollTo(0, 0)}
            />
          </div>
        </div>
      </div>
      <div className="mmd-code-status">
        <span data-valid={renderError ? 'false' : 'true'} title={renderError ?? undefined}><i aria-hidden="true" />{renderError ? 'Error de sintaxis' : 'Sintaxis válida'}</span>
        <span>{counts(model)}</span>
        <span className="mmd-mono">Ln {cursor.line}, Col {cursor.column}</span>
      </div>
    </div>
  )
}
