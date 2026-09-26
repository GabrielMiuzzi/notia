import type { MarkdownNode } from '@milkdown/transformer'

/*
 * GitBook blocks as the editor reads and writes them. Files keep GitBook's
 * own syntax, so a library synced with GitBook stays valid both ways:
 * `{% hint %}`-style tags, `<details>`, `<table data-view="cards">`,
 * `class="gitbook-drawing"` images and, inside text, buttons, icons,
 * expressions and line-size images. What depends on the library (variables,
 * conditions, relative paths, reusable content) is resolved in Rust.
 */

export const GITBOOK_NODE = {
  hint: 'gitbookHint',
  tabs: 'gitbookTabs',
  tab: 'gitbookTab',
  stepper: 'gitbookStepper',
  step: 'gitbookStep',
  columns: 'gitbookColumns',
  column: 'gitbookColumn',
  updates: 'gitbookUpdates',
  update: 'gitbookUpdate',
  code: 'gitbookCode',
  prompt: 'gitbookPrompt',
  condition: 'gitbookCondition',
  details: 'gitbookDetails',
  embed: 'gitbookEmbed',
  file: 'gitbookFile',
  contentRef: 'gitbookContentRef',
  include: 'gitbookInclude',
  cards: 'gitbookCards',
  drawing: 'gitbookDrawing',
  button: 'gitbookButton',
  icon: 'gitbookIcon',
  expression: 'gitbookExpression',
  inlineImage: 'gitbookInlineImage',
} as const

export const HINT_STYLES = ['info', 'success', 'warning', 'danger'] as const
export type HintStyle = typeof HINT_STYLES[number]
export const BUTTON_VARIANTS = ['primary', 'secondary'] as const
export type ButtonVariant = typeof BUTTON_VARIANTS[number]
/** GitBook shows two columns at most. */
export const MAX_GITBOOK_COLUMNS = 2

export interface GitbookCard {
  title: string
  description: string
  /** Page or address the card opens. */
  target: string
  /** Cover image. */
  cover: string
  /** Font Awesome name without `fa-`. */
  icon: string
}

export function isHintStyle(value: unknown): value is HintStyle {
  return typeof value === 'string' && (HINT_STYLES as readonly string[]).includes(value)
}

/** Container tags and the node each one becomes. */
const CONTAINER_NODES: Record<string, string> = {
  hint: GITBOOK_NODE.hint,
  tabs: GITBOOK_NODE.tabs,
  tab: GITBOOK_NODE.tab,
  stepper: GITBOOK_NODE.stepper,
  step: GITBOOK_NODE.step,
  columns: GITBOOK_NODE.columns,
  column: GITBOOK_NODE.column,
  updates: GITBOOK_NODE.updates,
  update: GITBOOK_NODE.update,
  code: GITBOOK_NODE.code,
  prompt: GITBOOK_NODE.prompt,
  if: GITBOOK_NODE.condition,
  details: GITBOOK_NODE.details,
}
/** Tags that close optionally, around a caption. */
const CAPTIONED_TAGS = new Set(['embed', 'file', 'content-ref'])
const KNOWN_TAGS = new Set([
  ...Object.keys(CONTAINER_NODES).filter((name) => name !== 'details'),
  ...CAPTIONED_TAGS,
  'include',
].flatMap((name) => (name === 'include' ? [name] : [name, `end${name}`])))

/** Nodes that only live inside one parent, and that parent. */
const CHILD_PARENTS: Record<string, string> = {
  [GITBOOK_NODE.tab]: GITBOOK_NODE.tabs,
  [GITBOOK_NODE.step]: GITBOOK_NODE.stepper,
  [GITBOOK_NODE.column]: GITBOOK_NODE.columns,
  [GITBOOK_NODE.update]: GITBOOK_NODE.updates,
}

