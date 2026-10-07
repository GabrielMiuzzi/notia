import type { DiagramKind, DiagramSelection, MermaidModel } from './mermaidEditorTypes'

/*
 * Mermaid 11 marks what it draws with ids derived from the source: nodes
 * `<diagram>-flowchart-<id>-<n>`, states `-state-<id>-<n>`, classes
 * `-classId-<Name>-<n>`, entities `-entity-<NAME>-<n>`; links, transitions
 * and relations are drawn in the order of the source, as are the messages
 * of a sequence. These helpers find, from a click, the element of the
 * backend's model, and the SVG elements of a selection.
 */

const NODE_PATTERNS: Partial<Record<DiagramKind, { selector: string; pattern: RegExp; kind: DiagramSelection['kind'] }>> = {
  flowchart: { selector: 'g.node', pattern: /-flowchart-(.+)-\d+$/, kind: 'node' },
  state: { selector: 'g.node', pattern: /-state-(.+)-\d+$/, kind: 'state' },
  class: { selector: 'g.node', pattern: /-classId-(.+)-\d+$/, kind: 'class' },
  er: { selector: 'g.node', pattern: /-entity-(.+)-\d+$/, kind: 'entity' },
}

const LINK_SELECTORS: Partial<Record<DiagramKind, { selector: string; kind: DiagramSelection['kind'] }>> = {
  flowchart: { selector: 'path.flowchart-link', kind: 'edge' },
  state: { selector: 'path.transition', kind: 'transition' },
  class: { selector: 'path.relation', kind: 'relation' },
  er: { selector: 'path.relationshipLine', kind: 'relation' },
}

const PSEUDO_STATE = /(^|_)(start|end)$/

function linkPaths(container: Element, kind: DiagramKind): Element[] {
  const link = LINK_SELECTORS[kind]
  return link ? Array.from(container.querySelectorAll(link.selector)) : []
}

/** The model element under `target`, or `null` (the empty canvas). */
export function selectionAt(container: Element, target: Element, kind: DiagramKind, model: MermaidModel): DiagramSelection | null {
  if (kind === 'sequence') return sequenceSelectionAt(container, target, model)
  const node = NODE_PATTERNS[kind]
  const link = LINK_SELECTORS[kind]
  if (node) {
    const element = target.closest(node.selector)
    const match = element?.id.match(node.pattern)
    if (match) {
      const key = match[1]
      if (kind === 'state' && PSEUDO_STATE.test(key)) return null
      return { kind: node.kind, key }
    }
  }
  if (link) {
    const paths = linkPaths(container, kind)
    const path = target.closest(link.selector)
    const labelled = target.closest('[data-id]')
    const index = path ? paths.indexOf(path) : labelled ? paths.findIndex((candidate) => candidate.getAttribute('data-id') === labelled.getAttribute('data-id')) : -1
    if (index >= 0) return { kind: link.kind, key: String(index) }
  }
  return null
}

function sequenceSelectionAt(container: Element, target: Element, model: MermaidModel): DiagramSelection | null {
  if (model.kind !== 'sequence') return null
  const messageLines = Array.from(container.querySelectorAll('.messageLine0, .messageLine1'))
  const messageTexts = Array.from(container.querySelectorAll('.messageText'))
  const line = messageLines.indexOf(target)
  if (line >= 0) return { kind: 'message', key: String(line) }
  const text = messageTexts.indexOf(target.closest('.messageText') ?? target)
  if (text >= 0) return { kind: 'message', key: String(text) }
  const actor = target.closest('[data-id]')
  const alias = actor?.getAttribute('data-id')
  if (alias && model.participants.some((participant) => participant.alias === alias)) return { kind: 'participant', key: alias }
  // The actors drawn again at the bottom carry only their label.
  const bottom = target.closest('g')
  const label = bottom?.querySelector('text.actor, text')?.textContent?.trim()
  const byLabel = model.participants.find((participant) => participant.label === label)
  return byLabel && target.closest('.actor, .actor-man, g') ? { kind: 'participant', key: byLabel.alias } : null
}

/** The SVG elements that draw `selection`. */
export function selectionElements(container: Element, kind: DiagramKind, selection: DiagramSelection): Element[] {
  if (kind === 'sequence') {
    if (selection.kind === 'message') {
      const index = Number(selection.key)
      return [
        container.querySelectorAll('.messageLine0, .messageLine1')[index],
        container.querySelectorAll('.messageText')[index],
      ].filter((element): element is Element => Boolean(element))
    }
    if (selection.kind === 'participant') {
      return Array.from(container.querySelectorAll(`[data-id="${CSS.escape(selection.key)}"]`))
    }
    return []
  }
  const node = NODE_PATTERNS[kind]
  if (node && selection.kind === node.kind) {
    return Array.from(container.querySelectorAll(node.selector)).filter((element) => element.id.match(node.pattern)?.[1] === selection.key)
  }
  const link = LINK_SELECTORS[kind]
  if (link && selection.kind === link.kind) {
    const path = linkPaths(container, kind)[Number(selection.key)]
    if (!path) return []
    const id = path.getAttribute('data-id')
    const label = id ? container.querySelector(`.edgeLabel [data-id="${CSS.escape(id)}"]`) : null
    return [path, label?.closest('.edgeLabel') ?? label].filter((element): element is Element => Boolean(element))
  }
  return []
}

/** The node-like element (node, state, class, entity, participant) under `target`. */
export function linkEndAt(container: Element, target: Element, kind: DiagramKind, model: MermaidModel): string | null {
  const selection = selectionAt(container, target, kind, model)
  if (!selection) {
    // `[*]` is a valid end of a transition.
    if (kind === 'state') {
      const element = target.closest('g.node')
      const match = element?.id.match(/-state-(.+)-\d+$/)
      if (match && PSEUDO_STATE.test(match[1])) return '[*]'
    }
    return null
  }
  return ['node', 'state', 'class', 'entity', 'participant'].includes(selection.kind) ? selection.key : null
}

/**
 * Where a message dropped at `clientY` goes: before the first message drawn
 * below it, or at the end.
 */
export function messageIndexBelow(container: Element, clientY: number): number | undefined {
  const lines = Array.from(container.querySelectorAll('.messageLine0, .messageLine1'))
  const index = lines.findIndex((line) => line.getBoundingClientRect().top > clientY)
  return index >= 0 ? index : undefined
}
