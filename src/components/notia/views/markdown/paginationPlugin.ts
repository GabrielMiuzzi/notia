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

export interface PaginationPluginOptions {
  getGeometry: () => PaginationGeometry | null
  /** Element the sheets are laid out in; its top is the first page's top. */
  getContainer: () => HTMLElement | null
  onPageCountChange: (count: number) => void
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

/** Positions where a page can start: top-level blocks, and the items of top-level lists. */
function breakCandidates(doc: ProseMirrorNode): number[] {
  const positions: number[] = []
  doc.forEach((node, offset) => {
    if (SPLITTABLE_NODES.has(node.type.name) && node.childCount > 0) {
      node.forEach((_item, itemOffset) => positions.push(offset + 1 + itemOffset))
      return
    }
    positions.push(offset)
  })
  return positions
}

/** Measures the places a page can start as if there were no page breaks. */
function measureBlocks(view: EditorView, container: HTMLElement, breaks: PageBreak[], zoom: number): MeasuredBlock[] {
  const origin = container.getBoundingClientRect().top
  const blocks: MeasuredBlock[] = []
  let lastBottom = 0
  breakCandidates(view.state.doc).forEach((pos) => {
    const dom = view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) return
    const before = breaks.reduce((sum, pageBreak) => (pageBreak.pos <= pos ? sum + pageBreak.height : sum), 0)
    const rect = dom.getBoundingClientRect()
    const keepWithNext = view.state.doc.nodeAt(pos)?.type.name === 'heading'
    blocks.push({ pos, top: (rect.top - origin) / zoom - before, height: 0, keepWithNext })
    lastBottom = Math.max(lastBottom, (rect.bottom - origin) / zoom - before)
  })
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
export function createPaginationPlugin({ getGeometry, getContainer, onPageCountChange }: PaginationPluginOptions): Plugin {
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
      const paginate = () => {
        const current = paginationKey.getState(view.state)?.breaks ?? []
        const geometry = getGeometry()
        const container = getContainer()
        let next: PageBreak[] = []
        let pageCount = 1
        if (geometry && container) {
          const layout = layoutPages(measureBlocks(view, container, current, geometry.zoom), geometry)
          next = layout.breaks
          pageCount = layout.pageCount
        }
        if (!sameBreaks(current, next)) {
          view.dispatch(view.state.tr.setMeta(paginationKey, next).setMeta('addToHistory', false))
        }
        if (pageCount !== lastCount) {
          lastCount = pageCount
          onPageCountChange(pageCount)
        }
      }
      const schedule = () => {
        window.cancelAnimationFrame(frame)
        frame = window.requestAnimationFrame(() => {
          if (!view.isDestroyed) paginate()
        })
      }
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
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