const TAG_SOURCE = String.raw`\{%-?\s*([a-zA-Z][a-zA-Z-]*)([\s\S]*?)-?%\}`
const WHOLE_TAG = new RegExp(`^${TAG_SOURCE}$`)
const DETAILS_PIECE = /(<details\b[^>]*>|<\/details>|<summary\b[^>]*>[\s\S]*?<\/summary>)/i
const CARDS_TABLE = /^\s*(?:>\s*)*<table\b[^>]*data-view=["']cards["']/i
const DRAWING_LINE = /^\s*(?:<figure>\s*)?<img\b[^>]*class=["'][^"']*gitbook-drawing[^"']*["'][^>]*>/i

// ---------- Attributes and HTML text ----------

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x20;|&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function escapeHtmlAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Attributes of a tag's arguments or of an HTML element; flags are `''`. */
export function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"”]*)["”]|“([^”]*)”|'([^']*)'|([^\s"'>]+)))?/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1]?.toLowerCase()
    if (!name || name in attributes) continue
    attributes[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? match[5] ?? '')
  }
  return attributes
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, '')).trim()
}

function plainText(node: MarkdownNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(plainText).join('')
}

// ---------- Source preparation ----------

interface Fence {
  char: string
  length: number
}

function fenceOpen(line: string): Fence | null {
  const match = /^\s*(?:>\s*)*(`{3,}|~{3,})/.exec(line)
  if (!match?.[1]) return null
  if (match[1][0] === '`' && line.slice(match[0].length).includes('`')) return null
  return { char: match[1][0] as string, length: match[1].length }
}

function isFenceClose(line: string, fence: Fence): boolean {
  const rest = line.replace(/^\s*(?:>\s*)*/, '').trim()
  return rest.length >= fence.length && [...rest].every((char) => char === fence.char)
}

/** Ranges of the code spans of a line, where tags are only text. */
function codeSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  let open: { length: number; start: number } | null = null
  for (const match of line.matchAll(/`+/g)) {
    const index = match.index ?? 0
    if (!open) {
      open = { length: match[0].length, start: index }
    } else if (match[0].length === open.length) {
      spans.push([open.start, index + match[0].length])
      open = null
    }
  }
  return spans
}

/** A line cut at its GitBook tags, or `null` when it has none. */
function splitTags(line: string): string[] | null {
  const spans = codeSpans(line)
  const pieces: string[] = []
  let last = 0
  let found = false
  for (const match of line.matchAll(new RegExp(TAG_SOURCE, 'g'))) {
    const index = match.index ?? 0
    if (!KNOWN_TAGS.has((match[1] ?? '').toLowerCase())) continue
    if (spans.some(([start, end]) => index >= start && index < end)) continue
    found = true
    const before = line.slice(last, index).trim()
    if (before) pieces.push(before)
    pieces.push(match[0])
    last = index + match[0].length
  }
  if (!found) return null
  const after = line.slice(last).trim()
  if (after) pieces.push(after)
  return pieces
}

function splitDetails(line: string): string[] | null {
  if (!/^\s*(?:>\s*)*<\/?(details|summary)\b/i.test(line)) return null
  const content = line.replace(/^\s*(?:>\s*)*/, '')
  return content.split(DETAILS_PIECE).map((piece) => piece.trim()).filter(Boolean)
}

/**
 * Puts every GitBook tag, `<details>` piece, card table and drawing on a
 * line of its own between blank lines, outside code. CommonMark would
 * otherwise merge a tag with the text around it (a paragraph, a list item
 * or an HTML block), and the blocks could not be told apart.
 */
