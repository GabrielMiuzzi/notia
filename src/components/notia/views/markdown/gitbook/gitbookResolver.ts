import type {
  GitbookBlocksRequest,
  GitbookBlocksResponse,
  GitbookConditionResult,
  GitbookExpressionResult,
  GitbookIncludeResult,
  GitbookReferenceResult,
} from '../../../../../services/markdown/gitbookBlocksRuntime'

/*
 * Asks Rust, in batches, what the blocks the editor draws resolve to, and
 * keeps the answers while the note is open. Views read an answer, or ask for
 * it and are told when it arrives. Page variables live in the note's
 * properties, so expressions and conditions are asked again when they change.
 */

const BATCH_DELAY_MS = 120

interface Results {
  expression: GitbookExpressionResult
  condition: GitbookConditionResult
  reference: GitbookReferenceResult
  include: GitbookIncludeResult
}

export type GitbookResolveKind = keyof Results

/** `null` when there is no library to resolve against. */
export type GitbookBlocksRequester = (request: GitbookBlocksRequest) => Promise<GitbookBlocksResponse | null>

const REQUEST_KEYS: Record<GitbookResolveKind, keyof GitbookBlocksRequest> = {
  expression: 'expressions',
  condition: 'conditions',
  reference: 'references',
  include: 'includes',
}

function emptyCaches(): { [K in GitbookResolveKind]: Map<string, Results[K]> } {
  return { expression: new Map(), condition: new Map(), reference: new Map(), include: new Map() }
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

function frontmatterOf(source: string): string {
  const text = source.startsWith(BYTE_ORDER_MARK) ? source.slice(1) : source
  return /^---\r?\n[\s\S]*?\r?\n---/.exec(text)?.[0] ?? ''
}

export class GitbookResolver {
  private caches = emptyCaches()
  private pending: { [K in GitbookResolveKind]: Set<string> } = {
    expression: new Set(), condition: new Set(), reference: new Set(), include: new Set(),
  }
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private frontmatter: string

  constructor(private readonly requester: GitbookBlocksRequester, source = '') {
    this.frontmatter = frontmatterOf(source)
  }

  get<K extends GitbookResolveKind>(kind: K, key: string): Results[K] | undefined {
    const cached = this.caches[kind].get(key) as Results[K] | undefined
    if (!cached && key) {
      this.pending[kind].add(key)
      this.schedule()
    }
    return cached
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The note changed: its variables may have too. */
  noteSourceChanged(source: string): void {
    const frontmatter = frontmatterOf(source)
    if (frontmatter === this.frontmatter) return
    this.frontmatter = frontmatter
    this.invalidate(['expression', 'condition'])
  }

  /** Forgets answers so the views ask again. */
  invalidate(kinds: GitbookResolveKind[] = ['expression', 'condition', 'reference', 'include']): void {
    this.generation += 1
    kinds.forEach((kind) => this.caches[kind].clear())
    this.notify()
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.listeners.clear()
    this.generation += 1
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener())
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, BATCH_DELAY_MS)
  }

  private async flush(): Promise<void> {
    const request: GitbookBlocksRequest = { expressions: [], conditions: [], references: [], includes: [] }
    for (const kind of Object.keys(REQUEST_KEYS) as GitbookResolveKind[]) {
      request[REQUEST_KEYS[kind]] = [...this.pending[kind]]
      this.pending[kind].clear()
    }
    const generation = this.generation
    let response: GitbookBlocksResponse | null = null
    try {
      response = await this.requester(request)
    } catch {
      response = null
    }
    if (!response || generation !== this.generation) return
    response.expressions.forEach((result) => this.caches.expression.set(result.expression, result))
    response.conditions.forEach((result) => this.caches.condition.set(result.expression, result))
    response.references.forEach((result) => this.caches.reference.set(result.reference, result))
    response.includes.forEach((result) => this.caches.include.set(result.reference, result))
    this.notify()
  }
}
