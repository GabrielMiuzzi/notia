import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'

/** Page geometry in CSS pixels of the unzoomed editor. */
export interface PaginationGeometry {
  pageHeight: number
  /** Space between two sheets. */
  pageGap: number
  /** Top and bottom margin of the text inside a sheet. */
  margin: number
  /** Room kept above the bottom margin for the page number. */
  numberBand: number
  /** CSS zoom of the editor, to turn measured sizes into layout pixels. */
  zoom: number
}

export interface PageBreak {
  /** Document position of the block (or list item) that starts the next page. */
  pos: number
  /** Blank space that moves that block to the next page. */
  height: number
}

/**
 * A page break in the note's flow: where the blank space starts in the text
 * without page breaks (the layout of a note out of page mode, in layout
 * pixels from the top of the sheet) and how tall it is. The handwriting uses
 * it to show the same strokes on the same text in both modes.
 */
export interface FlowBreak {
  flowTop: number
  height: number
}

export interface PaginationPluginOptions {
  getGeometry: () => PaginationGeometry | null
  /** Element the sheets are laid out in; its top is the first page's top. */
  getContainer: () => HTMLElement | null
  onPageCountChange: (count: number) => void
  /** The page breaks in the flow, each time they change or page mode turns on or off (none out of page mode). */
  onFlowBreaksChange?: (breaks: FlowBreak[]) => void
}

interface PaginationState {
  breaks: PageBreak[]
  decorations: DecorationSet
}

/** Below this, two layouts are the same. */
const LAYOUT_TOLERANCE_PX = 0.5

const paginationKey = new PluginKey<PaginationState>('notiaPagination')
const repaginators = new WeakMap<EditorView, () => void>()

function spacer(height: number): HTMLElement {
  const element = document.createElement('div')
  element.className = 'notia-page-spacer'
  element.style.height = `${height}px`
  element.contentEditable = 'false'
  element.setAttribute('aria-hidden', 'true')
  return element
}

function decorationsFor(doc: ProseMirrorNode, breaks: PageBreak[]): DecorationSet {
  return DecorationSet.create(doc, breaks.map((pageBreak) => Decoration.widget(
    pageBreak.pos,
    () => spacer(pageBreak.height),
    { side: -1, ignoreSelection: true, key: `page-break-${pageBreak.pos}-${pageBreak.height}` },
  )))
}

function sameBreaks(left: PageBreak[], right: PageBreak[]): boolean {
  return left.length === right.length && left.every((pageBreak, index) => (
    pageBreak.pos === right[index]?.pos
    && Math.abs(pageBreak.height - (right[index]?.height ?? 0)) <= LAYOUT_TOLERANCE_PX
  ))
}

export interface MeasuredBlock {
  pos: number
  /** Top and height without the page breaks, in layout pixels. */
  top: number
  height: number
  /** Headings move to the next page with the block they introduce. */
  keepWithNext?: boolean
}

/**
 * Where each page starts. A block that does not fit in what is left of its
 * page moves to the next one; a block taller than a page keeps its place and
 * runs over (paragraphs, tables and code are not split; lists split between
 * their items).
 */
export function layoutPages(blocks: MeasuredBlock[], geometry: PaginationGeometry): { breaks: PageBreak[]; pageCount: number } {
  const period = geometry.pageHeight + geometry.pageGap
  const contentTop = (page: number) => page * period + geometry.margin
  const contentBottom = (page: number) => page * period + geometry.pageHeight - geometry.margin - geometry.numberBand
  const breaks: PageBreak[] = []
  const first = blocks[0]
  if (!first) return { breaks, pageCount: 1 }
  let y = first.top
  let page = Math.max(0, Math.floor(y / period))
  /** Headings right before the current block, on its page. */
  let headings: Array<{ block: MeasuredBlock; top: number }> = []
  for (const block of blocks) {
    if (y < contentTop(page) - LAYOUT_TOLERANCE_PX) {
      // After a block taller than a sheet: start below the top margin.
      breaks.push({ pos: block.pos, height: Math.round(contentTop(page) - y) })
      y = contentTop(page)
      headings = []
    } else if (y + block.height > contentBottom(page) + LAYOUT_TOLERANCE_PX && y > contentTop(page) + LAYOUT_TOLERANCE_PX) {
      const nextTop = contentTop(page + 1)
      // Headings do not stay alone at the foot of a page: they move with the
      // block they introduce, unless they already start the page.
      const lead = headings.find((heading) => heading.top > contentTop(page) + LAYOUT_TOLERANCE_PX)
      if (lead) {
        breaks.push({ pos: lead.block.pos, height: Math.round(nextTop - lead.top) })
        y = nextTop + (y - lead.top)
      } else {
        breaks.push({ pos: block.pos, height: Math.round(nextTop - y) })
        y = nextTop
      }
      page += 1
      headings = []
    }
    headings = block.keepWithNext ? [...headings, { block, top: y }] : []
    y += block.height
    const landed = Math.floor(y / period)
    if (landed > page) {
      page = landed
      headings = []
    }
  }
  return { breaks, pageCount: page + 1 }
}

