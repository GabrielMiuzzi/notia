/** What the public site reads from its Notia server (`/api/*`). The server
 * decides what is published, builds the index and writes each page. */

export interface PublicNavEntry {
  /** Page it opens; `null` for a folder without a cover note. */
  url: string | null
  title: string
  children: PublicNavEntry[]
}

export interface PublicNavGroup {
  title: string | null
  entries: PublicNavEntry[]
}

export interface PublicSpace {
  name: string
  groups: PublicNavGroup[]
  home: string | null
  pageCount: number
}

export interface PublicPageLink {
  url: string
  title: string
}

export interface PublicOutlineEntry {
  id: string
  text: string
  level: number
}

export interface PublicPage {
  url: string
  title: string
  description: string | null
  /** Filtered HTML written by the server. */
  html: string
  outline: PublicOutlineEntry[]
  /** Group and parent pages, for the breadcrumb. */
  trail: string[]
  previous: PublicPageLink | null
  next: PublicPageLink | null
  modifiedAt: number | null
}

export interface PublicSearchResult {
  url: string
  title: string
  snippet: string
  trail: string[] | null
}

export class PublicSpaceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', signal })
  const body = await response.json().catch(() => null) as ({ error?: string } & T) | null
  if (!response.ok || !body) {
    throw new PublicSpaceError(body?.error ?? 'El sitio no está disponible.', response.status)
  }
  return body
}

export function readSpace(signal?: AbortSignal): Promise<PublicSpace> {
  return read<PublicSpace>('/api/space', signal)
}

/** The page behind a URL path of the site (as `location.pathname` has it). */
export function readPage(urlPath: string, signal?: AbortSignal): Promise<PublicPage> {
  return read<PublicPage>(`/api/page?path=${encodeURIComponent(urlPath)}`, signal)
}

export async function searchSpace(query: string, signal?: AbortSignal): Promise<PublicSearchResult[]> {
  const body = await read<{ results: PublicSearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`, signal)
  return body.results
}