export function isolateGitbookBlocks(source: string): string {
  if (!/\{%|<details|<summary|data-view=["']cards|gitbook-drawing/i.test(source)) return source
  const lines = source.split(/\r?\n/)
  const out: string[] = []
  let fence: Fence | null = null
  let inCards = false
  const blank = (prefix: string) => {
    const empty = prefix.trimEnd()
    const previous = out[out.length - 1]
    if (previous !== undefined && previous.trim() !== '' && previous.trim() !== empty.trim()) out.push(empty)
  }
  for (const line of lines) {
    if (fence) {
      out.push(line)
      if (isFenceClose(line, fence)) fence = null
      continue
    }
    if (inCards) {
      if (line.trim()) out.push(line)
      if (/<\/table>/i.test(line)) {
        inCards = false
        out.push('')
      }
      continue
    }
    const open = fenceOpen(line)
    if (open) {
      fence = open
      out.push(line)
      continue
    }
    const prefix = /^\s*(?:>\s*)*/.exec(line)?.[0] ?? ''
    if (CARDS_TABLE.test(line)) {
      blank(prefix)
      out.push(line)
      if (/<\/table>/i.test(line)) out.push('')
      else inCards = true
      continue
    }
    const pieces = splitTags(line) ?? splitDetails(line) ?? (DRAWING_LINE.test(line) ? [line.slice(prefix.length)] : null)
    if (!pieces) {
      out.push(line)
      continue
    }
    for (const piece of pieces) {
      blank(prefix)
      out.push(`${prefix}${piece.trim()}`)
      out.push(prefix.trimEnd())
    }
  }
  return out.join('\n')
}

// ---------- Tree transform ----------

interface BlockTag {
  name: string
  attributes: Record<string, string>
  /** Arguments as written, for `{% if %}` and `{% include %}`. */
  args: string
}

function htmlBlockValue(node: MarkdownNode): string | null {
  if (node.type === 'html' && typeof node.value === 'string') return node.value.trim()
  const only = node.type === 'paragraph' && node.children?.length === 1 ? node.children[0] : undefined
  return only?.type === 'html' && typeof only.value === 'string' ? only.value.trim() : null
}

function sourceOf(node: MarkdownNode, source: string): string | null {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  return typeof start === 'number' && typeof end === 'number' ? source.slice(start, end).trim() : null
}

function readBlockTag(node: MarkdownNode | undefined, source: string): BlockTag | null {
  if (!node) return null
  const html = htmlBlockValue(node)
  if (html !== null) {
    const details = /^<details\b([^>]*)>$/i.exec(html)
    if (details) return { name: 'details', attributes: readAttributes(details[1] ?? ''), args: '' }
    if (/^<\/details>$/i.test(html)) return { name: 'enddetails', attributes: {}, args: '' }
    return null
  }
  if (node.type !== 'paragraph') return null
  const raw = sourceOf(node, source)
  const match = raw ? WHOLE_TAG.exec(raw) : null
  const name = match?.[1]?.toLowerCase()
  if (!match || !name || !KNOWN_TAGS.has(name)) return null
  const args = match[2] ?? ''
  return { name, attributes: readAttributes(args), args }
}

function emptyParagraph(): MarkdownNode {
  return { type: 'paragraph', children: [] }
}

function blocksOrEmpty(children: MarkdownNode[]): MarkdownNode[] {
  return children.length > 0 ? children : [emptyParagraph()]
}

function firstQuoted(args: string): string {
  return /["“']([^"”']*)["”']/.exec(args)?.[1]?.trim() ?? ''
}

/** Children of a parent that only holds `childType`, loose blocks folded into the previous child. */
function childrenOfType(children: MarkdownNode[], childType: string, create: () => MarkdownNode): MarkdownNode[] {
  const result: MarkdownNode[] = []
  for (const child of children) {
    if (child.type === childType) {
      result.push(child)
      continue
    }
    let last = result[result.length - 1]
    if (!last) {
      last = create()
      result.push(last)
    }
    last.children = [...(last.children ?? []).filter((block) => !isEmptyParagraph(block)), child]
  }
  return result
}

function isEmptyParagraph(node: MarkdownNode): boolean {
  return node.type === 'paragraph' && (node.children?.length ?? 0) === 0
}

function summaryText(node: MarkdownNode | undefined): string | null {
  const html = node ? htmlBlockValue(node) : null
  const match = html ? /^<summary\b[^>]*>([\s\S]*?)<\/summary>$/i.exec(html) : null
  return match ? stripTags(match[1] ?? '') : null
}

function buildContainer(tag: BlockTag, children: MarkdownNode[]): MarkdownNode | null {
  const { attributes } = tag
  switch (tag.name) {
    case 'hint':
      return { type: GITBOOK_NODE.hint, style: isHintStyle(attributes.style) ? attributes.style : 'info', icon: attributes.icon ?? '', children: blocksOrEmpty(children) }
    case 'tabs': {
      const tabs = childrenOfType(children, GITBOOK_NODE.tab, () => ({ type: GITBOOK_NODE.tab, title: '', children: [] }))
      return tabs.length > 0 ? { type: GITBOOK_NODE.tabs, children: tabs } : null
    }
    case 'tab':
      return { type: GITBOOK_NODE.tab, title: attributes.title ?? '', children: blocksOrEmpty(children) }
    case 'stepper': {
      const steps = childrenOfType(children, GITBOOK_NODE.step, () => ({ type: GITBOOK_NODE.step, children: [] }))
      return steps.length > 0 ? { type: GITBOOK_NODE.stepper, children: steps } : null
    }
    case 'step':
      return { type: GITBOOK_NODE.step, children: blocksOrEmpty(children) }
    case 'columns': {
      const columns = childrenOfType(children, GITBOOK_NODE.column, () => ({ type: GITBOOK_NODE.column, width: '', children: [] }))
      return columns.length > 0 ? { type: GITBOOK_NODE.columns, children: columns } : null
    }
    case 'column':
      return { type: GITBOOK_NODE.column, width: attributes.width ?? '', children: blocksOrEmpty(children) }
    case 'updates': {
      const updates = childrenOfType(children, GITBOOK_NODE.update, () => ({ type: GITBOOK_NODE.update, date: '', tags: '', children: [] }))
      return updates.length > 0 ? { type: GITBOOK_NODE.updates, format: attributes.format ?? 'full', children: updates } : null
    }
    case 'update':
      return { type: GITBOOK_NODE.update, date: attributes.date ?? '', tags: attributes.tags ?? '', children: blocksOrEmpty(children) }
    case 'code': {
      const [only] = children
      if (children.length !== 1 || only?.type !== 'code') return null
      return {
        type: GITBOOK_NODE.code,
        title: attributes.title ?? '',
        lineNumbers: attributes.linenumbers === 'true',
        wrap: attributes.overflow === 'wrap',
        children: [only],
      }
    }
    case 'prompt':
      return {
        type: GITBOOK_NODE.prompt,
        description: attributes.description ?? '',
        icon: attributes.icon ?? '',
        openInProviders: attributes.openinaiproviders ?? '',
        visibility: attributes.defaultexpanded ?? '',
        children: blocksOrEmpty(children),
      }
    case 'if':
      return { type: GITBOOK_NODE.condition, expression: tag.args.trim(), children: blocksOrEmpty(children) }
    case 'details': {
      const summary = summaryText(children[0])
      return {
        type: GITBOOK_NODE.details,
        open: 'open' in attributes,
        summary: summary ?? '',
        children: blocksOrEmpty(summary === null ? children : children.slice(1)),
      }
    }
    default:
      return null
  }
}

function captionedNode(tag: BlockTag, caption: MarkdownNode | undefined): MarkdownNode {
  const text = caption ? plainText(caption).trim() : ''
  if (tag.name === 'embed') return { type: GITBOOK_NODE.embed, url: tag.attributes.url ?? '', caption: text }
  if (tag.name === 'file') return { type: GITBOOK_NODE.file, src: tag.attributes.src ?? '', caption: text }
  return { type: GITBOOK_NODE.contentRef, url: tag.attributes.url ?? '', label: text }
}

// ---------- Cards and drawings ----------

export function parseCardsTable(html: string): GitbookCard[] | null {
  if (typeof DOMParser === 'undefined') return null
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table')
  if (!table || table.getAttribute('data-view') !== 'cards') return null
  const headers = [...table.querySelectorAll('thead th')]
  const targetIndex = headers.findIndex((header) => header.hasAttribute('data-card-target'))
  const coverIndex = headers.findIndex((header) => header.hasAttribute('data-card-cover'))
  const rows = [...table.querySelectorAll('tbody tr')]
  return rows.map((row) => {
    const cells = [...row.querySelectorAll('td')]
    const texts: string[] = []
    let icon = ''
    cells.forEach((cell, index) => {
      if (index === targetIndex || index === coverIndex) return
      const iconElement = cell.querySelector('i[class*="fa-"]')
      if (iconElement && !cell.textContent?.trim().replace(iconElement.textContent ?? '', '')) {
        icon = /fa-([\w-]+)/.exec(iconElement.getAttribute('class') ?? '')?.[1] ?? ''
        return
      }
      const text = (cell.textContent ?? '').trim()
      if (text) texts.push(text)
    })
    const linkOf = (index: number) => {
      const cell = index >= 0 ? cells[index] : undefined
      return cell?.querySelector('a')?.getAttribute('href') ?? cell?.querySelector('img')?.getAttribute('src') ?? cell?.textContent?.trim() ?? ''
    }
    return {
      title: texts[0] ?? '',
      description: texts.slice(1).join(' · '),
      target: linkOf(targetIndex),
      cover: linkOf(coverIndex),
      icon,
    }
  })
}

/** The card table GitBook writes: one row per card, the link in a hidden column. */
export function writeCardsTable(cards: GitbookCard[]): string {
  const hasIcon = cards.some((card) => card.icon)
  const hasCover = cards.some((card) => card.cover)
  const header = [
    hasIcon ? '<th width="48"></th>' : '',
    '<th></th>',
    '<th></th>',
    '<th data-hidden data-card-target data-type="content-ref"></th>',
    hasCover ? '<th data-hidden data-card-cover data-type="image">Cover image</th>' : '',
  ].filter(Boolean)
  const rows = cards.map((card) => {
    const cells = [
      hasIcon ? `<td>${card.icon ? `<i class="fa-${escapeHtmlAttribute(card.icon)}"></i>` : ''}</td>` : '',
      `<td><strong>${escapeHtmlText(card.title)}</strong></td>`,
      `<td>${escapeHtmlText(card.description)}</td>`,
      `<td>${card.target ? `<a href="${escapeHtmlAttribute(card.target)}">${escapeHtmlText(card.target)}</a>` : ''}</td>`,
      hasCover ? `<td>${card.cover ? `<a href="${escapeHtmlAttribute(card.cover)}">${escapeHtmlText(card.cover)}</a>` : ''}</td>` : '',
    ].filter(Boolean)
    return `<tr>${cells.join('')}</tr>`
  })
  return `<table data-view="cards"><thead><tr>${header.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
}

function drawingNode(html: string): MarkdownNode | null {
  const match = /^(?:<figure>\s*)?<img\b([^>]*)\/?>\s*(?:<figcaption>([\s\S]*?)<\/figcaption>\s*)?(?:<\/figure>)?$/i.exec(html)
  if (!match) return null
  const attributes = readAttributes(match[1] ?? '')
  if (!(attributes.class ?? '').split(/\s+/).includes('gitbook-drawing')) return null
  return { type: GITBOOK_NODE.drawing, src: attributes.src ?? '', alt: attributes.alt ?? '', caption: stripTags(match[2] ?? '') }
}

function blockHtmlNode(node: MarkdownNode): MarkdownNode | null {
  const html = htmlBlockValue(node)
  if (html === null) return null
  if (/^<table\b[^>]*data-view=["']cards["']/i.test(html)) {
    const cards = parseCardsTable(html)
    if (!cards) return null
    const json = JSON.stringify(cards)
    return { type: GITBOOK_NODE.cards, cards: json, source: html, sourceCards: json }
  }
  return drawingNode(html)
}

// ---------- Grouping ----------

interface Frame {
  tag: BlockTag
  opener: MarkdownNode
  children: MarkdownNode[]
}

/** Groups the tags among sibling blocks into GitBook nodes; unmatched tags stay text. */
function groupBlocks(children: MarkdownNode[], source: string): MarkdownNode[] {
  const result: MarkdownNode[] = []
  const stack: Frame[] = []
  const emit = (node: MarkdownNode) => (stack[stack.length - 1]?.children ?? result).push(node)
  const unwind = () => {
    const frame = stack.pop()
    if (!frame) return
    emit(frame.opener)
    frame.children.forEach(emit)
  }
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index] as MarkdownNode
    const tag = readBlockTag(child, source)
    if (!tag) {
      emit(blockHtmlNode(child) ?? child)
      continue
    }
    if (tag.name === 'include') {
      emit({ type: GITBOOK_NODE.include, reference: firstQuoted(tag.args) })
      continue
    }
    if (CAPTIONED_TAGS.has(tag.name)) {
      const end = `end${tag.name}`
      const next = children[index + 1]
      if (readBlockTag(next, source)?.name === end) {
        emit(captionedNode(tag, undefined))
        index += 1
      } else if (next?.type === 'paragraph' && !readBlockTag(next, source) && readBlockTag(children[index + 2], source)?.name === end) {
        emit(captionedNode(tag, next))
        index += 2
      } else {
        emit(captionedNode(tag, undefined))
      }
      continue
    }
    if (tag.name in CONTAINER_NODES) {
      stack.push({ tag, opener: child, children: [] })
      continue
    }
    const opening = tag.name.startsWith('end') ? tag.name.slice(3) : ''
    const depth = stack.map((frame) => frame.tag.name).lastIndexOf(opening)
    if (!opening || depth === -1) {
      emit(child)
      continue
    }
    while (stack.length - 1 > depth) unwind()
    const frame = stack.pop() as Frame
    const built = buildContainer(frame.tag, wrapOrphans(frame.children, CONTAINER_NODES[frame.tag.name] ?? ''))
    if (built) {
      emit(built)
    } else {
      emit(frame.opener)
      frame.children.forEach(emit)
      emit(child)
    }
  }
  while (stack.length > 0) unwind()
  return result
}

/** Tabs, steps, columns and updates outside their parent get one. */
function wrapOrphans(nodes: MarkdownNode[], parentType: string): MarkdownNode[] {
  const result: MarkdownNode[] = []
  for (const node of nodes) {
    const expected = CHILD_PARENTS[node.type]
    if (!expected || expected === parentType) {
      result.push(node)
      continue
    }
    const previous = result[result.length - 1]
    if (previous?.type === expected && previous.notiaWrapped) {
      previous.children = [...(previous.children ?? []), node]
    } else {
      result.push({ type: expected, notiaWrapped: true, format: 'full', children: [node] })
    }
  }
  return result
}

const BLOCK_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition'])

function transformBlocks(node: MarkdownNode, source: string): void {
  if (!node.children) return
  node.children.forEach((child) => transformBlocks(child, source))
  if (BLOCK_PARENTS.has(node.type)) {
    node.children = wrapOrphans(groupBlocks(node.children, source), node.type)
  }
}

// ---------- Inline HTML ----------

/** Nodes whose content is literal text. */
const LITERAL_NODES = new Set(['code', 'inlineCode', 'html', 'math', 'inlineMath', 'text'])

function htmlValue(node: MarkdownNode | undefined): string | null {
  return node?.type === 'html' && typeof node.value === 'string' ? node.value.trim() : null
}

interface InlinePair {
  closing: string
  build: (attributes: Record<string, string>, inner: MarkdownNode[]) => MarkdownNode | null
}

function inlinePair(value: string): { pair: InlinePair; attributes: Record<string, string> } | null {
  const anchor = /^<a\s([^>]*)>$/i.exec(value)
  if (anchor) {
    const attributes = readAttributes(anchor[1] ?? '')
    const classes = (attributes.class ?? '').split(/\s+/)
    if (!classes.includes('button')) return null
    return {
      attributes,
      pair: {
        closing: '</a>',
        build: (attrs, inner) => ({
          type: GITBOOK_NODE.button,
          href: attrs.href ?? '',
          label: inner.map(plainText).join('').trim(),
          variant: classes.includes('secondary') ? 'secondary' : 'primary',
          icon: attrs['data-icon'] ?? '',
        }),
      },
    }
  }
  const icon = /^<i\s([^>]*)>$/i.exec(value)
  if (icon) {
    const attributes = readAttributes(icon[1] ?? '')
    const name = /(?:^|\s)fa-([\w-]+)/.exec(attributes.class ?? '')?.[1]
    if (!name) return null
    return {
      attributes,
      pair: { closing: '</i>', build: (_attrs, inner) => ({ type: GITBOOK_NODE.icon, name, label: inner.map(plainText).join('') }) },
    }
  }
  const code = /^<code\s([^>]*)>$/i.exec(value)
  if (code) {
    const attributes = readAttributes(code[1] ?? '')
    if (attributes.class !== 'expression') return null
    return {
      attributes,
      pair: {
        closing: '</code>',
        build: (_attrs, inner) => {
          const expression = decodeHtmlEntities(inner.map(plainText).join('')).trim()
          return { type: GITBOOK_NODE.expression, expression }
        },
      },
    }
  }
  return null
}

function inlineImage(value: string): MarkdownNode | null {
  const match = /^<img\s([^>]*?)\/?>$/i.exec(value)
  if (!match) return null
  const attributes = readAttributes(match[1] ?? '')
  if (attributes['data-size'] !== 'line') return null
  return { type: GITBOOK_NODE.inlineImage, src: attributes.src ?? '', alt: attributes.alt ?? '' }
}

function pairInline(children: MarkdownNode[]): MarkdownNode[] {
  const result: MarkdownNode[] = []
  let index = 0
  while (index < children.length) {
    const child = children[index] as MarkdownNode
    const value = htmlValue(child)
    const image = value === null ? null : inlineImage(value)
    if (image) {
      result.push(image)
      index += 1
      continue
    }
    const opening = value === null ? null : inlinePair(value)
    if (opening) {
      const closeIndex = children.findIndex((candidate, candidateIndex) => (
        candidateIndex > index && htmlValue(candidate)?.toLowerCase() === opening.pair.closing
      ))
      const built = closeIndex > index ? opening.pair.build(opening.attributes, children.slice(index + 1, closeIndex)) : null
      if (built) {
        result.push(built)
        index = closeIndex + 1
        continue
      }
    }
    result.push(child)
    index += 1
  }
  return result
}

function transformInline(node: MarkdownNode): void {
  if (!node.children || LITERAL_NODES.has(node.type)) return
  node.children = pairInline(node.children)
  node.children.forEach(transformInline)
}

/** Runs on the Markdown tree of the prepared source, before Milkdown builds the document. */
export function transformGitbookMarkdown(tree: MarkdownNode, source: string): void {
  transformBlocks(tree, source)
  transformInline(tree)
}

// ---------- Writing back ----------

/** The part of mdast-util-to-markdown's state the handlers use. */
interface FlowState {
  containerFlow: (parent: unknown, info: Record<string, unknown>) => string
  createTracker: (info: unknown) => { current: () => Record<string, unknown> }
}

type Handler = (node: MarkdownNode, parent: unknown, state: FlowState, info: unknown) => string

function tagAttribute(name: string, value: unknown): string {
  return typeof value === 'string' && value !== '' ? ` ${name}="${value.replace(/"/g, '&quot;')}"` : ''
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function container(open: (node: MarkdownNode) => string, close: string): Handler {
  return (node, _parent, state, info) => {
    const inner = state.containerFlow(node, state.createTracker(info).current())
    return `${open(node)}\n${inner}\n${close}`
  }
}

function markdownLinkDestination(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url
}

function markdownLinkLabel(label: string): string {
  return label.replace(/([\\[\]])/g, '\\$1')
}

/** Writes the GitBook nodes back with GitBook's syntax. */
export const gitbookMarkdownHandlers: Record<string, Handler> = {
  [GITBOOK_NODE.hint]: container((node) => `{% hint${tagAttribute('style', isHintStyle(node.style) ? node.style : 'info')}${tagAttribute('icon', node.icon)} %}`, '{% endhint %}'),
  [GITBOOK_NODE.tabs]: container(() => '{% tabs %}', '{% endtabs %}'),
  [GITBOOK_NODE.tab]: container((node) => `{% tab title="${text(node.title).replace(/"/g, '&quot;')}" %}`, '{% endtab %}'),
  [GITBOOK_NODE.stepper]: container(() => '{% stepper %}', '{% endstepper %}'),
  [GITBOOK_NODE.step]: container(() => '{% step %}', '{% endstep %}'),
  [GITBOOK_NODE.columns]: container(() => '{% columns %}', '{% endcolumns %}'),
  [GITBOOK_NODE.column]: container((node) => `{% column${tagAttribute('width', node.width)} %}`, '{% endcolumn %}'),
  [GITBOOK_NODE.updates]: container((node) => `{% updates${tagAttribute('format', node.format || 'full')} %}`, '{% endupdates %}'),
  [GITBOOK_NODE.update]: container((node) => `{% update${tagAttribute('date', node.date)}${tagAttribute('tags', node.tags)} %}`, '{% endupdate %}'),
  [GITBOOK_NODE.code]: container((node) => (
    `{% code${tagAttribute('title', node.title)}${node.wrap ? ' overflow="wrap"' : ''}${node.lineNumbers ? ' lineNumbers="true"' : ''} %}`
  ), '{% endcode %}'),
  [GITBOOK_NODE.prompt]: container((node) => (
    `{% prompt${tagAttribute('description', node.description)}${tagAttribute('icon', node.icon)}${tagAttribute('openInAIProviders', node.openInProviders)}${tagAttribute('defaultExpanded', node.visibility)} %}`
  ), '{% endprompt %}'),
  [GITBOOK_NODE.condition]: container((node) => `{% if ${text(node.expression).replace(/%\}/g, '% }')} %}`, '{% endif %}'),
  [GITBOOK_NODE.details]: (node, _parent, state, info) => {
    const inner = state.containerFlow(node, state.createTracker(info).current())
    return `<details${node.open ? ' open' : ''}>\n<summary>${escapeHtmlText(text(node.summary))}</summary>\n\n${inner}\n\n</details>`
  },
  [GITBOOK_NODE.embed]: (node) => {
    const caption = text(node.caption).trim()
    const open = `{% embed url="${text(node.url).replace(/"/g, '&quot;')}" %}`
    return caption ? `${open}\n${caption}\n{% endembed %}` : open
  },
  [GITBOOK_NODE.file]: (node) => {
    const caption = text(node.caption).trim()
    return `{% file src="${text(node.src).replace(/"/g, '&quot;')}" %}\n${caption}\n{% endfile %}`
  },
  [GITBOOK_NODE.contentRef]: (node) => {
    const url = text(node.url)
    const label = text(node.label).trim() || url
    return `{% content-ref url="${url.replace(/"/g, '&quot;')}" %}\n[${markdownLinkLabel(label)}](${markdownLinkDestination(url)})\n{% endcontent-ref %}`
  },
  [GITBOOK_NODE.include]: (node) => `{% include "${text(node.reference).replace(/"/g, '')}" %}`,
  [GITBOOK_NODE.cards]: (node) => {
    const cards = text(node.cards)
    const source = text(node.source)
    if (source && cards === text(node.sourceCards)) return source
    try {
      return writeCardsTable(JSON.parse(cards) as GitbookCard[])
    } catch {
      return writeCardsTable([])
    }
  },
  [GITBOOK_NODE.drawing]: (node) => {
    const image = `<img src="${escapeHtmlAttribute(text(node.src))}" alt="${escapeHtmlAttribute(text(node.alt))}" class="gitbook-drawing">`
    const caption = text(node.caption).trim()
    return caption ? `<figure>${image}<figcaption><p>${escapeHtmlText(caption)}</p></figcaption></figure>` : image
  },
  [GITBOOK_NODE.button]: (node) => {
    const variant = node.variant === 'secondary' ? 'secondary' : 'primary'
    return `<a href="${escapeHtmlAttribute(text(node.href))}" class="button ${variant}"${tagAttribute('data-icon', node.icon)}>${escapeHtmlText(text(node.label))}</a>`
  },
  [GITBOOK_NODE.icon]: (node) => `<i class="fa-${escapeHtmlAttribute(text(node.name))}">${escapeHtmlText(text(node.label))}</i>`,
  [GITBOOK_NODE.expression]: (node) => `<code class="expression">${escapeHtmlText(text(node.expression))}</code>`,
  [GITBOOK_NODE.inlineImage]: (node) => `<img src="${escapeHtmlAttribute(text(node.src))}" alt="${escapeHtmlAttribute(text(node.alt))}" data-size="line">`,
}