/** Lists can move to the next page item by item; other blocks move whole. */
const SPLITTABLE_NODES = new Set(['bullet_list', 'ordered_list'])

/** What ProseMirror keeps on the DOM element of each node it draws (its view of the node). */
interface NodeViewDescription {
  node?: ProseMirrorNode | null
  nodeDOM?: Node | null
  contentDOM?: HTMLElement | null
}

function descriptionOf(element: Element): NodeViewDescription | undefined {
  return (element as Element & { pmViewDesc?: NodeViewDescription }).pmViewDesc
}

/**
 * The description of each child of `parent`, in one pass over the elements
 * of `container` (widgets such as the page spacers are skipped), or `null`
 * where the pass cannot tell.
 */
function childDescriptions(container: Element | null | undefined, parent: ProseMirrorNode): Array<NodeViewDescription | null> {
  const descriptions: Array<NodeViewDescription | null> = []
  let element = container?.firstElementChild ?? null
  parent.forEach((child) => {
    let candidate = element
    while (candidate && descriptionOf(candidate)?.node !== child) candidate = candidate.nextElementSibling
    if (!candidate) {
      descriptions.push(null)
      return
    }
    descriptions.push(descriptionOf(candidate) ?? null)
    element = candidate.nextElementSibling
  })
  return descriptions
}

export interface BreakCandidate {
  /** Document position of the block or list item. */
  pos: number
  node: ProseMirrorNode
  /** What `view.nodeDOM(pos)` gives. */
  dom: Node | null
}

/**
 * Where a page can start: top-level blocks, and the items of top-level
 * lists, with their DOM. One walk over the document and the editor's
 * elements: `view.nodeDOM` searched from the start for each block, which
 * grew with the square of the note. Where the walk cannot tell, `nodeDOM`
 * answers.
 */
export function breakCandidates(view: EditorView): BreakCandidate[] {
  const { doc } = view.state
  const candidates: BreakCandidate[] = []
  const blocks = childDescriptions(view.dom, doc)
  doc.forEach((node, offset, index) => {
    const block = blocks[index] ?? null
    if (SPLITTABLE_NODES.has(node.type.name) && node.childCount > 0) {
      const items = childDescriptions(block?.contentDOM, node)
      node.forEach((item, itemOffset, itemIndex) => {
        const pos = offset + 1 + itemOffset
        candidates.push({ pos, node: item, dom: items[itemIndex]?.nodeDOM ?? view.nodeDOM(pos) })
      })
      return
    }
    candidates.push({ pos: offset, node, dom: block?.nodeDOM ?? view.nodeDOM(offset) })
  })
  return candidates
}

/** Measures the places a page can start as if there were no page breaks. */
function measureBlocks(view: EditorView, container: HTMLElement, breaks: PageBreak[], zoom: number): MeasuredBlock[] {
  const origin = container.getBoundingClientRect().top
  const blocks: MeasuredBlock[] = []
  let lastBottom = 0
  // The space before a block is every break up to it: added as the blocks
  // go, in document order, instead of summed again for each block.
  const ordered = [...breaks].sort((left, right) => left.pos - right.pos)
  let nextBreak = 0
  let before = 0
  for (const { pos, node, dom } of breakCandidates(view)) {
    while (nextBreak < ordered.length && ordered[nextBreak]!.pos <= pos) {
      before += ordered[nextBreak]!.height
      nextBreak += 1
    }
    if (!(dom instanceof HTMLElement)) continue
    const rect = dom.getBoundingClientRect()
    blocks.push({ pos, top: (rect.top - origin) / zoom - before, height: 0, keepWithNext: node.type.name === 'heading' })
    lastBottom = Math.max(lastBottom, (rect.bottom - origin) / zoom - before)
  }
  blocks.forEach((block, index) => {
    const next = blocks[index + 1]
    block.height = (next ? next.top : lastBottom) - block.top
  })
  return blocks
}

/** Lays the page breaks again, for example after the page setup changed. */
export function requestPagination(view: EditorView): void {
  repaginators.get(view)?.()
}

/**
 * Page mode: blank space before the blocks that start a page, so the text
 * flows from sheet to sheet. The spaces are decorations; the Markdown does
 * not change.
 */
export function createPaginationPlugin({ getGeometry, getContainer, onPageCountChange, onFlowBreaksChange }: PaginationPluginOptions): Plugin {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: () => ({ breaks: [], decorations: DecorationSet.empty }),
      apply: (tr, value) => {
        const breaks = tr.getMeta(paginationKey) as PageBreak[] | undefined
        if (breaks) return { breaks, decorations: decorationsFor(tr.doc, breaks) }
        if (!tr.docChanged) return value
        return {
          breaks: value.breaks.map((pageBreak) => ({ ...pageBreak, pos: tr.mapping.map(pageBreak.pos, -1) })),
          decorations: value.decorations.map(tr.mapping, tr.doc),
        }
      },
    },
    props: {
      decorations: (state) => paginationKey.getState(state)?.decorations,
    },
    view: (view) => {
      let frame = 0
      let lastCount = 0
      let lastFlow = ''
      /** Sizes of the editor and the sheets when the pages were last laid out. */
      let laidOutSizes = ''
      const sizes = () => {
        const container = getContainer()
        return `${view.dom.offsetWidth}x${view.dom.offsetHeight} ${container?.offsetWidth ?? 0}x${container?.offsetHeight ?? 0}`
      }
      const paginate = () => {
        const current = paginationKey.getState(view.state)?.breaks ?? []
        const geometry = getGeometry()
        const container = getContainer()
        let next: PageBreak[] = []
        let pageCount = 1
        let flow: FlowBreak[] = []
        if (geometry && container) {
          const blocks = measureBlocks(view, container, current, geometry.zoom)
          const layout = layoutPages(blocks, geometry)
          next = layout.breaks
          pageCount = layout.pageCount
          const topOf = new Map<number, number>()
          blocks.forEach((block) => {
            if (!topOf.has(block.pos)) topOf.set(block.pos, block.top)
          })
          flow = next.map((pageBreak) => ({
            flowTop: topOf.get(pageBreak.pos) ?? 0,
            height: pageBreak.height,
          }))
        }
        // Turning page mode on or off is reported too, even without breaks.
        const flowKey = JSON.stringify([geometry !== null, flow])
        if (flowKey !== lastFlow) {
          lastFlow = flowKey
          onFlowBreaksChange?.(flow)
        }
        if (!sameBreaks(current, next)) {
          view.dispatch(view.state.tr.setMeta(paginationKey, next).setMeta('addToHistory', false))
        }
        if (pageCount !== lastCount) {
          lastCount = pageCount
          onPageCountChange(pageCount)
        }
        // The layout was just measured, so reading the sizes is cheap.
        laidOutSizes = geometry && container ? sizes() : ''
      }
      const schedule = () => {
        window.cancelAnimationFrame(frame)
        frame = window.requestAnimationFrame(() => {
          if (!view.isDestroyed) paginate()
        })
      }
      // A size the pages were already laid out with (the new line that was
      // just measured) does not lay them out a second time.
      const onResize = () => {
        if (laidOutSizes && sizes() === laidOutSizes) return
        schedule()
      }
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null
      observer?.observe(view.dom)
      const container = getContainer()
      if (container) observer?.observe(container)
      repaginators.set(view, schedule)
      schedule()
      return {
        update: (updatedView, previousState) => {
          if (updatedView.state.doc !== previousState.doc) schedule()
        },
        destroy: () => {
          window.cancelAnimationFrame(frame)
          observer?.disconnect()
          repaginators.delete(view)
        },
      }
    },
  })
}
